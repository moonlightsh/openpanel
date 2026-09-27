/**
 * Behavioral tests for event-mode identity fallback when `profile_id` is empty.
 *
 * The state machine groups by
 *   user_key = profile_id -> __d_<device_id> -> __e_<event_id>
 * (funnel.service.ts, buildFunnelCte, group === 'event').
 *
 * The design's 实施边界 makes anonymous identity an explicit precondition for
 * shipping Event mode: "匿名身份及空 profile_id 的实际存储情况须在实现时用真实
 * 样本核对，不能将所有空值并成同一用户。"
 *
 * Every case below is built so that COLLAPSING all empty profile_ids into one
 * user flips the expected numbers — a merge regression cannot pass these.
 *
 * Requires a reachable ClickHouse; reports as skipped otherwise.
 */
import type { IChartEventItem, IFunnelStep } from '@openpanel/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ch } from '../clickhouse/client';
import { funnelService } from './funnel.service';

const PROJECT_ID = 'test-funnel-event-anon';
let chReachable = false;

const STEPS: IFunnelStep[] = [
  { id: 's1', eventIds: ['a'] },
  { id: 's2', eventIds: ['b'] },
];
const WINDOW = { start: '2026-07-01 00:00:00', end: '2026-07-10 23:59:59' };

/** Fixed so the `__e_<event_id>` fallback key is assertable by value. */
const NO_IDS_A = '30000000-0000-7000-8000-000000000031';
const NO_IDS_B = '30000000-0000-7000-8000-000000000032';

let seq = 0;
function row({
  user,
  name,
  createdAt,
  profileId = '',
  deviceId = '',
  id,
}: {
  user: string;
  name: string;
  createdAt: string;
  profileId?: string;
  deviceId?: string;
  id?: string;
}) {
  seq += 1;
  return {
    id: id ?? `30000000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    project_id: PROJECT_ID,
    name,
    profile_id: profileId,
    session_id: '',
    device_id: deviceId,
    created_at: createdAt,
    properties: { user },
    country: 'US',
    groups: [],
    imported_at: null,
  };
}

/** Both steps narrowed to one fixture group, so each case runs in isolation. */
const seriesFor = (user: string): IChartEventItem[] =>
  ['step_a', 'step_b'].map((name, index) => ({
    id: index === 0 ? 'a' : 'b',
    type: 'event',
    name,
    displayName: name,
    segment: 'event',
    filters: [
      { id: 'f', name: 'properties.user', operator: 'is', value: [user] },
    ],
  })) as IChartEventItem[];

async function runEventFunnel(user: string): Promise<number[]> {
  const [res] = await funnelService.getFunnel({
    projectId: PROJECT_ID,
    startDate: WINDOW.start,
    endDate: WINDOW.end,
    series: seriesFor(user),
    globalFilters: [],
    funnelSteps: STEPS,
    breakdowns: [],
    chartType: 'funnel',
    interval: 'day',
    range: 'custom',
    previous: false,
    metric: 'sum',
    options: {
      type: 'funnel',
      funnelWindow: 24,
      funnelGroup: 'event',
      funnelSteps: STEPS,
    },
    timezone: 'UTC',
  } as never);
  return res!.steps.map((s) => s.count);
}

/** The `user_key` each surviving entry was grouped under, ascending. */
async function entryKeys(user: string): Promise<string[]> {
  const { query } = await funnelService.buildFunnelBase({
    projectId: PROJECT_ID,
    startDate: WINDOW.start,
    endDate: WINDOW.end,
    series: seriesFor(user),
    funnelSteps: STEPS,
    funnelWindow: 24,
    funnelGroup: 'event',
    timezone: 'UTC',
  });
  query.with('funnel', 'SELECT * FROM session_funnel WHERE level != 0');
  query.select(['profile_id']).from('funnel').orderBy('profile_id', 'ASC');
  const rows = (await query.execute()) as { profile_id: string }[];
  return rows.map((r) => r.profile_id);
}

const TEST_EVENTS = [
  // 1) Two anonymous devices: A on device 1, B on device 2. Kept apart they are
  //    two users, so only the A device ever enters -> 1/0. Collapsed into one
  //    empty-profile user, device 2's B would complete device 1's entry -> 1/1.
  row({
    user: 'two-devices',
    name: 'step_a',
    createdAt: '2026-07-01 01:00:00',
    deviceId: 'anon-dev-1',
  }),
  row({
    user: 'two-devices',
    name: 'step_b',
    createdAt: '2026-07-01 02:00:00',
    deviceId: 'anon-dev-2',
  }),

  // 2) Positive control: one anonymous device, A then B. Proves `__d_` is a
  //    real grouping key rather than a filter that drops profile-less rows.
  row({
    user: 'same-device',
    name: 'step_a',
    createdAt: '2026-07-01 01:00:00',
    deviceId: 'anon-dev-same',
  }),
  row({
    user: 'same-device',
    name: 'step_b',
    createdAt: '2026-07-01 02:00:00',
    deviceId: 'anon-dev-same',
  }),

  // 3) No profile AND no device: each event becomes its own user (`__e_<id>`),
  //    so a lone A enters and a lone B has no entry to advance -> 1/0.
  row({
    user: 'no-ids',
    name: 'step_a',
    createdAt: '2026-07-01 01:00:00',
    id: NO_IDS_A,
  }),
  row({
    user: 'no-ids',
    name: 'step_b',
    createdAt: '2026-07-01 02:00:00',
    id: NO_IDS_B,
  }),

  // 4) One device, identified at step 1 and anonymous at step 2. profile_id
  //    outranks device_id, so these are two users and the anonymous B must not
  //    finish the identified user's funnel -> 1/0.
  row({
    user: 'profile-wins',
    name: 'step_a',
    createdAt: '2026-07-01 01:00:00',
    profileId: 'anon-user-4',
    deviceId: 'anon-dev-shared',
  }),
  row({
    user: 'profile-wins',
    name: 'step_b',
    createdAt: '2026-07-01 02:00:00',
    deviceId: 'anon-dev-shared',
  }),
];

beforeAll(async () => {
  try {
    await ch.command({ query: 'SELECT 1' });
    chReachable = true;
  } catch {
    chReachable = false;
    return;
  }

  // ClickHouse answered the probe, so everything below is real fixture setup:
  // let it throw and fail the suite loudly rather than degrade to "skipped",
  // which would hide schema drift or a rejected insert behind a green run.
  await ch.command({
    query: `DELETE FROM openpanel.events WHERE project_id = '${PROJECT_ID}'`,
  });
  await ch.insert({
    table: 'openpanel.events',
    values: TEST_EVENTS,
    format: 'JSONEachRow',
  });
});

afterAll(async () => {
  if (chReachable) {
    await ch.command({
      query: `DELETE FROM openpanel.events WHERE project_id = '${PROJECT_ID}'`,
    });
  }
});

// Reports as skipped rather than passed when CH is unreachable — a test that
// returns before asserting anything should not read as green. In CI a real
// ClickHouse is provisioned (docker-build.yml `clickhouse` service), so a skip
// there would mean the behavioural contract silently went unverified: fail instead.
const itCH = (name: string, fn: () => Promise<void>) =>
  it(name, async (ctx) => {
    if (!chReachable) {
      if (process.env.CI) {
        throw new Error(
          'ClickHouse unreachable at CLICKHOUSE_URL; CI must run these against a real server',
        );
      }
      ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    }
    await fn();
  });

describe('Funnel Event Grouping — empty / anonymous profile_id', () => {
  itCH('two anonymous devices are not merged into one user (1/0)', async () => {
    expect(await runEventFunnel('two-devices')).toEqual([1, 0]);
  });

  itCH('one anonymous device groups its own events (1/1)', async () => {
    expect(await runEventFunnel('same-device')).toEqual([1, 1]);
  });

  itCH('empty profile and empty device: each event is its own user (1/0)', async () => {
    expect(await runEventFunnel('no-ids')).toEqual([1, 0]);
  });

  itCH('profile_id outranks device_id, so the two do not merge (1/0)', async () => {
    expect(await runEventFunnel('profile-wins')).toEqual([1, 0]);
  });

  itCH('entries are keyed by __d_<device_id> / __e_<event_id>', async () => {
    expect(await entryKeys('same-device')).toEqual(['__d_anon-dev-same']);
    expect(await entryKeys('two-devices')).toEqual(['__d_anon-dev-1']);
    expect(await entryKeys('no-ids')).toEqual([`__e_${NO_IDS_A}`]);
    // Identified step-1 event keeps the raw profile_id, unprefixed.
    expect(await entryKeys('profile-wins')).toEqual(['anon-user-4']);
  });
});
