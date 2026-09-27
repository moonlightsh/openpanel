/**
 * Behavioural tests for Funnel Event Grouping against ClickHouse.
 *
 * Verifies the design doc contracts:
 * - A1 -> B1 -> A2 -> B2: Event mode yields 2/2; Session/Profile yields 1/1
 * - A1 -> A2 -> B1: Event mode yields 2/1 (B1 only advances one entry)
 * - A1 -> B1 -> B2: Event mode yields 1/1 (second B does not advance)
 * - A1 -> B1 outside 24h window: stops at level 1
 * - Breakdown attribution: each entry takes its breakdown value at step 1
 */
import type { IChartBreakdown, IChartEvent, IChartEventItem, IFunnelStep } from '@openpanel/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ch } from '../clickhouse/client';
import { funnelService } from './funnel.service';

const PROJECT_ID = 'test-funnel-event-group';

let chReachable = false;

let seq = 0;
function makeEvent(
  profileId: string,
  name: string,
  createdAt: string,
  properties: Record<string, string> = {}
) {
  seq += 1;
  return {
    id: `00000000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    project_id: PROJECT_ID,
    name,
    profile_id: profileId,
    session_id: `sess-${profileId}-1`,
    device_id: `dev-${profileId}`,
    created_at: createdAt,
    properties: { user: profileId, ...properties },
    country: 'US',
    groups: [],
    imported_at: null,
  };
}

const ev = (
  id: string,
  name: string,
  filters: IChartEvent['filters'] = []
): IChartEventItem => ({
  id,
  type: 'event',
  name,
  displayName: name,
  segment: 'event',
  filters,
});

const SERIES = [ev('a', 'step_a'), ev('b', 'step_b')];

const FUNNEL_STEPS: IFunnelStep[] = [
  { id: 's1', eventIds: ['a'] },
  { id: 's2', eventIds: ['b'] },
];

const WINDOW = {
  start: '2026-07-01 00:00:00',
  end: '2026-07-10 23:59:59',
};

async function runFunnel(overrides: {
  funnelGroup?: 'profile_id' | 'session_id' | 'event';
  breakdowns?: IChartBreakdown[];
  series?: IChartEventItem[];
  funnelSteps?: IFunnelStep[];
  funnelWindow?: number;
} = {}) {
  const result = await funnelService.getFunnel({
    projectId: PROJECT_ID,
    startDate: WINDOW.start,
    endDate: WINDOW.end,
    series: overrides.series ?? SERIES,
    globalFilters: [],
    funnelSteps: overrides.funnelSteps ?? FUNNEL_STEPS,
    breakdowns: overrides.breakdowns ?? [],
    chartType: 'funnel',
    interval: 'day',
    range: 'custom',
    previous: false,
    metric: 'sum',
    options: {
      type: 'funnel',
      funnelWindow: overrides.funnelWindow ?? 24,
      funnelGroup: overrides.funnelGroup ?? 'event',
      funnelSteps: overrides.funnelSteps ?? FUNNEL_STEPS,
    },
    timezone: 'UTC',
  } as never);
  return result;
}

beforeAll(async () => {
  try {
    await ch.command({ query: 'SELECT 1' });
    chReachable = true;

    // Clean up any stale data
    await ch.command({
      query: `DELETE FROM openpanel.events WHERE project_id = '${PROJECT_ID}'`,
    });

    // Dataset:
    // U1: A1@1h -> B1@2h -> A2@3h -> B2@4h  (A B A B)
    // U2: A1@1h -> A2@2h -> B1@3h           (A A B)
    // U3: A1@1h -> B1@2h -> B2@3h           (A B B)
    // U4: A1@1h -> B1@30h                   (window expiration: 29h > 24h)
    // U5: A1@1h (plan=pro) -> B1@2h (plan=free) -> A2@3h (plan=free) -> B2@4h (plan=pro)
    const testEvents = [
      // U1: A B A B
      makeEvent('eg-u1', 'step_a', '2026-07-01 01:00:00'),
      makeEvent('eg-u1', 'step_b', '2026-07-01 02:00:00'),
      makeEvent('eg-u1', 'step_a', '2026-07-01 03:00:00'),
      makeEvent('eg-u1', 'step_b', '2026-07-01 04:00:00'),

      // U2: A A B
      makeEvent('eg-u2', 'step_a', '2026-07-01 01:00:00'),
      makeEvent('eg-u2', 'step_a', '2026-07-01 02:00:00'),
      makeEvent('eg-u2', 'step_b', '2026-07-01 03:00:00'),

      // U3: A B B
      makeEvent('eg-u3', 'step_a', '2026-07-01 01:00:00'),
      makeEvent('eg-u3', 'step_b', '2026-07-01 02:00:00'),
      makeEvent('eg-u3', 'step_b', '2026-07-01 03:00:00'),

      // U4: A B (expired window)
      makeEvent('eg-u4', 'step_a', '2026-07-01 01:00:00'),
      makeEvent('eg-u4', 'step_b', '2026-07-02 06:00:00'), // 29 hours later

      // U5: breakdown attribution test
      makeEvent('eg-u5', 'step_a', '2026-07-03 01:00:00', { plan: 'pro' }),
      makeEvent('eg-u5', 'step_b', '2026-07-03 02:00:00', { plan: 'free' }),
      makeEvent('eg-u5', 'step_a', '2026-07-03 03:00:00', { plan: 'free' }),
      makeEvent('eg-u5', 'step_b', '2026-07-03 04:00:00', { plan: 'pro' }),

      // U6: A -> A (self-advancing step)
      makeEvent('eg-u6', 'step_a', '2026-07-04 01:00:00'),
      makeEvent('eg-u6', 'step_a', '2026-07-04 02:00:00'),

      // U7: Same timestamp ordering
      makeEvent('eg-u7', 'step_a', '2026-07-05 01:00:00'),
      makeEvent('eg-u7', 'step_b', '2026-07-05 01:00:00'),
    ];

    await ch.insert({
      table: 'openpanel.events',
      values: testEvents,
      format: 'JSONEachRow',
    });
  } catch (error) {
    // Only an unreachable ClickHouse is an environment gap worth skipping for.
    // Once `SELECT 1` has answered, a failing DELETE/INSERT is a real defect
    // (schema drift, permissions, malformed fixture) — rethrow so the suite
    // fails loudly instead of reporting every assertion as skipped.
    if (chReachable) {
      throw error;
    }
    chReachable = false;
  }
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

describe('Funnel Event Grouping — Behavioral Verification', () => {
  itCH('scenario A B A B (U1): event mode yields 2/2 vs session/profile mode 1/1', async () => {
    // Test U1 in isolation by filtering on properties.user = 'eg-u1'
    const [eventRes] = await runFunnel({
      funnelGroup: 'event',
      series: [
        ev('a', 'step_a', [{ id: 'f1', name: 'properties.user', operator: 'is', value: ['eg-u1'] }]),
        ev('b', 'step_b', [{ id: 'f2', name: 'properties.user', operator: 'is', value: ['eg-u1'] }]),
      ],
    });
    expect(eventRes!.funnelGroup).toBe('event');
    expect(eventRes!.totalEntries).toBe(2);
    expect(eventRes!.steps.map((s) => s.count)).toEqual([2, 2]);

    const [sessionRes] = await runFunnel({
      funnelGroup: 'session_id',
      series: [
        ev('a', 'step_a', [{ id: 'f1', name: 'properties.user', operator: 'is', value: ['eg-u1'] }]),
        ev('b', 'step_b', [{ id: 'f2', name: 'properties.user', operator: 'is', value: ['eg-u1'] }]),
      ],
    });
    expect(sessionRes!.funnelGroup).toBe('session_id');
    expect(sessionRes!.totalSessions).toBe(1);
    expect(sessionRes!.steps.map((s) => s.count)).toEqual([1, 1]);

    const [profileRes] = await runFunnel({
      funnelGroup: 'profile_id',
      series: [
        ev('a', 'step_a', [{ id: 'f1', name: 'properties.user', operator: 'is', value: ['eg-u1'] }]),
        ev('b', 'step_b', [{ id: 'f2', name: 'properties.user', operator: 'is', value: ['eg-u1'] }]),
      ],
    });
    expect(profileRes!.funnelGroup).toBe('profile_id');
    expect(profileRes!.totalSessions).toBe(1);
    expect(profileRes!.steps.map((s) => s.count)).toEqual([1, 1]);
  });

  itCH('scenario A A B (U2): event mode yields 2/1 (B1 only advances one entry)', async () => {
    const [eventRes] = await runFunnel({
      funnelGroup: 'event',
      series: [
        ev('a', 'step_a', [{ id: 'f1', name: 'properties.user', operator: 'is', value: ['eg-u2'] }]),
        ev('b', 'step_b', [{ id: 'f2', name: 'properties.user', operator: 'is', value: ['eg-u2'] }]),
      ],
    });
    expect(eventRes!.totalEntries).toBe(2);
    expect(eventRes!.steps.map((s) => s.count)).toEqual([2, 1]);
  });

  itCH('scenario A B B (U3): event mode yields 1/1 (second B does not advance)', async () => {
    const [eventRes] = await runFunnel({
      funnelGroup: 'event',
      series: [
        ev('a', 'step_a', [{ id: 'f1', name: 'properties.user', operator: 'is', value: ['eg-u3'] }]),
        ev('b', 'step_b', [{ id: 'f2', name: 'properties.user', operator: 'is', value: ['eg-u3'] }]),
      ],
    });
    expect(eventRes!.totalEntries).toBe(1);
    expect(eventRes!.steps.map((s) => s.count)).toEqual([1, 1]);
  });

  itCH('scenario window expiration (U4): event mode stops at level 1 (1/0)', async () => {
    const [eventRes] = await runFunnel({
      funnelGroup: 'event',
      funnelWindow: 24, // 24 hours
      series: [
        ev('a', 'step_a', [{ id: 'f1', name: 'properties.user', operator: 'is', value: ['eg-u4'] }]),
        ev('b', 'step_b', [{ id: 'f2', name: 'properties.user', operator: 'is', value: ['eg-u4'] }]),
      ],
    });
    expect(eventRes!.totalEntries).toBe(1);
    expect(eventRes!.steps.map((s) => s.count)).toEqual([1, 0]);
  });

  itCH('breakdown attribution at step 1 (U5): each entry takes step 1 attribute', async () => {
    // U5 has A(pro)->B(free)->A(free)->B(pro)
    // Entry 1 (created by A@1h) had plan=pro -> should be attributed to 'pro'
    // Entry 2 (created by A@3h) had plan=free -> should be attributed to 'free'
    const seriesList = await runFunnel({
      funnelGroup: 'event',
      breakdowns: [{ id: 'b1', name: 'properties.plan' }],
      series: [
        ev('a', 'step_a', [{ id: 'f1', name: 'properties.user', operator: 'is', value: ['eg-u5'] }]),
        ev('b', 'step_b', [{ id: 'f2', name: 'properties.user', operator: 'is', value: ['eg-u5'] }]),
      ],
    });

    expect(seriesList).toHaveLength(2);
    const proSeries = seriesList.find((s) => s.id === 'pro');
    const freeSeries = seriesList.find((s) => s.id === 'free');

    expect(proSeries).toBeDefined();
    expect(proSeries!.totalEntries).toBe(1);
    expect(proSeries!.steps.map((s) => s.count)).toEqual([1, 1]);

    expect(freeSeries).toBeDefined();
    expect(freeSeries!.totalEntries).toBe(1);
    expect(freeSeries!.steps.map((s) => s.count)).toEqual([1, 1]);
  });

  itCH('combined funnel across all users matches expected aggregate numbers', async () => {
    // U1: 2/2, U2: 2/1, U3: 1/1, U4: 1/0, U5: 2/2, U7: 1/0 (strict)
    // Note: U6 only has step_a, so U6 contributes 2 at step 1 and 0 at step 2.
    // Total step 1: U1(2) + U2(2) + U3(1) + U4(1) + U5(2) + U6(2) + U7(1) = 11
    // Total step 2: U1(2) + U2(1) + U3(1) + U4(0) + U5(2) + U6(0) + U7(0) = 6
    const [eventRes] = await runFunnel({ funnelGroup: 'event' });
    expect(eventRes!.funnelGroup).toBe('event');
    expect(eventRes!.totalEntries).toBe(11);
    expect(eventRes!.steps.map((s) => s.count)).toEqual([11, 6]);

    // Contrast with profile mode:
    // U1: 1/1, U2: 1/1, U3: 1/1, U4: 1/0, U5: 1/1, U6: 1/0, U7: 1/0
    // Total step 1 = 7, step 2 = 4
    const [profileRes] = await runFunnel({ funnelGroup: 'profile_id' });
    expect(profileRes!.funnelGroup).toBe('profile_id');
    expect(profileRes!.totalSessions).toBe(7);
    expect(profileRes!.steps.map((s) => s.count)).toEqual([7, 4]);
  });

  itCH('scenario A -> A (U6): current event advances prior entry while creating new entry', async () => {
    // Both steps look for step_a
    const [res] = await runFunnel({
      funnelGroup: 'event',
      series: [
        ev('a1', 'step_a', [{ id: 'f1', name: 'properties.user', operator: 'is', value: ['eg-u6'] }]),
        ev('a2', 'step_a', [{ id: 'f2', name: 'properties.user', operator: 'is', value: ['eg-u6'] }]),
      ],
      funnelSteps: [
        { id: 's1', eventIds: ['a1'] },
        { id: 's2', eventIds: ['a2'] },
      ],
    });
    // Event 1 creates Entry 1 at level 1.
    // Event 2 advances Entry 1 to level 2, and creates Entry 2 at level 1.
    // Total entries = 2, step 1 = 2, step 2 = 1.
    expect(res!.totalEntries).toBe(2);
    expect(res!.steps.map((s) => s.count)).toEqual([2, 1]);
  });

  itCH('scenario timestamp ordering: strict rejects same-ts; non-strict accepts', async () => {
    // In default strict mode, same-ts event does not advance
    const [strictRes] = await runFunnel({
      funnelGroup: 'event',
      series: [
        ev('a', 'step_a', [{ id: 'f1', name: 'properties.user', operator: 'is', value: ['eg-u7'] }]),
        ev('b', 'step_b', [{ id: 'f2', name: 'properties.user', operator: 'is', value: ['eg-u7'] }]),
      ],
    });
    expect(strictRes!.totalEntries).toBe(1);
    expect(strictRes!.steps.map((s) => s.count)).toEqual([1, 0]);

    // Enable non-strict mode
    process.env.FUNNEL_NON_STRICT_ORDERING = '1';
    try {
      const [nonStrictRes] = await runFunnel({
        funnelGroup: 'event',
        series: [
          ev('a', 'step_a', [{ id: 'f1', name: 'properties.user', operator: 'is', value: ['eg-u7'] }]),
          ev('b', 'step_b', [{ id: 'f2', name: 'properties.user', operator: 'is', value: ['eg-u7'] }]),
        ],
      });
      expect(nonStrictRes!.totalEntries).toBe(1);
      expect(nonStrictRes!.steps.map((s) => s.count)).toEqual([1, 1]);
    } finally {
      delete process.env.FUNNEL_NON_STRICT_ORDERING;
    }
  });

  itCH('profiles query in event mode: returns correct occurrence counts and dropoffs', async () => {
    // Build the query via buildFunnelBase
    const { query } = await funnelService.buildFunnelBase({
      projectId: PROJECT_ID,
      startDate: WINDOW.start,
      endDate: WINDOW.end,
      series: SERIES,
      funnelSteps: FUNNEL_STEPS,
      funnelWindow: 24,
      funnelGroup: 'event',
      timezone: 'UTC',
    });

    query.with('funnel', 'SELECT * FROM session_funnel WHERE level != 0');

    // Test 1: Completed step 1 (level >= 1)
    const step1Query = query
      .clone()
      .select(['profile_id', 'count() as occurrence_count'])
      .from('funnel')
      .where('level', '>=', 1)
      .groupBy(['profile_id'])
      .orderBy('occurrence_count', 'DESC')
      .orderBy('profile_id', 'ASC');

    const step1Profiles = (await step1Query.execute()) as {
      profile_id: string;
      occurrence_count: string | number;
    }[];

    const u1Step1 = step1Profiles.find((p) => p.profile_id === 'eg-u1');
    const u2Step1 = step1Profiles.find((p) => p.profile_id === 'eg-u2');
    const u3Step1 = step1Profiles.find((p) => p.profile_id === 'eg-u3');
    expect(Number(u1Step1?.occurrence_count)).toBe(2);
    expect(Number(u2Step1?.occurrence_count)).toBe(2);
    expect(Number(u3Step1?.occurrence_count)).toBe(1);

    // Test 2: Dropped off after step 1 (level = 1)
    const dropoff1Query = query
      .clone()
      .select(['profile_id', 'count() as occurrence_count'])
      .from('funnel')
      .where('level', '=', 1)
      .groupBy(['profile_id'])
      .orderBy('occurrence_count', 'DESC')
      .orderBy('profile_id', 'ASC');

    const dropoffProfiles = (await dropoff1Query.execute()) as {
      profile_id: string;
      occurrence_count: string | number;
    }[];

    // U2 had 2 entries: 1 reached level 2, 1 dropped off at level 1
    const u2Dropoff = dropoffProfiles.find((p) => p.profile_id === 'eg-u2');
    expect(Number(u2Dropoff?.occurrence_count)).toBe(1);

    // U1 had 2 entries: both reached level 2, so U1 should NOT appear in dropoff at step 1
    const u1Dropoff = dropoffProfiles.find((p) => p.profile_id === 'eg-u1');
    expect(u1Dropoff).toBeUndefined();

    // Test 3: Completed step 2 (level >= 2)
    const step2Query = query
      .clone()
      .select(['profile_id', 'count() as occurrence_count'])
      .from('funnel')
      .where('level', '>=', 2)
      .groupBy(['profile_id'])
      .orderBy('occurrence_count', 'DESC')
      .orderBy('profile_id', 'ASC');

    const step2Profiles = (await step2Query.execute()) as {
      profile_id: string;
      occurrence_count: string | number;
    }[];

    const u1Step2 = step2Profiles.find((p) => p.profile_id === 'eg-u1');
    const u2Step2 = step2Profiles.find((p) => p.profile_id === 'eg-u2');
    expect(Number(u1Step2?.occurrence_count)).toBe(2);
    expect(Number(u2Step2?.occurrence_count)).toBe(1);
  });
});
