import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FUNNEL_MAX_EVENTS, type IChartEventItem } from '@openpanel/validation';
import { HandIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { useState } from 'react';
import {
  addFunnelStep,
  addFunnelStepEvent,
  changeEvent,
  changeFunnelStepDisplayName,
  dismissFunnelStepsNotice,
  duplicateFunnelStep,
  removeFunnelStep,
  removeFunnelStepEvent,
  reorderFunnelSteps,
  selectFunnelConfigError,
  selectFunnelStepViews,
} from '../reportSlice';
import { ReportEventMore } from './ReportEventMore';
import { ReportSeriesItem } from './ReportSeriesItem';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ComboboxEvents } from '@/components/ui/combobox-events';
import { Input } from '@/components/ui/input';
import { useAppParams } from '@/hooks/use-app-params';
import { useEventNames } from '@/hooks/use-event-names';
import { useDispatch, useSelector } from '@/redux';
import type { RouterOutputs } from '@/trpc/client';

export function ReportFunnelSteps() {
  const dispatch = useDispatch();
  const { projectId } = useAppParams();
  const eventNames = useEventNames({ projectId });
  const views = useSelector(selectFunnelStepViews);
  const configError = useSelector(selectFunnelConfigError);
  const notice = useSelector((state) => state.report.funnelStepsNotice);

  const atCapacity =
    views.reduce((count, view) => count + view.events.length, 0) >=
    FUNNEL_MAX_EVENTS;

  const sensors = useSensors(useSensor(PointerSensor));

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) {
      return;
    }
    const ids = views.map((view) => view.id);
    dispatch(
      reorderFunnelSteps({
        fromIndex: ids.indexOf(String(active.id)),
        toIndex: ids.indexOf(String(over.id)),
      })
    );
  };

  if (views.length === 0) {
    return (
      <div>
        <h3 className="mb-2 font-medium">Funnel steps</h3>
        <p className="text-muted-foreground text-sm">
          Add the first event to start the funnel.
        </p>
        <AddStepControl
          disabled={false}
          eventNames={eventNames}
          onAdd={(name) => dispatch(addFunnelStep({ name }))}
        />
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-2 font-medium">Funnel steps</h3>

      {notice.length > 0 && (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <p>
            {notice.length === 1
              ? `Removed event not used by any step: ${notice[0]}`
              : `Removed events not used by any step: ${notice.join(', ')}`}
          </p>
          <p className="mt-1 text-muted-foreground">
            Add them back to a step if you still need them.
          </p>
          <Button
            className="mt-2 h-7"
            onClick={() => dispatch(dismissFunnelStepsNotice())}
            size="sm"
            variant="outline"
          >
            Dismiss
          </Button>
        </div>
      )}

      <DndContext
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        sensors={sensors}
      >
        <SortableContext
          items={views.map((view) => view.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-4">
            {views.map((view, index) => (
              <FunnelStepCard
                eventNames={eventNames}
                index={index}
                key={view.id}
                totalSteps={views.length}
                view={view}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <AddStepControl
        disabled={atCapacity}
        eventNames={eventNames}
        onAdd={(name) => dispatch(addFunnelStep({ name }))}
      />

      {atCapacity && (
        <p className="mt-2 text-muted-foreground text-sm">
          A funnel supports at most {FUNNEL_MAX_EVENTS} event configurations.
        </p>
      )}
      {configError && (
        <p className="mt-2 text-red-500 text-sm" role="alert">
          {configError}
        </p>
      )}
    </div>
  );
}

function FunnelStepCard({
  view,
  eventNames,
  index,
  totalSteps,
}: {
  view: ReturnType<typeof selectFunnelStepViews>[number];
  eventNames: RouterOutputs['chart']['events'];
  index: number;
  totalSteps: number;
}) {
  const dispatch = useDispatch();
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: view.id });
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-lg border bg-def-100"
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
    >
      <div className="group flex items-center gap-2 p-2">
        <button
          className="cursor-grab active:cursor-grabbing"
          title="Drag to reorder the steps"
          {...listeners}
        >
          <HandIcon className="size-3 text-muted-foreground" />
          <span className="block font-semibold text-highlight text-xs">
            {index + 1}/{totalSteps}
          </span>
        </button>
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-muted-foreground text-xs">
            Step name
          </span>
          <Input
            className="w-full"
            defaultValue={view.displayName ?? ''}
            onChange={(e) =>
              dispatch(
                changeFunnelStepDisplayName({
                  stepId: view.id,
                  displayName: e.target.value,
                })
              )
            }
            placeholder={view.defaultDisplayName}
          />
        </label>
        <ReportEventMore
          onClick={(action) => {
            if (action === 'duplicate') {
              dispatch(duplicateFunnelStep({ stepId: view.id }));
            } else {
              dispatch(removeFunnelStep({ stepId: view.id }));
            }
          }}
        />
      </div>

      <div className="px-2 pb-2">
        <span className="text-muted-foreground text-sm">
          {view.events.length === 1
            ? 'Event for this step'
            : 'Any one of these events completes this step'}
        </span>

        <div className="mt-2 divide-y divide-border border-border border-t">
          {view.events.map((event) => (
            <FunnelEventRow
              event={event}
              eventNames={eventNames}
              key={event.id}
              onRemove={() =>
                dispatch(
                  removeFunnelStepEvent({
                    stepId: view.id,
                    eventId: event.id!,
                  })
                )
              }
            />
          ))}
        </div>

        {view.events.length === 0 && (
          <p className="mt-1 text-red-500 text-sm" role="alert">
            This step needs at least one event before you can preview or save.
          </p>
        )}

        {expanded ? (
          <AddEventControl
            onAdd={(name) =>
              dispatch(addFunnelStepEvent({ stepId: view.id, name }))
            }
            onCancel={() => setExpanded(false)}
          />
        ) : (
          <Button
            className="mt-2 h-8"
            icon={PlusIcon}
            onClick={() => setExpanded(true)}
            size="sm"
            variant="outline"
          >
            Add event
          </Button>
        )}
      </div>
    </div>
  );
}

function FunnelEventRow({
  event,
  eventNames,
  onRemove,
}: {
  event: IChartEventItem & { type: 'event' };
  eventNames: RouterOutputs['chart']['events'];
  onRemove: () => void;
}) {
  const dispatch = useDispatch();
  const [pendingName, setPendingName] = useState<string | null>(null);

  const selectEvent = (name: string) => {
    if (name === event.name) {
      return;
    }
    if (event.filters.length > 0) {
      setPendingName(name);
      return;
    }
    dispatch(changeEvent({ ...event, name }));
  };

  return (
    <div className="py-2">
      <ReportSeriesItem
        event={event}
        hideBadge
        index={0}
        isSelectManyEvents={false}
        showAddFilter
        showSegment={false}
      >
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
          <div aria-label="Event" className="min-w-0" role="group">
            <span className="mb-1 block text-muted-foreground text-xs">
              Event
            </span>
            <ComboboxEvents
              className="w-full min-w-0"
              items={eventNames}
              onChange={selectEvent}
              placeholder="Select event"
              searchable
              value={event.name}
            />
          </div>
          <label className="min-w-0">
            <span className="mb-1 block text-muted-foreground text-xs">
              Event note
            </span>
            <Input
              className="w-full"
              onChange={(e) =>
                dispatch(changeEvent({ ...event, displayName: e.target.value }))
              }
              placeholder="Optional note"
              value={event.displayName ?? ''}
            />
          </label>
        </div>
        <Button
          aria-label={`Remove event ${event.name}`}
          className="h-8 w-8 shrink-0 self-end p-0"
          onClick={onRemove}
          size="sm"
          title="Remove this alternate event"
          variant="ghost"
        >
          <TrashIcon size={14} />
        </Button>
      </ReportSeriesItem>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingName(null);
          }
        }}
        open={pendingName !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change this event?</AlertDialogTitle>
            <AlertDialogDescription>
              Filters configured for {event.name} will be removed. The event
              note will be kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current event</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingName !== null) {
                  dispatch(
                    changeEvent({ ...event, name: pendingName, filters: [] })
                  );
                }
                setPendingName(null);
              }}
            >
              Change event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddStepControl({
  disabled,
  onAdd,
  eventNames,
}: {
  disabled: boolean;
  onAdd: (name: string) => void;
  eventNames: RouterOutputs['chart']['events'];
}) {
  return (
    <div className="mt-3">
      <ComboboxEvents
        className="flex-1"
        disabled={disabled}
        items={eventNames}
        onChange={(value) => onAdd(value)}
        placeholder="Add step"
        searchable
        value={''}
      />
    </div>
  );
}

function AddEventControl({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string) => void;
  onCancel: () => void;
}) {
  const { projectId } = useAppParams();
  const eventNames = useEventNames({ projectId });
  return (
    <div className="mt-2 flex gap-2">
      <ComboboxEvents
        className="flex-1"
        items={eventNames}
        onChange={(value) => {
          onAdd(value);
          onCancel();
        }}
        placeholder="Select event"
        searchable
        value={''}
      />
      <Button onClick={onCancel} size="sm" variant="ghost">
        Cancel
      </Button>
    </div>
  );
}
