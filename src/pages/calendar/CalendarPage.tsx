import { useMemo, useState } from "react";
import { usePhone } from "../../lib/usePhone";
import { useToday } from "../../lib/useToday";
import { buildGraphModel } from "../../shared/graphModel";
import type { ISODate, Snapshot } from "../../shared/types";
import type { Act } from "../home/HomePage";
import { calendarEvents, weekStart } from "./calendarEvents";
import { MonthDots, WeekColumns, WeekList, type CalendarViewProps } from "./calendarViews";
import { EventDialog, type Editing } from "./EventDialog";

/**
 * The Calendar: the one-time alarms and the open deadlines, by day (calendarEvents.ts), a week at a time.
 * The desktop shows the week's days side by side with the month beside them; the phone shows the weeks
 * as a list, or the month, a tap on whose days picks the week the list opens on (calendarViews.tsx).
 * A day's + adds either kind; a tap on one opens it, to change or delete an alarm, or to tick, change,
 * link or delete a deadline. Both edit in one pop-up (EventDialog.tsx), which the page owns.
 */
export function CalendarPage({ snapshot, act }: { snapshot: Snapshot; act: Act }) {
  const phone = usePhone();
  const today = useToday(snapshot.settings.dayStartHour);
  const byDay = useMemo(() => calendarEvents(snapshot), [snapshot.alarms, snapshot.deadlines]);
  // The quests a deadline can be linked to; read only while the pop-up is open
  const model = useMemo(() => buildGraphModel(snapshot), [snapshot.nodes, snapshot.edges]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [monday, setMonday] = useState<ISODate>(() => weekStart(today));
  const [phoneView, setPhoneView] = useState<"week" | "month">("week");

  const view: CalendarViewProps = {
    byDay,
    today,
    monday,
    onWeek: (picked) => {
      setMonday(picked);
      setPhoneView("week");
    },
    onAdd: (date) => setEditing({ kind: "new", date }),
    onOpen: (event) => setEditing(event.kind === "alarm" ? { kind: "alarm", id: event.id } : { kind: "deadline", id: event.id }),
    act,
  };

  const addButton = (
    <button
      type="button"
      onClick={() => setEditing({ kind: "new", date: monday === weekStart(today) ? today : monday })}
      aria-label="Add to the calendar"
      className="absolute right-4 bottom-4 flex h-14 w-14 items-center justify-center rounded-full bg-ember text-3xl leading-none text-canvas shadow-[var(--card-shadow)] hover:brightness-110"
    >
      +
    </button>
  );
  const dialog = editing ? <EventDialog editing={editing} snapshot={snapshot} model={model} today={today} act={act} onClose={() => setEditing(null)} /> : null;

  if (phone) {
    const tab = (name: "week" | "month", label: string) => (
      <button type="button" role="tab" aria-selected={phoneView === name} onClick={() => setPhoneView(name)} className={`min-h-11 flex-1 rounded-md px-3 text-[12.5px] ${phoneView === name ? "bg-ember/15 font-medium text-ember" : "text-ink/70"}`}>
        {label}
      </button>
    );
    // On the phone the panel is as tall as its contents and scrolls under the fixed +, as on the Alarms screen
    return (
      <div className="relative flex min-h-0 w-full min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <section className="panel-lift flex shrink-0 grow flex-col gap-4 rounded-2xl border border-ink/8 bg-panel p-4 pb-20">
            <div className="flex items-center gap-3">
              <h1 className="caps mr-auto font-display text-[15px] font-bold text-ink/90">Calendar</h1>
              <div role="tablist" aria-label="Calendar view" className="flex w-44 rounded-lg border border-ink/12 p-0.5">
                {tab("week", "Week")}
                {tab("month", "Month")}
              </div>
            </div>
            {phoneView === "week" ? <WeekList {...view} /> : <MonthDots {...view} large />}
          </section>
        </div>
        {addButton}
        {dialog}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 w-full min-w-0 flex-1 gap-4">
      <WeekColumns {...view} />
      <aside className="panel-lift w-64 shrink-0 self-start rounded-2xl border border-ink/8 bg-panel p-4">
        <MonthDots key={monday.slice(0, 7)} {...view} />
      </aside>
      {addButton}
      {dialog}
    </div>
  );
}
