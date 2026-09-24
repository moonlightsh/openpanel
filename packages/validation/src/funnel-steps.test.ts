import { describe, expect, it } from 'vitest';
import {
  FUNNEL_MAX_EVENTS,
  FunnelConfigError,
  assertFunnelConfig,
  defaultStepDisplayName,
  getFunnelConfigError,
  resolveFunnelSteps,
} from './funnel-steps';

const ev = (id: string, name = `e_${id}`, displayName?: string) => ({
  id,
  type: 'event' as const,
  name,
  displayName,
  segment: 'event' as const,
  filters: [],
});

describe('resolveFunnelSteps — compat view (no funnelSteps)', () => {
  it('produces one step per event, preserving order and identity', () => {
    const series = [ev('a'), ev('b', 'e_b', 'Signed up')];
    const { steps, eventSeries } = resolveFunnelSteps({ series });
    expect(steps.map((s) => [s.id, s.displayName, s.stepIndex])).toEqual([
      ['a', 'e_a', 0],
      ['b', 'Signed up', 1],
    ]);
    // The event object must be the very same reference, so the compat
    // `event` field downstream stays byte-identical for old reports.
    expect(steps[0]!.events[0]).toBe(series[0]);
    expect(eventSeries).toEqual(series);
  });

  it('falls back to a positional step id when the event has none', () => {
    const { steps } = resolveFunnelSteps({
      series: [{ name: 'e_a' }],
    });
    expect(steps[0]!.id).toBe('step-0');
  });
});

describe('resolveFunnelSteps — explicit funnelSteps', () => {
  const series = [ev('a'), ev('b'), ev('c'), ev('d'), ev('e')];
  const steps = [
    { id: 's1', displayName: '云存曝光', eventIds: ['a'] },
    { id: 's2', eventIds: ['b', 'c'] },
    { id: 's3', displayName: '完成', eventIds: ['d', 'e'] },
  ];

  it('resolves step order, alternates and display names', () => {
    const res = resolveFunnelSteps({ series, funnelSteps: steps });
    expect(res.steps.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(res.steps.map((s) => s.displayName)).toEqual([
      '云存曝光',
      'e_b / e_c', // no user name -> joined event names
      '完成',
    ]);
    expect(res.steps.map((s) => s.stepIndex)).toEqual([0, 1, 2]);
    expect(res.steps[1]!.events.map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('returns eventSeries in step order, pruned to referenced events', () => {
    const res = resolveFunnelSteps({
      series: [...series, ev('orphan')],
      funnelSteps: steps,
    });
    expect(res.eventSeries.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('deduplicates the display name of same-named alternates', () => {
    const res = resolveFunnelSteps({
      series: [ev('a'), ev('b', 'confirm'), ev('c', 'confirm')],
      funnelSteps: [
        { id: 's1', eventIds: ['a'] },
        { id: 's2', eventIds: ['b', 'c'] },
      ],
    });
    expect(res.steps[1]!.displayName).toBe('confirm');
  });
});

describe('resolveFunnelSteps — rejections', () => {
  const series = [ev('a'), ev('b')];

  it('rejects an empty funnelSteps array instead of falling back', () => {
    expect(() =>
      resolveFunnelSteps({ series, funnelSteps: [] }),
    ).toThrow(FunnelConfigError);
  });

  it('rejects a step with no events', () => {
    expect(() =>
      resolveFunnelSteps({ series, funnelSteps: [{ id: 's1', eventIds: [] }] }),
    ).toThrow(/has no events/);
  });

  it('rejects a dangling event reference', () => {
    expect(() =>
      resolveFunnelSteps({
        series,
        funnelSteps: [{ id: 's1', eventIds: ['nope'] }],
      }),
    ).toThrow(/unknown event configuration nope/);
  });

  it('rejects an event referenced by two steps', () => {
    expect(() =>
      resolveFunnelSteps({
        series,
        funnelSteps: [
          { id: 's1', eventIds: ['a'] },
          { id: 's2', eventIds: ['a', 'b'] },
        ],
      }),
    ).toThrow(/more than one funnel step/);
  });

  it('rejects duplicate step ids', () => {
    expect(() =>
      resolveFunnelSteps({
        series,
        funnelSteps: [
          { id: 's1', eventIds: ['a'] },
          { id: 's1', eventIds: ['b'] },
        ],
      }),
    ).toThrow(/Duplicate funnel step id/);
  });

  it('rejects a series item without an id when funnelSteps is set', () => {
    expect(() =>
      resolveFunnelSteps({
        series: [{ name: 'e_a' }],
        funnelSteps: [{ id: 's1', eventIds: ['a'] }],
      }),
    ).toThrow(/needs an id/);
  });

  it('rejects duplicate series ids when funnelSteps is set', () => {
    expect(() =>
      resolveFunnelSteps({
        series: [ev('a'), ev('a', 'other')],
        funnelSteps: [{ id: 's1', eventIds: ['a'] }],
      }),
    ).toThrow(/Duplicate event configuration id/);
  });

  it('accepts exactly FUNNEL_MAX_EVENTS events and rejects one more', () => {
    const many = Array.from({ length: FUNNEL_MAX_EVENTS }, (_, i) =>
      ev(`id${i}`),
    );
    expect(() => resolveFunnelSteps({ series: many })).not.toThrow();
    expect(() =>
      resolveFunnelSteps({ series: [...many, ev('overflow')] }),
    ).toThrow(/at most 26 event configurations/);
  });
});

describe('assertFunnelConfig / getFunnelConfigError', () => {
  it('ignores non-funnel reports', () => {
    expect(() =>
      assertFunnelConfig({
        chartType: 'linear',
        series: Array.from({ length: 40 }, (_, i) => ev(`id${i}`)),
      }),
    ).not.toThrow();
  });

  it('counts every series item against the cap, formulas included', () => {
    const series = [
      ...Array.from({ length: 26 }, (_, i) => ev(`id${i}`)),
      { type: 'formula' as const, id: 'f', formula: 'A' },
    ];
    expect(getFunnelConfigError({ chartType: 'funnel', series })).toMatch(
      /at most 26/,
    );
  });

  it('returns null for a valid funnel and a message for an empty step', () => {
    const series = [ev('a')];
    expect(
      getFunnelConfigError({
        chartType: 'funnel',
        series,
        options: { type: 'funnel', funnelSteps: [{ id: 's1', eventIds: ['a'] }] },
      }),
    ).toBeNull();
    expect(
      getFunnelConfigError({
        chartType: 'funnel',
        series,
        options: { type: 'funnel', funnelSteps: [{ id: 's1', eventIds: [] }] },
      }),
    ).toMatch(/has no events/);
  });
});

describe('defaultStepDisplayName', () => {
  it('prefers the display name for a single event', () => {
    expect(defaultStepDisplayName([{ name: 'x', displayName: 'X' }])).toBe('X');
  });
});
