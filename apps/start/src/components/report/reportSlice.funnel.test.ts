// Step editing is pure reducer logic and the riskiest part of the editor:
// series and funnelSteps must never drift apart. Exercise it directly.
import { describe, expect, it } from 'vitest';
import {
  addFunnelStep,
  addFunnelStepEvent,
  duplicateFunnelStep,
  removeFunnelStep,
  removeFunnelStepEvent,
  reorderFunnelSteps,
  reportSlice,
  selectFunnelConfigError,
  selectFunnelStepViews,
  setReport,
} from './reportSlice';

const { reducer } = reportSlice;

const event = (id: string, name: string) => ({
  id,
  type: 'event' as const,
  name,
  segment: 'event' as const,
  filters: [],
});

const legacyFunnel = {
  projectId: 'p1',
  name: 'Funnel',
  chartType: 'funnel' as const,
  lineType: 'monotone' as const,
  interval: 'day' as const,
  breakdowns: [],
  globalFilters: [],
  series: [event('a', 'e_a'), event('b', 'e_b')],
  range: '30d' as const,
  previous: false,
  metric: 'sum' as const,
  options: { type: 'funnel' as const },
};

const loaded = () => reducer(undefined, setReport(legacyFunnel as never));
const steps = (state: ReturnType<typeof loaded>) =>
  state.options?.type === 'funnel' ? state.options.funnelSteps : undefined;

describe('legacy funnel without funnelSteps', () => {
  it('is not rewritten on load', () => {
    expect(steps(loaded())).toBeUndefined();
  });

  it('still renders one step per event through the selector', () => {
    const views = selectFunnelStepViews({ report: loaded() } as never);
    expect(views.map((v) => v.events.map((e) => e.id))).toEqual([['a'], ['b']]);
    expect(views.map((v) => v.defaultDisplayName)).toEqual(['e_a', 'e_b']);
  });

  it('materializes funnelSteps on the first step-level edit', () => {
    const next = reducer(loaded(), addFunnelStep({ name: 'e_c' }));
    expect(steps(next)).toHaveLength(3);
    expect(next.series).toHaveLength(3);
    // The new event configuration is referenced by exactly the new step.
    const last = steps(next)!.at(-1)!;
    expect(last.eventIds).toHaveLength(1);
    expect(next.series.some((s) => s.id === last.eventIds[0])).toBe(true);
    expect(next.dirty).toBe(true);
  });
});

describe('step and alternate editing', () => {
  const withSteps = () => reducer(loaded(), addFunnelStep({ name: 'e_c' }));

  it('adds an alternate to an existing step and a series entry for it', () => {
    const state = withSteps();
    const stepId = steps(state)![1]!.id;
    const next = reducer(state, addFunnelStepEvent({ stepId, name: 'e_b2' }));
    const step = steps(next)!.find((s) => s.id === stepId)!;
    expect(step.eventIds).toHaveLength(2);
    expect(next.series).toHaveLength(4);
    expect(selectFunnelConfigError({ report: next } as never)).toBeNull();
  });

  it('removing an alternate drops its series entry but keeps the step', () => {
    const state = withSteps();
    const stepId = steps(state)![1]!.id;
    const added = reducer(state, addFunnelStepEvent({ stepId, name: 'e_b2' }));
    const removedId = steps(added)!.find((s) => s.id === stepId)!.eventIds[1]!;
    const next = reducer(added, removeFunnelStepEvent({ stepId, eventId: removedId }));
    expect(steps(next)!.find((s) => s.id === stepId)!.eventIds).toEqual(['b']);
    expect(next.series.some((s) => s.id === removedId)).toBe(false);
  });

  it('leaves an emptied step in place as an editable placeholder, but invalid', () => {
    const state = withSteps();
    const stepId = steps(state)![1]!.id;
    const next = reducer(state, removeFunnelStepEvent({ stepId, eventId: 'b' }));
    expect(steps(next)!.find((s) => s.id === stepId)!.eventIds).toEqual([]);
    expect(next.series.some((s) => s.id === 'b')).toBe(false);
    expect(selectFunnelConfigError({ report: next } as never)).toMatch(
      /has no events/,
    );
  });

  it('removing a step removes its event configurations', () => {
    const state = withSteps();
    const stepId = steps(state)![0]!.id;
    const next = reducer(state, removeFunnelStep({ stepId }));
    expect(steps(next)).toHaveLength(2);
    expect(next.series.some((s) => s.id === 'a')).toBe(false);
  });

  it('duplicating a step clones the step and its events under fresh ids', () => {
    const state = withSteps();
    const stepId = steps(state)![1]!.id;
    const next = reducer(state, duplicateFunnelStep({ stepId }));
    expect(steps(next)).toHaveLength(4);
    const ids = steps(next)!.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const allEventIds = steps(next)!.flatMap((s) => s.eventIds);
    expect(new Set(allEventIds).size).toBe(allEventIds.length);
    expect(selectFunnelConfigError({ report: next } as never)).toBeNull();
  });

  it('reorders steps without touching the alternates', () => {
    const state = withSteps();
    const before = steps(state)!.map((s) => s.id);
    const next = reducer(state, reorderFunnelSteps({ fromIndex: 0, toIndex: 2 }));
    expect(steps(next)!.map((s) => s.id)).toEqual([
      before[1],
      before[2],
      before[0],
    ]);
  });
});

import { addSerie, changeChartType } from './reportSlice';

describe('orphan events on chart-type round trip', () => {
  // funnel -> line -> add an event -> funnel. changeChartType keeps `options`,
  // so funnelSteps survives while the new event is referenced by no step.
  const roundTrip = () => {
    let state = reducer(loaded(), addFunnelStep({ name: 'e_c' }));
    state = reducer(state, changeChartType('linear'));
    state = reducer(
      state,
      addSerie({ type: 'event', name: 'stray', segment: 'event', filters: [] }),
    );
    return reducer(state, changeChartType('funnel'));
  };

  it('drops the orphan from series and reports it once', () => {
    const next = roundTrip();
    expect(next.series.some((s) => s.type === 'event' && s.name === 'stray')).toBe(
      false,
    );
    expect(next.funnelStepsNotice).toEqual(['stray']);
    expect(selectFunnelConfigError({ report: next } as never)).toBeNull();
  });

  it('drops references to events deleted while on another chart type', () => {
    let state = reducer(loaded(), addFunnelStep({ name: 'e_c' }));
    state = reducer(state, changeChartType('linear'));
    state = reducer(state, { type: 'report/removeEvent', payload: { id: 'b' } });
    state = reducer(state, changeChartType('funnel'));
    const emptied = steps(state)!.filter((s) => s.eventIds.length === 0);
    expect(emptied).toHaveLength(1);
    expect(selectFunnelConfigError({ report: state } as never)).toMatch(
      /has no events/,
    );
  });

  it('backfills stable ids on events migrated from an old report', () => {
    const legacyNoIds = {
      ...legacyFunnel,
      series: [
        { type: 'event', name: 'e_a', segment: 'event', filters: [] },
        { type: 'event', name: 'e_b', segment: 'event', filters: [] },
      ],
    };
    let state = reducer(undefined, setReport(legacyNoIds as never));
    state = reducer(state, addFunnelStep({ name: 'e_c' }));
    expect(state.series.every((s) => Boolean(s.id))).toBe(true);
    expect(new Set(state.series.map((s) => s.id)).size).toBe(3);
    expect(selectFunnelConfigError({ report: state } as never)).toBeNull();
  });
});
