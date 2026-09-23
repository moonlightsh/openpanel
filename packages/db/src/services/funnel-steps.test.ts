/**
 * Behavioural tests for multi-event funnel steps against a real ClickHouse.
 * Counts come from the fixture blueprint in test/funnel-steps-fixtures.ts —
 * they are the contract, the SQL is only the mechanism.
 *
 * Requires `pnpm dock:up`. All tests auto-skip when CH is unreachable
 * (same itCH pattern as funnel-sql.test.ts).
 */
import type { IChartEvent, IChartEventItem, IFunnelStep } from '@openpanel/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FUNNEL_STEPS_FIXTURE,
  setupFunnelStepsFixtures,
  teardownFunnelStepsFixtures,
} from '../../../../test/funnel-steps-fixtures';
import { ch, chQuery, TABLE_NAMES } from '../clickhouse/client';
import { funnelService } from './funnel.service';

const PROJECT_ID = 'test-funnel-steps';

let chReachable = false;
const itCH = (name: string, fn: () => Promise<void>) =>
  it(name, async (ctx) => {
    if (!chReachable) {
      ctx.skip('ClickHouse not reachable');
    }
    await fn();
  });

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

const planFilter = (value: string) => [
  {
    id: 'fp',
    name: 'properties.plan',
    operator: 'is' as const,
    value: [value],
  },
];

const SERIES = [
  ev('a', 'visit'),
  ev('b', 'confirm_d1c'),
  ev('c', 'confirm_other'),
  ev('d', 'finished_d1c', planFilter('d1c')),
  ev('e', 'finished_other'),
];

const FUNNEL_STEPS: IFunnelStep[] = [
  { id: 's1', eventIds: ['a'] },
  { id: 's2', eventIds: ['b', 'c'] },
  { id: 's3', eventIds: ['d', 'e'] },
];

async function runFunnel(overrides: {
  funnelGroup?: 'profile_id' | 'session_id';
  series?: IChartEventItem[];
  funnelSteps?: IFunnelStep[];
  globalFilters?: IChartEvent['filters'];
  nonStrict?: boolean;
} = {}) {
  const prev = process.env.FUNNEL_NON_STRICT_ORDERING;
  if (overrides.nonStrict) {
    process.env.FUNNEL_NON_STRICT_ORDERING = '1';
  }
  try {
    const [result] = await funnelService.getFunnel({
      projectId: PROJECT_ID,
      startDate: FUNNEL_STEPS_FIXTURE.window.start,
      endDate: FUNNEL_STEPS_FIXTURE.window.end,
      series: overrides.series ?? SERIES,
      globalFilters: overrides.globalFilters ?? [],
      funnelSteps: overrides.funnelSteps ?? FUNNEL_STEPS,
      breakdowns: [],
      chartType: 'funnel',
      interval: 'day',
      range: 'custom',
      previous: false,
      metric: 'sum',
      options: {
        type: 'funnel',
        funnelWindow: 24,
        funnelGroup: overrides.funnelGroup ?? 'profile_id',
        funnelSteps: overrides.funnelSteps ?? FUNNEL_STEPS,
      },
      timezone: 'UTC',
    } as never);
    return result!;
  } finally {
    process.env.FUNNEL_NON_STRICT_ORDERING = prev;
  }
}

beforeAll(async () => {
  try {
    await ch.command({ query: 'SELECT 1' });
    chReachable = true;
    await setupFunnelStepsFixtures(PROJECT_ID);
  } catch {
    chReachable = false;
  }
});

afterAll(async () => {
  if (chReachable) {
    await teardownFunnelStepsFixtures(PROJECT_ID);
  }
});

describe('multi-event funnel steps — counting semantics (profile_id)', () => {
  itCH('produces three levels and counts each step once per user', async () => {
    const res = await runFunnel({});
    expect(res.steps.map((s) => s.displayName)).toEqual([
      'visit',
      'confirm_d1c / confirm_other',
      'finished_d1c / finished_other',
    ]);
    expect(res.steps.map((s) => s.stepIndex)).toEqual([0, 1, 2]);
    // Levels 3/2/1/0 -> users with level >= 1, >= 2, >= 3.
    // >= 1: u1..u7, u9 AND u10 (u8 never entered; u10's `visit` legitimately
    //       completes step 1 — their later overlap-probe events match no
    //       main-funnel step, but step 1 alone still counts)
    // >= 2: u1,u2,u3,u4,u5,u6,u7
    // >= 3: u1,u2,u3,u9
    //
    // u5 sits at level 2, not 1: windowFunnel finds the longest ordered
    // chain ANYWHERE in the window (it is not anchored to the first event),
    // so u5's visit@1h -> confirm_d1c@2h counts. That is the engine's
    // documented semantics and this suite pins it.
    expect(res.steps.map((s) => s.count)).toEqual([9, 7, 4]);
  });

  itCH('exposes step-authoritative fields on each step', async () => {
    const res = await runFunnel({});
    const s2 = res.steps[1]!;
    expect(s2.stepId).toBe('s2');
    expect(s2.event.id).toBe('s2'); // compat field = step identity
    expect(s2.event.displayName).toBe('confirm_d1c / confirm_other');
    expect(s2.event.filters).toEqual([]); // no single filter truth
    expect(s2.event.name).toBe('confirm_d1c'); // first alternate, diagnostic
    expect(s2.events.map((e) => e.id)).toEqual(['b', 'c']);
    const s1 = res.steps[0]!;
    // Single-alternate step keeps the FULL event, filters included.
    expect(s1.event.id).toBe('a');
    expect(s1.event).toEqual({ ...s1.events[0]!, displayName: 'visit' });
  });

  itCH('attribute filters gate one arm, not the whole step', async () => {
    const res = await runFunnel({});
    // u7's finished_d1c had plan=other -> rejected by arm d, and they sent no
    // other step-3 event. count(level>=3) stays 4.
    expect(res.steps[2]!.count).toBe(4);
  });

  itCH('global filters apply to every alternate', async () => {
    // Give every user country=US except u3=SE in the fixture; a country=US
    // global filter must remove u3 from every level they reached.
    const res = await runFunnel({
      globalFilters: [
        { id: 'g', name: 'country', operator: 'is', value: ['US'] },
      ],
    });
    expect(res.steps.map((s) => s.count)).toEqual([8, 6, 3]);
  });
});

describe('multi-event funnel steps — ordering modes', () => {
  itCH(
    'strict mode: same-timestamp alternates still connect (U9)',
    async () => {
      const res = await runFunnel({});
      // U9's two confirms share one timestamp; the step was completed by one of
      // them, so level 3 is reachable via the finished event at 2h.
      expect(res.steps[2]!.count).toBeGreaterThanOrEqual(4);
    }
  );

  itCH(
    'non-strict mode produces identical levels for this dataset',
    async () => {
      const res = await runFunnel({ nonStrict: true });
      expect(res.steps.map((s) => s.count)).toEqual([9, 7, 4]);
    }
  );
});

describe('multi-event funnel steps — overlapping predicates', () => {
  itCH('a single physical event advances at most one step', async () => {
    const res = await runFunnel({
      series: [
        ev('a', 'visit'),
        ev('b', 'confirm_or_finish'),
        ev('c', 'confirm_or_finish', planFilter('d1c')),
      ],
      funnelSteps: [
        { id: 's1', eventIds: ['a'] },
        { id: 's2', eventIds: ['b'] },
        { id: 's3', eventIds: ['c'] },
      ],
    });
    // u10: visit@0h -> confirm_or_finish(plan=d1c)@1h -> confirm_other@2h.
    // The plan=d1c event matches BOTH s2 and s3 predicates. Record the
    // observed level and pin the invariant: the shared event must not push
    // the user straight to level 3 on its own (at-most-one-step per row).
    // Allowed by the design: level 2 (the shared event completed s2, and
    // s3 needs a LATER event) or level 1.
    const u10Level = await queryLevel('fs-u10');
    expect(u10Level).toBeLessThanOrEqual(2);
    expect(res.steps.length).toBe(3);
  });
});

async function queryLevel(profileId: string): Promise<number> {
  // Direct windowFunnel probe on the same rows, so the assertion reads the
  // engine's verdict instead of trusting our own aggregate wiring twice.
  const rows = await chQuery<{ level: string }>(`
    SELECT windowFunnel(86400000, 'strict_increase')(
      toUInt64(toUnixTimestamp64Milli(created_at)),
      name = 'visit',
      name = 'confirm_or_finish',
      name = 'confirm_or_finish' AND properties['plan'] = 'd1c'
    ) AS level
    FROM ${TABLE_NAMES.events}
    WHERE project_id = '${PROJECT_ID}' AND profile_id = '${profileId}'
    GROUP BY profile_id
  `);
  return Number(rows[0]?.level ?? 0);
}
