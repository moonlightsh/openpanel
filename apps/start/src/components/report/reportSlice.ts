import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';

import { shortId } from '@openpanel/common';
import {
  getDefaultIntervalByDates,
  getDefaultIntervalByRange,
  isHourIntervalEnabledByRange,
  isMinuteIntervalEnabledByRange,
} from '@openpanel/constants';
import {
  type IFunnelStep,
  defaultStepDisplayName,
  getFunnelConfigError,
} from '@openpanel/validation';
import type {
  IChartBreakdown,
  IChartEventFilter,
  IChartEventItem,
  IChartLineType,
  IChartMetric,
  IChartRange,
  IChartType,
  IInterval,
  IReport,
  IReportOptions,
  UnionOmit,
  zCriteria,
} from '@openpanel/validation';
import type { z } from 'zod';

type InitialState = IReport & {
  id?: string;
  dirty: boolean;
  ready: boolean;
  startDate: string | null;
  endDate: string | null;
  // Always an array in state (initialState + setReport guarantee it) so the
  // reducers below can push/map without optional-chaining.
  globalFilters: IChartEventFilter[];
  /**
   * Event configurations dropped as orphans the last time the funnel editor
   * was entered, for a one-time notice. Transient UI state: `zReport` strips
   * it on save, like `dirty` / `ready`.
   */
  funnelStepsNotice: string[];
};

// First approach: define the initial state using that type
const initialState: InitialState = {
  ready: false,
  dirty: false,
  projectId: '',
  name: '',
  chartType: 'linear',
  lineType: 'monotone',
  interval: 'day',
  breakdowns: [],
  globalFilters: [],
  series: [],
  range: '30d',
  startDate: null,
  endDate: null,
  previous: false,
  formula: undefined,
  unit: undefined,
  metric: 'sum',
  limit: 500,
  options: undefined,
  visibleSeries: undefined,
  funnelStepsNotice: [],
};

type FunnelOptions = Extract<IReportOptions, { type: 'funnel' }>;

function ensureFunnelOptions(state: InitialState): FunnelOptions {
  if (!state.options || state.options.type !== 'funnel') {
    state.options = { type: 'funnel' };
  }
  return state.options as FunnelOptions;
}

function assignMissingIds(state: InitialState) {
  for (const item of state.series) {
    if (!item.id) {
      // funnelSteps references must survive reordering, so a funnel can never
      // rely on the positional alphabetId backfill the read path applies.
      item.id = shortId();
    }
  }
}

/**
 * Lazily turn a legacy funnel (flat series, no funnelSteps) into the explicit
 * step shape, one event per step, preserving the current series order.
 *
 * Called by every step-level edit so that merely OPENING an old report never
 * writes the new field — only editing it does.
 */
function materializeFunnelSteps(state: InitialState): IFunnelStep[] {
  const options = ensureFunnelOptions(state);
  if (options.funnelSteps) {
    return options.funnelSteps;
  }
  const legacyEvents = state.series.filter((item) => item.type === 'event');
  // Match the ids already used by selectFunnelStepViews. The first edit of a
  // legacy step must not remount its card and drop focus from the name field.
  const stepIds = legacyEvents.map((item, index) => item.id ?? `step-${index}`);
  assignMissingIds(state);
  options.funnelSteps = legacyEvents.map((item, index) => ({
    id: stepIds[index]!,
    eventIds: [item.id!],
  }));
  return options.funnelSteps;
}

function findStep(steps: IFunnelStep[], stepId: string) {
  return steps.find((step) => step.id === stepId);
}

function dropSeriesByIds(state: InitialState, ids: Set<string>) {
  state.series = state.series.filter((item) => !item.id || !ids.has(item.id));
}

/**
 * Bring `funnelSteps` and the flat `series` back in sync when the funnel editor
 * is (re)entered.
 *
 * `changeChartType` deliberately keeps `options`, so a report can come back to
 * the funnel with events added or removed under another chart type. Recovery
 * rules, matching the design doc:
 *   - references to deleted events are dropped;
 *   - a step emptied that way stays as an editable placeholder (and reads as
 *     invalid, so it cannot be previewed or saved);
 *   - orphan events are removed from the funnel's series and reported once.
 * Reports without funnelSteps are untouched.
 */
function reconcileFunnelSteps(state: InitialState) {
  state.funnelStepsNotice = [];
  if (state.chartType !== 'funnel') {
    return;
  }
  const options = state.options?.type === 'funnel' ? state.options : undefined;
  const existing = options?.funnelSteps;
  if (!options || !existing) {
    return;
  }

  assignMissingIds(state);

  const known = new Set(
    state.series.filter((item) => item.type === 'event').map((item) => item.id!),
  );
  const claimed = new Set<string>();
  options.funnelSteps = existing.map((step) => ({
    ...step,
    eventIds: step.eventIds.filter((id) => {
      if (!known.has(id) || claimed.has(id)) {
        return false;
      }
      claimed.add(id);
      return true;
    }),
  }));

  const orphans = state.series.filter(
    (item) => item.type === 'event' && !claimed.has(item.id!),
  );
  if (orphans.length === 0) {
    return;
  }
  state.funnelStepsNotice = orphans.map((item) =>
    item.type === 'event' ? item.displayName || item.name : '',
  );
  // Formulas are left alone: the funnel ignores them (onlyReportEvents) and
  // silently deleting a user's formula on a chart-type round trip would be a
  // worse surprise than carrying it.
  dropSeriesByIds(
    state,
    new Set(orphans.map((item) => item.id!)),
  );
}

export const reportSlice = createSlice({
  name: 'report',
  initialState,
  reducers: {
    resetDirty(state) {
      return {
        ...state,
        dirty: false,
      };
    },
    reset() {
      return initialState;
    },
    ready() {
      return {
        ...initialState,
        ready: true,
      };
    },
    setReport(state, action: PayloadAction<IReport>) {
      const next: InitialState = {
        ...state,
        ...action.payload,
        globalFilters: action.payload.globalFilters ?? [],
        startDate: action.payload.startDate ?? null,
        endDate: action.payload.endDate ?? null,
        dirty: false,
        ready: true,
        funnelStepsNotice: [],
      };
      // reconcileFunnelSteps writes into `options`, but the spread above keeps
      // the frozen options object from the previous state (redux freezes
      // nested state). Clone it so reconciliation can mutate safely.
      if (next.options) {
        next.options = {
          ...next.options,
          ...(next.options.type === 'funnel' && next.options.funnelSteps
            ? { funnelSteps: next.options.funnelSteps.map((step) => ({ ...step })) }
            : {}),
        };
      }
      // A saved report can already contain orphans (saved before this
      // reconciliation existed, or written by another client).
      reconcileFunnelSteps(next);
      return next;
    },
    setName(state, action: PayloadAction<string>) {
      state.dirty = true;
      state.name = action.payload;
    },
    // Series (Events and Formulas)
    addSerie: (
      state,
      action: PayloadAction<UnionOmit<IChartEventItem, 'id'>>,
    ) => {
      state.dirty = true;
      state.series.push({
        id: shortId(),
        ...action.payload,
      });
    },
    duplicateEvent: (state, action: PayloadAction<IChartEventItem>) => {
      state.dirty = true;
      if (action.payload.type === 'event') {
        state.series.push({
          ...action.payload,
          filters: action.payload.filters.map((filter) => ({
            ...filter,
            id: shortId(),
          })),
          id: shortId(),
        } as IChartEventItem);
      } else {
        state.series.push({
          ...action.payload,
          id: shortId(),
        } as IChartEventItem);
      }
    },
    removeEvent: (
      state,
      action: PayloadAction<{
        id?: string;
      }>,
    ) => {
      state.dirty = true;
      state.series = state.series.filter((event) => {
        return event.id !== action.payload.id;
      });
    },
    changeEvent: (state, action: PayloadAction<IChartEventItem>) => {
      state.dirty = true;
      state.series = state.series.map((event) => {
        if (event.id === action.payload.id) {
          return action.payload;
        }
        return event;
      });
    },

    // Previous
    changePrevious: (state, action: PayloadAction<boolean>) => {
      state.dirty = true;
      state.previous = action.payload;
    },

    // Breakdowns
    addBreakdown: (
      state,
      action: PayloadAction<Omit<IChartBreakdown, 'id'>>,
    ) => {
      state.dirty = true;
      state.breakdowns.push({
        id: shortId(),
        ...action.payload,
      });
    },
    removeBreakdown: (
      state,
      action: PayloadAction<{
        id?: string;
      }>,
    ) => {
      state.dirty = true;
      state.breakdowns = state.breakdowns.filter(
        (event) => event.id !== action.payload.id,
      );
    },
    changeBreakdown: (state, action: PayloadAction<IChartBreakdown>) => {
      state.dirty = true;
      state.breakdowns = state.breakdowns.map((breakdown) => {
        if (breakdown.id === action.payload.id) {
          return action.payload;
        }
        return breakdown;
      });
    },

    // Global filters (applied to every event series in the report)
    addGlobalFilter: (state, action: PayloadAction<IChartEventFilter>) => {
      state.dirty = true;
      state.globalFilters.push(action.payload);
    },
    removeGlobalFilter: (state, action: PayloadAction<{ id?: string }>) => {
      state.dirty = true;
      state.globalFilters = state.globalFilters.filter(
        (filter) => filter.id !== action.payload.id,
      );
    },
    changeGlobalFilter: (state, action: PayloadAction<IChartEventFilter>) => {
      state.dirty = true;
      state.globalFilters = state.globalFilters.map((filter) =>
        filter.id === action.payload.id ? action.payload : filter,
      );
    },

    // Interval
    changeInterval: (state, action: PayloadAction<IInterval>) => {
      state.dirty = true;
      state.interval = action.payload;
    },

    // Chart type
    changeChartType: (state, action: PayloadAction<IChartType>) => {
      state.dirty = true;
      state.chartType = action.payload;

      // The Metric card has always shown the total unique count. Existing
      // reports are backfilled to 'count' by migration, so default a newly
      // switched one the same way rather than leaving old and new metric
      // reports showing different aggregations. The picker overrides it.
      if (action.payload === 'metric') {
        state.metric = 'count';
      }

      // Initialize sankey options if switching to sankey
      if (action.payload === 'sankey' && !state.options) {
        state.options = {
          type: 'sankey',
          mode: 'after',
          steps: 5,
          exclude: [],
        };
      }

      // Entering the funnel: recover a step config that drifted while the
      // report was another chart type.
      if (action.payload === 'funnel') {
        reconcileFunnelSteps(state);
      }

      if (
        !isMinuteIntervalEnabledByRange(state.range) &&
        state.interval === 'minute'
      ) {
        state.interval = 'hour';
      }

      if (
        !isHourIntervalEnabledByRange(state.range) &&
        state.interval === 'hour'
      ) {
        state.interval = 'day';
      }
    },

    // Line type
    changeLineType: (state, action: PayloadAction<IChartLineType>) => {
      state.dirty = true;
      state.lineType = action.payload;
    },

    // Date range
    changeStartDate: (state, action: PayloadAction<string>) => {
      state.dirty = true;
      state.startDate = action.payload;

      const interval = getDefaultIntervalByDates(
        state.startDate,
        state.endDate,
      );
      if (interval) {
        state.interval = interval;
      }
    },

    // Date range
    changeEndDate: (state, action: PayloadAction<string>) => {
      state.dirty = true;
      state.endDate = action.payload;

      const interval = getDefaultIntervalByDates(
        state.startDate,
        state.endDate,
      );
      if (interval) {
        state.interval = interval;
      }
    },

    changeDateRanges: (state, action: PayloadAction<IChartRange>) => {
      state.dirty = true;
      state.range = action.payload;
      if (action.payload !== 'custom') {
        state.startDate = null;
        state.endDate = null;
        state.interval = getDefaultIntervalByRange(action.payload);
      }
    },

    // Formula
    changeFormula: (state, action: PayloadAction<string>) => {
      state.dirty = true;
      state.formula = action.payload;
    },

    changeCriteria(state, action: PayloadAction<z.infer<typeof zCriteria>>) {
      state.dirty = true;
      if (!state.options || state.options.type !== 'retention') {
        state.options = {
          type: 'retention',
          criteria: action.payload,
        };
      } else {
        state.options.criteria = action.payload;
      }
    },

    changeUnit(state, action: PayloadAction<string | undefined>) {
      state.dirty = true;
      state.unit = action.payload || undefined;
    },

    changeMetric(state, action: PayloadAction<IChartMetric>) {
      state.dirty = true;
      state.metric = action.payload;
    },

    changeFunnelGroup(state, action: PayloadAction<string | undefined>) {
      state.dirty = true;
      if (!state.options || state.options.type !== 'funnel') {
        state.options = {
          type: 'funnel',
          funnelGroup: action.payload,
          funnelWindow: undefined,
        };
      } else {
        state.options.funnelGroup = action.payload;
      }
    },

    changeFunnelWindow(state, action: PayloadAction<number | undefined>) {
      state.dirty = true;
      if (!state.options || state.options.type !== 'funnel') {
        state.options = {
          type: 'funnel',
          funnelGroup: undefined,
          funnelWindow: action.payload,
        };
      } else {
        state.options.funnelWindow = action.payload;
      }
    },

    addFunnelStep(state, action: PayloadAction<{ name: string }>) {
      state.dirty = true;
      const steps = materializeFunnelSteps(state);
      const eventId = shortId();
      state.series.push({
        id: eventId,
        type: 'event',
        name: action.payload.name,
        segment: 'event',
        filters: [],
      });
      steps.push({ id: shortId(), eventIds: [eventId] });
    },

    addFunnelStepEvent(
      state,
      action: PayloadAction<{ stepId: string; name: string }>,
    ) {
      state.dirty = true;
      const steps = materializeFunnelSteps(state);
      const step = findStep(steps, action.payload.stepId);
      if (!step) {
        return;
      }
      const eventId = shortId();
      state.series.push({
        id: eventId,
        type: 'event',
        name: action.payload.name,
        segment: 'event',
        filters: [],
      });
      step.eventIds.push(eventId);
    },

    removeFunnelStepEvent(
      state,
      action: PayloadAction<{ stepId: string; eventId: string }>,
    ) {
      state.dirty = true;
      const steps = materializeFunnelSteps(state);
      const step = findStep(steps, action.payload.stepId);
      if (!step) {
        return;
      }
      // The step is kept even when it ends up empty: it stays an editable
      // placeholder and the config reads as invalid until the user fills it.
      step.eventIds = step.eventIds.filter((id) => id !== action.payload.eventId);
      dropSeriesByIds(state, new Set([action.payload.eventId]));
    },

    removeFunnelStep(state, action: PayloadAction<{ stepId: string }>) {
      state.dirty = true;
      const options = ensureFunnelOptions(state);
      const steps = materializeFunnelSteps(state);
      const step = findStep(steps, action.payload.stepId);
      if (!step) {
        return;
      }
      options.funnelSteps = steps.filter((s) => s.id !== action.payload.stepId);
      dropSeriesByIds(state, new Set(step.eventIds));
    },

    duplicateFunnelStep(state, action: PayloadAction<{ stepId: string }>) {
      state.dirty = true;
      const options = ensureFunnelOptions(state);
      const steps = materializeFunnelSteps(state);
      const index = steps.findIndex((s) => s.id === action.payload.stepId);
      const step = steps[index];
      if (!step) {
        return;
      }
      const clonedIds: string[] = [];
      for (const eventId of step.eventIds) {
        const source = state.series.find((item) => item.id === eventId);
        if (!source || source.type !== 'event') {
          continue;
        }
        const cloneId = shortId();
        clonedIds.push(cloneId);
        state.series.push({
          ...source,
          id: cloneId,
          filters: source.filters.map((filter) => ({
            ...filter,
            id: shortId(),
          })),
        });
      }
      const clone: IFunnelStep = {
        id: shortId(),
        displayName: step.displayName,
        eventIds: clonedIds,
      };
      options.funnelSteps = [
        ...steps.slice(0, index + 1),
        clone,
        ...steps.slice(index + 1),
      ];
    },

    reorderFunnelSteps(
      state,
      action: PayloadAction<{ fromIndex: number; toIndex: number }>,
    ) {
      state.dirty = true;
      const steps = materializeFunnelSteps(state);
      const [moved] = steps.splice(action.payload.fromIndex, 1);
      if (moved) {
        steps.splice(action.payload.toIndex, 0, moved);
      }
    },

    changeFunnelStepDisplayName(
      state,
      action: PayloadAction<{ stepId: string; displayName: string }>,
    ) {
      state.dirty = true;
      const steps = materializeFunnelSteps(state);
      const step = findStep(steps, action.payload.stepId);
      if (step) {
        // Empty string means "fall back to the event names", so store undefined
        // rather than an empty label.
        step.displayName = action.payload.displayName.trim() || undefined;
      }
    },

    dismissFunnelStepsNotice(state) {
      state.funnelStepsNotice = [];
    },
    changeOptions(state, action: PayloadAction<IReportOptions | undefined>) {
      state.dirty = true;
      state.options = action.payload || undefined;
    },
    changeSankeyMode(
      state,
      action: PayloadAction<'between' | 'after' | 'before'>,
    ) {
      state.dirty = true;
      if (!state.options) {
        state.options = {
          type: 'sankey',
          mode: action.payload,
          steps: 5,
          exclude: [],
        };
      } else if (state.options.type === 'sankey') {
        state.options.mode = action.payload;
      }
    },
    changeSankeySteps(state, action: PayloadAction<number>) {
      state.dirty = true;
      if (!state.options) {
        state.options = {
          type: 'sankey',
          mode: 'after',
          steps: action.payload,
          exclude: [],
        };
      } else if (state.options.type === 'sankey') {
        state.options.steps = action.payload;
      }
    },
    changeSankeyExclude(state, action: PayloadAction<string[]>) {
      state.dirty = true;
      if (!state.options) {
        state.options = {
          type: 'sankey',
          mode: 'after',
          steps: 5,
          exclude: action.payload,
        };
      } else if (state.options.type === 'sankey') {
        state.options.exclude = action.payload;
      }
    },
    changeSankeyInclude(state, action: PayloadAction<string[] | undefined>) {
      state.dirty = true;
      if (!state.options) {
        state.options = {
          type: 'sankey',
          mode: 'after',
          steps: 5,
          exclude: [],
          include: action.payload,
        };
      } else if (state.options.type === 'sankey') {
        state.options.include = action.payload;
      }
    },
    changeStacked(state, action: PayloadAction<boolean>) {
      state.dirty = true;
      if (!state.options || state.options.type !== 'histogram') {
        state.options = {
          type: 'histogram',
          stacked: action.payload,
        };
      } else {
        state.options.stacked = action.payload;
      }
    },
    reorderEvents(
      state,
      action: PayloadAction<{ fromIndex: number; toIndex: number }>,
    ) {
      state.dirty = true;
      const { fromIndex, toIndex } = action.payload;
      const [movedEvent] = state.series.splice(fromIndex, 1);
      if (movedEvent) {
        state.series.splice(toIndex, 0, movedEvent);
      }
    },
    changeVisibleSeries(
      state,
      action: PayloadAction<string[] | undefined>,
    ) {
      state.dirty = true;
      state.visibleSeries = action.payload;
    },
  },
});

// Action creators are generated for each case reducer function
export const {
  reset,
  ready,
  setReport,
  setName,
  addSerie,
  removeEvent,
  duplicateEvent,
  changeEvent,
  addBreakdown,
  removeBreakdown,
  changeBreakdown,
  addGlobalFilter,
  removeGlobalFilter,
  changeGlobalFilter,
  changeInterval,
  changeStartDate,
  changeEndDate,
  changeDateRanges,
  changeChartType,
  changeLineType,
  resetDirty,
  changeFormula,
  changePrevious,
  changeCriteria,
  changeUnit,
  changeMetric,
  changeFunnelGroup,
  changeFunnelWindow,
  changeOptions,
  changeSankeyMode,
  changeSankeySteps,
  changeSankeyExclude,
  changeSankeyInclude,
  changeStacked,
  reorderEvents,
  changeVisibleSeries,
  addFunnelStep,
  addFunnelStepEvent,
  removeFunnelStepEvent,
  removeFunnelStep,
  duplicateFunnelStep,
  reorderFunnelSteps,
  changeFunnelStepDisplayName,
  dismissFunnelStepsNotice,
} = reportSlice.actions;

export type IFunnelStepView = {
  id: string;
  /** User-typed label, if any. */
  displayName?: string;
  /** What the UI shows when `displayName` is empty. */
  defaultDisplayName: string;
  events: (IChartEventItem & { type: 'event' })[];
};

type ReportRootState = { report: InitialState };

/**
 * The step list to render. Works for legacy reports too: when `funnelSteps` is
 * absent it derives a one-event-per-step view WITHOUT writing anything, so
 * opening an old report leaves it untouched on disk.
 */
export function selectFunnelStepViews(
  state: ReportRootState,
): IFunnelStepView[] {
  const { series, options } = state.report;
  const events = series.filter(
    (item): item is IChartEventItem & { type: 'event' } => item.type === 'event',
  );
  const steps = options?.type === 'funnel' ? options.funnelSteps : undefined;

  if (!steps) {
    return events.map((event, index) => ({
      id: event.id ?? `step-${index}`,
      displayName: undefined,
      defaultDisplayName: defaultStepDisplayName([event]),
      events: [event],
    }));
  }

  return steps.map((step) => {
    const stepEvents = step.eventIds
      .map((id) => events.find((event) => event.id === id))
      .filter((event): event is IChartEventItem & { type: 'event' } =>
        Boolean(event),
      );
    return {
      id: step.id,
      displayName: step.displayName,
      defaultDisplayName: defaultStepDisplayName(stepEvents),
      events: stepEvents,
    };
  });
}

/** Non-null message when the current funnel config cannot be previewed/saved. */
export function selectFunnelConfigError(state: ReportRootState): string | null {
  const { chartType, series, options } = state.report;
  return getFunnelConfigError({ chartType, series, options });
}

export default reportSlice.reducer;
