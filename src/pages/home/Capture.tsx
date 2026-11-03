import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { isDone, type GraphModel } from "../../shared/graphModel";
import { INBOX_TITLE } from "../../shared/inbox";
import { parseStepList } from "../../shared/splitList";
import { priorities, type GraphNode, type Priority, type Snapshot } from "../../shared/types";
import type { Act } from "./HomePage";
import { SplitSteps } from "./SplitSteps";

// A capture asked for from outside the field (the desktop-wide shortcut): the field takes focus as
// soon as it is on screen, which may be after the app has come back to Home
let captureWanted = false;
const captureEvent = "ashborn:capture";

export function requestCapture() {
  captureWanted = true;
  window.dispatchEvent(new Event(captureEvent));
}

// A field that saves a thought into the Inbox, without asking where it goes; a pasted list saves one
// per line. The first capture makes the Inbox; one made while the Inbox is done, hidden or shelved
// brings it back, so the thought never lands out of sight. Beside it, Sort opens the Inbox one item
// at a time.
// `onSorting` hears whether the Sort card is open, so the panel can put Focus away meanwhile
export function Capture({ snapshot, model, act, onSorting }: { snapshot: Snapshot; model: GraphModel; act: Act; onSorting?: (open: boolean) => void }) {
  const [draft, setDraft] = useState("");
  const [sorting, setSorting] = useState(false);
  // Sorting the last item away says so for a moment, so the card's going reads as done
  const [cleared, setCleared] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => {
      if (!captureWanted || !field.current) return;
      captureWanted = false;
      field.current.focus();
    };
    focus();
    window.addEventListener(captureEvent, focus);
    return () => window.removeEventListener(captureEvent, focus);
  }, []);
  const { inboxId } = snapshot;
  const waiting = (model.children.get(inboxId) ?? []).filter((item) => !isDone(item)).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const moveTargets = useMemo(() => ({ model, inboxId }), [model, inboxId]);

  // Sorting the last item away ends it; the next capture does not reopen the card
  useEffect(() => {
    if (waiting.length > 0) return;
    if (sorting) setCleared(true);
    setSorting(false);
  }, [waiting.length]);
  useEffect(() => {
    if (!cleared) return;
    const hide = window.setTimeout(() => setCleared(false), 2500);
    return () => window.clearTimeout(hide);
  }, [cleared]);

  const sortShown = sorting && waiting.length > 0;
  useEffect(() => onSorting?.(sortShown), [sortShown, onSorting]);

  // Not awaited: each change takes its place in line as it is made, so a capture made while the
  // Inbox is still being made can't overtake one made before it
  const capture = (titles: string[]) => {
    setDraft("");
    const inbox = model.byId.get(inboxId);
    if (!inbox) void act("createNode", INBOX_TITLE, null, inboxId);
    else if (isDone(inbox) || !inbox.active || inbox.shelved) void act("updateNode", inboxId, { done: false, active: true, shelved: false });
    titles.forEach((title) => void act("createNode", title, inboxId));
  };

  return (
    <>
      <div className="flex items-center gap-2 rounded-lg border border-ink/10 bg-canvas/60 px-3 focus-within:border-ember/60">
        <input
          ref={field}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && draft.trim() && capture([draft.trim()])}
          onPaste={(event) => {
            const titles = parseStepList(draft + event.clipboardData.getData("text"));
            if (titles.length < 2) return;
            event.preventDefault();
            capture(titles);
          }}
          aria-label="Capture a thought"
          placeholder="Capture a thought"
          className="min-h-9 min-w-0 flex-1 bg-transparent text-[13px] text-ink/90 placeholder:text-muted focus:outline-none"
        />
        {waiting.length > 0 ? (
          <button
            type="button"
            onClick={() => setSorting((open) => !open)}
            aria-expanded={sorting}
            title="Sort the Inbox, one at a time"
            className={`-mr-2 min-h-9 shrink-0 rounded-md px-2 font-mono text-[11px] tabular-nums hover:bg-ink/6 ${sorting ? "text-ember" : "text-muted hover:text-ink/85"}`}
          >
            Sort {waiting.length}
          </button>
        ) : null}
      </div>
      {sorting && waiting.length > 0 ? (
        <MoveTargets.Provider value={moveTargets}>
          <SortInbox items={waiting} snapshot={snapshot} model={model} act={act} onClose={() => setSorting(false)} />
        </MoveTargets.Provider>
      ) : cleared ? (
        <p role="status" className="-mt-3 px-1 text-[12.5px] text-emerald-300">
          ✓ Inbox clear
        </p>
      ) : null}
    </>
  );
}


// The Inbox one item at a time, oldest first. Skipping every item starts the round again. The item
// on show stays until it is dealt with, whatever is captured or arrives meanwhile.
function SortInbox({ items, snapshot, model, act, onClose }: { items: GraphNode[]; snapshot: Snapshot; model: GraphModel; act: Act; onClose: () => void }) {
  const [skipped, setSkipped] = useState<string[]>([]);
  const shown = useRef<string | null>(null);
  const waiting = items.filter((item) => !skipped.includes(item.id));
  const item = items.find(({ id }) => id === shown.current) ?? waiting[0] ?? items[0];
  shown.current = item.id;
  const skip = () => {
    shown.current = null;
    setSkipped(waiting.length > 1 ? [...skipped, item.id] : []);
  };
  return <SortCard key={item.id} item={item} place={items.indexOf(item) + 1} total={items.length} snapshot={snapshot} model={model} act={act} onSkip={skip} onClose={onClose} />;
}

function SortCard({ item, place, total, snapshot, model, act, onSkip, onClose }: { item: GraphNode; place: number; total: number; snapshot: Snapshot; model: GraphModel; act: Act; onSkip: () => void; onClose: () => void }) {
  const [splitting, setSplitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const picker = useRef<HTMLSelectElement>(null);
  const inside = model.children.get(item.id)?.length ?? 0;

  const moveTo = () => {
    picker.current?.focus();
    picker.current?.showPicker();
  };
  const ownQuest = () => void act("moveNode", item.id, null);
  const remove = () => (confirmDelete ? void act("deleteNode", item.id) : setConfirmDelete(true));
  const prioritise = (priority: Priority) => void act("updateNode", item.id, { priority: priority === item.priority ? null : priority });

  // On the desktop: M move, Q its own quest, S split, X delete, N skip, 1 to 4 priority, Escape closes; never while
  // typing in a field. Heard before Focus's keys and kept from them while this card is open.
  const keys = useRef<Record<string, () => void>>({});
  keys.current = splitting ? { "/": requestCapture } : { m: moveTo, q: ownQuest, s: () => setSplitting(true), x: remove, n: onSkip, "/": requestCapture, ...Object.fromEntries(priorities.map((priority) => [`${priority}`, () => prioritise(priority)])) };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "Escape") {
        // Otherwise Escape goes on to hide the window
        event.preventDefault();
        event.stopPropagation();
        return onClose();
      }
      if (event.key.length !== 1 || event.key === " ") return;
      event.stopPropagation();
      if (event.repeat) return;
      const action = keys.current[event.key.toLowerCase()];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <section aria-label="Sort the Inbox" className="-mt-3 rounded-xl border border-ember/40 bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="caps font-display text-[11px] font-bold text-ember">Sort</span>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-muted tabular-nums">
          {place} of {total}
        </span>
        <button type="button" onClick={onClose} title="Close (Esc)" aria-label="Close" className="-mr-1.5 flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-ink/8 hover:text-ink/85">
          ×
        </button>
      </div>

      <p className="mt-2 font-display text-[17px] leading-snug font-semibold text-ink/95">{item.title}</p>
      {inside > 0 ? <p className="mt-1 text-[12px] text-muted">{inside === 1 ? "1 step inside" : `${inside} steps inside`}</p> : null}

      {splitting ? (
        <SplitSteps act={act} parentId={item.id} onAdded={onSkip} onDone={() => setSplitting(false)} graph={{ model, snapshot }} className="mt-3 w-full" />
      ) : (
        <>
          <MoveToPicker step={item} act={act} selectRef={picker} offerOwnQuest={false} className="mt-3 min-h-9 w-full rounded-lg border border-ink/10 bg-canvas/60 px-2.5 py-1.5 text-[13px] text-ink/85" />
          <div role="group" aria-label={`Priority for ${item.title}`} className="mt-2 flex items-center gap-1.5">
            <span className="mr-1 text-[12px] text-muted">When, if you know</span>
            {priorities.map((priority) => (
              <button
                key={priority}
                type="button"
                data-priority={priority}
                aria-pressed={item.priority === priority}
                onClick={() => prioritise(priority)}
                title={`Priority ${priority} (${priority})`}
                className={`min-h-8 min-w-8 rounded-md border border-[color-mix(in_oklab,var(--mark)_35%,transparent)] px-1.5 font-mono text-[10.5px] text-[var(--mark)] ${item.priority === priority ? "bg-[color-mix(in_oklab,var(--mark)_22%,transparent)] font-semibold" : "hover:bg-[color-mix(in_oklab,var(--mark)_12%,transparent)]"}`}
              >
                P{priority}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
            <button type="button" onClick={ownQuest} title="Its own quest (Q)" className="min-h-8 rounded-lg border border-ink/12 px-3 py-1.5 text-ink/75 hover:bg-ink/6">
              Its own quest
            </button>
            <button type="button" onClick={() => setSplitting(true)} title="Split it (S)" className="min-h-8 rounded-lg border border-ink/12 px-3 py-1.5 text-ink/75 hover:bg-ink/6">
              Split it
            </button>
            <button type="button" onClick={onSkip} title="Skip (N)" className="min-h-8 rounded-lg px-2 py-1.5 text-muted hover:bg-ink/6 hover:text-ink/85">
              Skip
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={remove}
              title="Delete (X)"
              className={`min-h-8 rounded-lg px-2 py-1.5 ${confirmDelete ? "bg-red-500/20 text-red-300" : "text-muted hover:bg-red-500/15 hover:text-red-300"}`}
            >
              {confirmDelete ? "Delete?" : "Delete"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// Open quests and steps as options, nested as on the graph, leaving out `skip` and all inside it
function nodeOptions(model: GraphModel, skip?: string, parentId: string | null = null, depth = 0): ReactNode[] {
  return (model.children.get(parentId) ?? [])
    .filter((node) => node.id !== skip && !isDone(node) && (parentId || node.active))
    .flatMap((node) => [
      <option key={node.id} value={node.id}>
        {"  ".repeat(depth)}
        {node.title}
      </option>,
      ...nodeOptions(model, skip, node.id, depth + 1),
    ]);
}

// A choice of open quests and steps, or none
export function NodePicker({ model, label, none, value, onChange, className }: { model: GraphModel; label: string; none: string; value: string | null; onChange: (nodeId: string | null) => void; className: string }) {
  return (
    <select aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} className={className}>
      <option value="">{none}</option>
      {nodeOptions(model)}
    </select>
  );
}

const OWN_QUEST = "own-quest";

// What MoveToPicker offers. A context, so a change to the graph redraws the pickers and not every card
export const MoveTargets = createContext<{ model: GraphModel; inboxId: string }>(null!);

// Sorts a step out of the Inbox: into any open quest or step, or into a quest of its own
export function MoveToPicker({ step, act, onMoved, selectRef, offerOwnQuest = true, className }: { step: GraphNode; act: Act; onMoved?: () => void; selectRef?: Ref<HTMLSelectElement>; offerOwnQuest?: boolean; className: string }) {
  const { model, inboxId } = useContext(MoveTargets);
  return (
    <select
      ref={selectRef}
      aria-label="Move to…"
      title="Move to…"
      value=""
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        void act("moveNode", step.id, event.target.value === OWN_QUEST ? null : event.target.value);
        onMoved?.();
      }}
      className={className}
    >
      <option value="" disabled>
        Move to…
      </option>
      {offerOwnQuest ? <option value={OWN_QUEST}>Its own quest</option> : null}
      {nodeOptions(model, inboxId)}
    </select>
  );
}
