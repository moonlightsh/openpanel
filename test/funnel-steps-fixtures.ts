/**
 * Deterministic ClickHouse fixture for multi-event funnel-step tests.
 *
 * Mirrors the strategy of `retention-fixtures.ts`: every event sits on a
 * FIXED absolute date so the expected step levels are a stable,
 * hand-computed blueprint — the contract the funnel engine must satisfy.
 *
 * ---------------------------------------------------------------------------
 * Dataset (window 2026-06-01 .. 2026-06-05, funnelWindow 24h)
 * ---------------------------------------------------------------------------
 *
 * Funnel: s1 = visit | s2 = confirm_d1c OR confirm_other | s3 = finished_d1c
 * (properties.plan = 'd1c') OR finished_other. All timestamps are strict
 * hour offsets from 2026-06-01 00:00:00; users share one session
 * `sess-<user>-1`.
 *
 *   user   events                                   expected level (profile_id)
 *   U1     visit@0 confirm_d1c@1 finished_d1c@2(d1c)     3
 *   U2     visit@0 confirm_d1c@1 confirm_other@1.5
 *          finished_other@2                              3 (s2 counted once)
 *   U3     visit@0 confirm_other@1 finished_other@2      3
 *   U4     visit@0 confirm_d1c@1                         2
 *   U5     confirm_d1c@0 finished_d1c@0.5(d1c) visit@1    1 (strict ordering —
 *          visit comes AFTER both later-step events, so no s1->s2 chain exists)
 *   U6     visit@0 confirm_d1c@1 finished_d1c@30(d1c)    2 (window = 24h)
 *   U7     visit@0 confirm_d1c@1 finished_d1c@2(other)   2 (arm filter rejects)
 *   U8     confirm_d1c@0 finished_d1c@1(d1c)             0 (never entered)
 *   U9     visit@0 confirm_d1c+confirm_other@1
 *          finished_d1c@2(d1c)                          3
 *   U10    (overlap scenario, own funnel below)          1 in the main funnel
 *          (its trailing `cooldown` event matches no main-funnel step)
 *
 * Overlap probe (separate funnel): s1 = visit, s2 = confirm_or_finish (no
 * filter), s3 = confirm_or_finish (plan = 'd1c'). U10 sends visit@0 ->
 * confirm_or_finish(plan=d1c)@1 -> confirm_other@2. The plan=d1c event
 * matches BOTH step predicates; the invariant under test is that one
 * physical event advances at most one step.
 *
 * country: every user is US except U3 (SE), for the global-filter case.
 * Use a per-suite projectId so suites can run concurrently.
 */

import { createClient } from '../packages/db/src/clickhouse/client';

// ---------------------------------------------------------------------------
// Well-known ids + absolute dates
// ---------------------------------------------------------------------------

export const FUNNEL_STEPS_FIXTURE = {
  users: {
    u1: 'fs-u1',
    u2: 'fs-u2',
    u3: 'fs-u3',
    u4: 'fs-u4',
    u5: 'fs-u5',
    u6: 'fs-u6',
    u7: 'fs-u7',
    u8: 'fs-u8',
    u9: 'fs-u9',
    u10: 'fs-u10',
  },
  window: {
    start: '2026-06-01 00:00:00',
    end: '2026-06-05 23:59:59',
  },
  /** Expected level per user for the profile_id-grouped funnel. */
  // NOTE: U5's original blueprint order (finished@0 -> visit@1 -> confirm@2)
  // contained an in-order visit->confirm SUBSEQUENCE, which windowFunnel
  // legitimately counts as level 2 (verified on CH 26.1: windowFunnel finds
  // the longest chain starting anywhere, it is not anchored to the first
  // event). The rows were reordered so the visit comes last, which is what
  // the "steps out of order -> level 1" intent requires. U10's trailing
  // event is `cooldown` (not a main-funnel alternate) so U10 stays at level 1
  // in the main funnel while still feeding the overlap probe.
  expectedLevels: {
    u1: 3,
    u2: 3,
    u3: 3,
    u4: 2,
    u5: 1,
    u6: 2,
    u7: 2,
    u8: 0,
    u9: 3,
  },
} as const;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

type ChClient = ReturnType<typeof createClient>;

function getClient(): ChClient {
  const url = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123';
  return createClient({ url });
}

let eventSeq = 0;

/** Absolute timestamp helper: hour offsets from 2026-06-01 00:00:00. */
function at(hour: number): string {
  if (hour < 0) {
    throw new Error(`negative hour offset: ${hour}`);
  }
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const d = Math.floor(h / 24);
  const hh = String(h % 24).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const date = new Date(Date.UTC(2026, 5, 1 + d));
  const yyyy = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mo}-${dd} ${hh}:${mm}:00`;
}

function buildEvent(
  projectId: string,
  profileId: string,
  name: string,
  createdAt: string,
  overrides: Record<string, unknown> = {}
) {
  eventSeq += 1;
  return {
    // Deterministic, collision-free uuid in the funnel-steps namespace
    id: `00000000-0000-4000-8000-${String(eventSeq).padStart(12, '0')}`,
    project_id: projectId,
    profile_id: profileId,
    device_id: `dev-${profileId}`,
    name,
    session_id: `sess-${profileId}-1`,
    created_at: createdAt,
    path: '/',
    origin: 'https://example.com',
    referrer: '',
    referrer_name: '',
    referrer_type: '',
    revenue: 0,
    duration: 0,
    properties: {},
    groups: [],
    country: 'US',
    city: '',
    region: '',
    sdk_name: 'test',
    sdk_version: '1.0.0',
    os: '',
    os_version: '',
    browser: 'Chrome',
    browser_version: '',
    device: 'desktop',
    brand: '',
    model: '',
    ...overrides,
  };
}

function buildEvents(projectId: string) {
  const { users } = FUNNEL_STEPS_FIXTURE;
  const us = { country: 'US' };
  const se = { country: 'SE' };
  const plan = (value: string) => ({ properties: { plan: value } });

  return [
    // U1 — full completion
    buildEvent(projectId, users.u1, 'visit', at(0)),
    buildEvent(projectId, users.u1, 'confirm_d1c', at(1)),
    buildEvent(projectId, users.u1, 'finished_d1c', at(2), plan('d1c')),

    // U2 — hits both s2 alternates; s2 counts once
    buildEvent(projectId, users.u2, 'visit', at(0)),
    buildEvent(projectId, users.u2, 'confirm_d1c', at(1)),
    buildEvent(projectId, users.u2, 'confirm_other', at(1.5)),
    buildEvent(projectId, users.u2, 'finished_other', at(2)),

    // U3 — the other branch (SE country, used by the global-filter case)
    buildEvent(projectId, users.u3, 'visit', at(0), se),
    buildEvent(projectId, users.u3, 'confirm_other', at(1), se),
    buildEvent(projectId, users.u3, 'finished_other', at(2), se),

    // U4 — missing third step
    buildEvent(projectId, users.u4, 'visit', at(0)),
    buildEvent(projectId, users.u4, 'confirm_d1c', at(1)),

    // U5 — steps out of order: the visit comes AFTER both later-step
    // events, so no s1 -> s2 chain exists and the level stays 1.
    buildEvent(projectId, users.u5, 'confirm_d1c', at(0)),
    buildEvent(projectId, users.u5, 'finished_d1c', at(0.5), plan('d1c')),
    buildEvent(projectId, users.u5, 'visit', at(1)),

    // U6 — third step outside the 24h window (30h after visit)
    buildEvent(projectId, users.u6, 'visit', at(0)),
    buildEvent(projectId, users.u6, 'confirm_d1c', at(1)),
    buildEvent(projectId, users.u6, 'finished_d1c', at(30), plan('d1c')),

    // U7 — filter arm rejects (plan=other on finished_d1c)
    buildEvent(projectId, users.u7, 'visit', at(0)),
    buildEvent(projectId, users.u7, 'confirm_d1c', at(1)),
    buildEvent(projectId, users.u7, 'finished_d1c', at(2), plan('other')),

    // U8 — never entered (no visit)
    buildEvent(projectId, users.u8, 'confirm_d1c', at(0)),
    buildEvent(projectId, users.u8, 'finished_d1c', at(1), plan('d1c')),

    // U9 — same-timestamp alternates for s2
    buildEvent(projectId, users.u9, 'visit', at(0)),
    buildEvent(projectId, users.u9, 'confirm_d1c', at(1)),
    buildEvent(projectId, users.u9, 'confirm_other', at(1)),
    buildEvent(projectId, users.u9, 'finished_d1c', at(2), plan('d1c')),

    // U10 — overlap probe rows (queried by their own funnel): the single
    // confirm_or_finish(plan=d1c) event matches both the unfiltered and the
    // plan-filtered predicate of the overlap funnel. The trailing `cooldown`
    // event deliberately matches NO main-funnel step so U10 stays at level 1
    // there.
    buildEvent(projectId, users.u10, 'visit', at(0)),
    buildEvent(projectId, users.u10, 'confirm_or_finish', at(1), plan('d1c')),
    buildEvent(projectId, users.u10, 'cooldown', at(2)),

    // keep `us` referenced even if the country matrix changes above
    us.country,
  ].filter((row) => typeof row !== 'string');
}

function buildProfiles(projectId: string) {
  return Object.values(FUNNEL_STEPS_FIXTURE.users).map((profileId) => ({
    id: profileId,
    project_id: projectId,
    first_name: profileId,
    last_name: '',
    email: `${profileId}@example.com`,
    avatar: '',
    is_external: false,
    properties: {
      country: profileId === FUNNEL_STEPS_FIXTURE.users.u3 ? 'SE' : 'US',
    },
    groups: [],
    created_at: '2026-06-01 00:00:00',
    last_seen_at: '2026-06-02 00:00:00',
  }));
}

function buildSessions(projectId: string) {
  return Object.values(FUNNEL_STEPS_FIXTURE.users).map((profileId) => ({
    id: `sess-${profileId}-1`,
    project_id: projectId,
    profile_id: profileId,
    device_id: `dev-${profileId}`,
    created_at: '2026-06-01 00:00:00',
    ended_at: '2026-06-02 00:00:00',
    is_bounce: false,
    entry_origin: 'https://example.com',
    entry_path: '/',
    exit_origin: 'https://example.com',
    exit_path: '/',
    screen_view_count: 1,
    revenue: 0,
    event_count: 3,
    duration: 7200,
    country: profileId === FUNNEL_STEPS_FIXTURE.users.u3 ? 'SE' : 'US',
    region: '',
    city: '',
    device: 'desktop',
    brand: '',
    browser: 'Chrome',
    browser_version: '',
    os: '',
    os_version: '',
    utm_medium: '',
    utm_source: '',
    utm_campaign: '',
    utm_content: '',
    utm_term: '',
    referrer: '',
    referrer_name: '',
    referrer_type: '',
    sign: 1,
    version: 1,
    properties: {},
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function deleteFixtures(client: ChClient, projectId: string) {
  await Promise.all([
    client.command({
      query: `DELETE FROM openpanel.events WHERE project_id = '${projectId}'`,
    }),
    client.command({
      query: `DELETE FROM openpanel.profiles WHERE project_id = '${projectId}'`,
    }),
    client.command({
      query: `DELETE FROM openpanel.sessions WHERE project_id = '${projectId}'`,
    }),
    // Materialized views are NOT touched by DELETE FROM events; mutate them
    // too so reruns stay clean.
    client.command({
      query: `ALTER TABLE openpanel.distinct_event_names_mv DELETE WHERE project_id = '${projectId}'`,
    }),
  ]);
}

export async function setupFunnelStepsFixtures(
  projectId: string
): Promise<void> {
  const client = getClient();
  try {
    await deleteFixtures(client, projectId);
    await client.insert({
      table: 'openpanel.profiles',
      values: buildProfiles(projectId),
      format: 'JSONEachRow',
    });
    await client.insert({
      table: 'openpanel.events',
      values: buildEvents(projectId),
      format: 'JSONEachRow',
    });
    await client.insert({
      table: 'openpanel.sessions',
      values: buildSessions(projectId),
      format: 'JSONEachRow',
    });
  } finally {
    await client.close();
  }
}

export async function teardownFunnelStepsFixtures(
  projectId: string
): Promise<void> {
  const client = getClient();
  try {
    await deleteFixtures(client, projectId);
  } finally {
    await client.close();
  }
}
