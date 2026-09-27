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
  } catch {
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

describe('Funnel Event Grouping — duplicate storage rows', () => {
  it('duplicate first-step row does not create a second entry (1/1)', async () => {
    if (!chReachable) {
      return;
    }
    expect(await runEventFunnel('dup-first')).toEqual([1, 1]);
  });

  it('duplicate later-step row does not advance a second entry (2/1)', async () => {
    if (!chReachable) {
      return;
    }
    expect(await runEventFunnel('dup-later')).toEqual([2, 1]);
  });
});
