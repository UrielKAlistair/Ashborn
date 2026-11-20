import { useEffect, useMemo, useState } from "react";
import { Popup } from "../../components/Popup";
import { useNow } from "../../lib/useNow";
import { usePhone } from "../../lib/usePhone";
import { useToday } from "../../lib/useToday";
import { addDays } from "../../shared/dates";
import { buildGraphModel } from "../../shared/graphModel";
import type { AlarmInstance } from "../../shared/schedule";
import type { ISODate, Snapshot } from "../../shared/types";
import { DayRings, MoveRing } from "../DayRings";
import type { Act } from "../home/HomePage";
import { calendarEvents, weekStart } from "./calendarEvents";
import { dayLabel, MonthDots, WeekColumns, WeekList, type CalendarViewProps } from "./calendarViews";
import { EventDialog, type Editing } from "./EventDialog";

/**
 * The Calendar: the one-time alarms and the open deadlines, by day (calendarEvents.ts), a week at a time.
 * The desktop shows the week's days side by side with the month beside them, or, in a window too narrow
 * for seven columns, the weeks as a list beside the month; the phone shows the weeks as a list, or the month, a tap on whose days picks the week the list opens on (calendarViews.tsx).
 * A day's + adds either kind; a tap on one opens it, to change or delete an alarm, or to tick, change,
 * link or delete a deadline. Both edit in one pop-up (EventDialog.tsx), which the page owns.
 * A tap on a day's name opens that whole day as the Alarms screen shows it (DayRings): every ring,
 * routines and meals included, with arrows to the days either side.
 */
export function CalendarPage({ snapshot, act }: { snapshot: Snapshot; act: Act }) {
  const phone = usePhone();
  const narrow = useNarrow();
  const today = useToday();
  const now = useNow();
  const byDay = useMemo(() => calendarEvents(snapshot), [snapshot.alarms, snapshot.deadlines]);
  // The quests a deadline can be linked to; read only while the pop-up is open
  const model = useMemo(() => buildGraphModel(snapshot), [snapshot.nodes, snapshot.edges]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [monday, setMonday] = useState<ISODate>(() => weekStart(today));
  const [phoneView, setPhoneView] = useState<"week" | "month">("week");
  // The day open in full, and a ring in it being moved
  const [day, setDay] = useState<ISODate | null>(null);
  const [moving, setMoving] = useState<AlarmInstance | null>(null);

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
    onDay: setDay,
    now,
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
  // The event pop-up opens over the day's, so closing it returns to the day
  const dialog = (
    <>
      {day ? (
        <Popup label={dayLabel(day, { weekday: "long", day: "numeric", month: "long" })} onClose={() => setDay(null)}>
          <div className="panel-scroll -mr-2 flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-2">
            <div className="flex items-center justify-between">
              <DayStep onClick={() => setDay(addDays(day, -1))}>‹ Day before</DayStep>
              <DayStep onClick={() => setDay(addDays(day, 1))}>Day after ›</DayStep>
            </div>
            <DayRings
              snapshot={snapshot}
              date={day}
              act={act}
              onOpenAlarm={(alarm) => setEditing({ kind: "alarm", id: alarm.id })}
              onOpenDeadline={(deadline) => setEditing({ kind: "deadline", id: deadline.id })}
              onMove={setMoving}
            />
            <button type="button" onClick={() => setEditing({ kind: "new", date: day })} className="self-start rounded-lg border border-dashed border-ink/15 px-3 py-1.5 text-[12.5px] text-muted hover:border-ember/40 hover:text-ember phone:min-h-11">
              + Add on this day
            </button>
          </div>
        </Popup>
      ) : null}
      {moving ? (
        <Popup label="Move this ring" onClose={() => setMoving(null)}>
          <MoveRing ring={moving} snapshot={snapshot} act={act} onDone={() => setMoving(null)} />
        </Popup>
      ) : null}
      {editing ? <EventDialog editing={editing} snapshot={snapshot} model={model} today={today} act={act} onClose={() => setEditing(null)} /> : null}
    </>
  );

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
      {narrow ? (
        <section className="panel-lift panel-scroll flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto rounded-2xl border border-ink/8 bg-panel p-4 pb-20">
          <h1 className="caps font-display text-[15px] font-bold text-ink/90">Calendar</h1>
          <WeekList {...view} />
        </section>
      ) : (
        <WeekColumns {...view} />
      )}
      <aside className="panel-lift w-64 shrink-0 self-start rounded-2xl border border-ink/8 bg-panel p-4">
        <MonthDots key={monday.slice(0, 7)} {...view} />
      </aside>
      {addButton}
      {dialog}
    </div>
  );
}

function DayStep({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className="rounded-lg px-2.5 py-1 text-[12.5px] text-ink/75 hover:bg-ink/6 phone:min-h-11">
      {children}
    </button>
  );
}

// A window this narrow leaves a week's columns too thin to read a title in
const narrowQuery = "(max-width: 1180px)";

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(narrowQuery).matches);
  useEffect(() => {
    const query = window.matchMedia(narrowQuery);
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}
