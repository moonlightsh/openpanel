/**
 * Behavioral tests for the event-mode funnel's handling of DUPLICATE storage
 * rows (same event id) — the design contract "事件 ID 相同的重复存储行不得制造
 * 多次进入/推进".
 *
 * `events` is a plain MergeTree read without FINAL, so a retried/double-flushed
 * insert leaves two identical rows sharing one id. The state machine
 * deduplicates by id before folding; these tests fail if that dedup regresses
 * (a duplicate would then create a spurious entry or advance a second one).
 *
 * Requires a reachable ClickHouse; auto-skips otherwise.
 */
import type { IChartEventItem, IFunnelStep } from '@openpanel/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ch } from '../clickhouse/client';
import { funnelService } from './funnel.service';

const PROJECT_ID = 'test-funnel-event-dedup';
let chReachable = false;

const ev = (id: string, name: string): IChartEventItem => ({
  id,
  type: 'event',
  name,
  displayName: name,
  segment: 'event',
  filters: [],
});
const STEPS: IFunnelStep[] = [
  { id: 's1', eventIds: ['a'] },
  { id: 's2', eventIds: ['b'] },
];
const WINDOW = { start: '2026-07-01 00:00:00', end: '2026-07-10 23:59:59' };

let seq = 0;
function row(profileId: string, name: string, createdAt: string, id?: string) {
  seq += 1;
  return {
    id: id ?? `20000000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    project_id: PROJECT_ID,
    name,
    profile_id: profileId,
    session_id: `s-${profileId}`,
    device_id: `d-${profileId}`,
    created_at: createdAt,
    properties: { user: profileId },
    country: 'US',
    groups: [],
    imported_at: null,
  };
}

async function runEventFunnel(user: string) {
  const [res] = await funnelService.getFunnel({
    projectId: PROJECT_ID,
    startDate: WINDOW.start,
    endDate: WINDOW.end,
    series: [ev('a', 'step_a'), ev('b', 'step_b')].map((e) => ({
      ...e,
      filters: [
        { id: 'f', name: 'properties.user', operator: 'is', value: [user] },
      ],
    })) as IChartEventItem[],
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

beforeAll(async () => {
  try {
    await ch.command({ query: 'SELECT 1' });
    chReachable = true;
    await ch.command({
      query: `DELETE FROM openpanel.events WHERE project_id = '${PROJECT_ID}'`,
    });

    // A duplicated FIRST-step row (same id) must not create a second entry.
    const aDup = row('dup-first', 'step_a', '2026-07-01 01:00:00');
    // A duplicated LATER-step row (same id) must not advance a second entry.
    const bDup = row('dup-later', 'step_b', '2026-07-01 03:00:00');

    const events = [
      // dup-first: A, A(dup of the first A), B  -> expect 1/1
      aDup,
      { ...aDup }, // byte-identical duplicate storage row (same id)
      row('dup-first', 'step_b', '2026-07-01 02:00:00'),

      // dup-later: A, A, B, B(dup of that B) -> expect 2/1
      row('dup-later', 'step_a', '2026-07-01 01:00:00'),
      row('dup-later', 'step_a', '2026-07-01 02:00:00'),
      bDup,
      { ...bDup }, // duplicate storage row of B (same id)
    ];

    await ch.insert({
      table: 'openpanel.events',
      values: events,
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

describe('Funnel Event Grouping — duplicate storage rows', () => {
  itCH('duplicate first-step row does not create a second entry (1/1)', async () => {
    expect(await runEventFunnel('dup-first')).toEqual([1, 1]);
  });

  itCH('duplicate later-step row does not advance a second entry (2/1)', async () => {
    expect(await runEventFunnel('dup-later')).toEqual([2, 1]);
  });
});
