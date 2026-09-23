import { z } from 'zod';

/**
 * Hard cap on how many event configurations a single funnel may hold.
 *
 * `transformReportEventItem` backfills a missing series id from `alphabetIds`
 * (A-Z, 26 entries) with no fallback (reports.service.ts:64,76), so the 27th
 * event configuration would read `undefined`. Multi-event steps make that
 * reachable ("6 steps x 5 alternates"), so reject it with a readable error
 * instead of silently corrupting the report. Raising the cap requires fixing
 * that read path and auditing the A-Z display paths first.
 */
export const FUNNEL_MAX_EVENTS = 26;

export const zFunnelStep = z.object({
  id: z
    .string()
    .min(1)
    .describe('Stable identifier for this funnel step'),
  displayName: z
    .string()
    .optional()
    .describe('User-defined label; falls back to the alternate event names'),
  eventIds: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Ids of the event configurations in `series` that satisfy this step. ' +
        'Any one of them completes the step (OR).',
    ),
});

export type IFunnelStep = z.infer<typeof zFunnelStep>;

/** A step with its event configurations resolved out of the flat `series`. */
export type IResolvedFunnelStep<TEvent> = {
  id: string;
  displayName: string;
  /** 0-based position, authoritative for the chart and the profile list. */
  stepIndex: number;
  events: TEvent[];
};

export class FunnelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FunnelConfigError';
  }
}

type MinimalEvent = { id?: string; name: string; displayName?: string };

export function defaultStepDisplayName(events: MinimalEvent[]): string {
  const first = events[0];
  if (!first) {
    return '';
  }
  if (events.length === 1) {
    return first.displayName || first.name;
  }
  return Array.from(new Set(events.map((event) => event.name))).join(' / ');
}

/**
 * Turn a report's flat `series` plus the optional `funnelSteps` into the
 * ordered step list the funnel query and the chart both read, and into the
 * pruned event list the SQL is allowed to scan.
 *
 * Shared by the write entry points (report create/update) and the query entry
 * points (getFunnel / getFunnelProfiles) so a report can never be saved in a
 * shape the query would have to guess about.
 *
 * `funnelSteps` missing  -> legacy one-event-per-step view; every field of the
 *                           resolved step mirrors the event, so old reports
 *                           keep producing identical SQL and identical output.
 * `funnelSteps` empty    -> invalid; never falls back to the legacy view.
 * orphan event configs   -> dropped, not rejected (see below).
 */
export function resolveFunnelSteps<TEvent extends MinimalEvent>(input: {
  series: TEvent[];
  funnelSteps?: IFunnelStep[] | null;
}): { steps: IResolvedFunnelStep<TEvent>[]; eventSeries: TEvent[] } {
  const { series, funnelSteps } = input;

  if (series.length > FUNNEL_MAX_EVENTS) {
    throw new FunnelConfigError(
      `A funnel supports at most ${FUNNEL_MAX_EVENTS} event configurations, got ${series.length}`,
    );
  }

  if (!funnelSteps) {
    return {
      steps: series.map((event, index) => ({
        id: event.id ?? `step-${index}`,
        displayName: defaultStepDisplayName([event]),
        stepIndex: index,
        events: [event],
      })),
      eventSeries: series,
    };
  }

  if (funnelSteps.length === 0) {
    throw new FunnelConfigError(
      'funnelSteps must list at least one step when present',
    );
  }

  // Positional id backfill (alphabetIds) is only legal for reports without
  // funnelSteps: reordering `series` would otherwise reassign letters and
  // silently repoint every reference.
  const byId = new Map<string, TEvent>();
  for (const event of series) {
    if (!event.id) {
      throw new FunnelConfigError(
        'Every event configuration needs an id when funnelSteps is set',
      );
    }
    if (byId.has(event.id)) {
      throw new FunnelConfigError(
        `Duplicate event configuration id: ${event.id}`,
      );
    }
    byId.set(event.id, event);
  }

  const seenStepIds = new Set<string>();
  const claimed = new Set<string>();

  const steps = funnelSteps.map((step, index) => {
    if (seenStepIds.has(step.id)) {
      throw new FunnelConfigError(`Duplicate funnel step id: ${step.id}`);
    }
    seenStepIds.add(step.id);

    if (!step.eventIds?.length) {
      throw new FunnelConfigError(`Funnel step ${step.id} has no events`);
    }

    const events = step.eventIds.map((eventId) => {
      if (claimed.has(eventId)) {
        throw new FunnelConfigError(
          `Event configuration ${eventId} is referenced by more than one funnel step`,
        );
      }
      claimed.add(eventId);
      const event = byId.get(eventId);
      if (!event) {
        throw new FunnelConfigError(
          `Funnel step ${step.id} references unknown event configuration ${eventId}`,
        );
      }
      return event;
    });

    return {
      id: step.id,
      displayName: step.displayName?.trim() || defaultStepDisplayName(events),
      stepIndex: index,
      events,
    };
  });

  // Orphans are dropped rather than rejected: `changeChartType` keeps
  // `options` when switching away from funnel, so "funnel -> line + add an
  // event -> funnel" produces an unreferenced event through a pure UI path.
  // Rejecting would turn a recoverable editing state into an unopenable
  // report. The pruned list is what buildFunnelBase scans, which also keeps
  // an orphan's `profile.*` / `group.*` filters from pulling in joins.
  return { steps, eventSeries: steps.flatMap((step) => step.events) };
}

type FunnelConfigInput = {
  chartType: string;
  series: readonly {
    type: string;
    id?: string;
    name?: string;
    displayName?: string;
  }[];
  options?: { type?: string; funnelSteps?: IFunnelStep[] | null } | null;
};

/**
 * Write-entry guard: throws FunnelConfigError when a funnel report would be
 * saved in a shape the query layer must reject. Counts EVERY series item
 * against the cap (formulas included) because the 26-entry hazard sits on the
 * series index, not on the event subset.
 */
export function assertFunnelConfig(input: FunnelConfigInput): void {
  if (input.chartType !== 'funnel') {
    return;
  }
  if (input.series.length > FUNNEL_MAX_EVENTS) {
    throw new FunnelConfigError(
      `A funnel supports at most ${FUNNEL_MAX_EVENTS} event configurations, got ${input.series.length}`,
    );
  }
  const funnelSteps =
    input.options?.type === 'funnel' ? input.options.funnelSteps : undefined;
  if (!funnelSteps) {
    return;
  }
  resolveFunnelSteps({
    series: input.series
      .filter((item) => item.type === 'event')
      .map((item) => ({
        id: item.id,
        name: item.name ?? '',
        displayName: item.displayName,
      })),
    funnelSteps,
  });
}

/** Non-throwing variant for the editor and the chart's `enabled` guard. */
export function getFunnelConfigError(input: FunnelConfigInput): string | null {
  try {
    assertFunnelConfig(input);
    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : 'Invalid funnel configuration';
  }
}
