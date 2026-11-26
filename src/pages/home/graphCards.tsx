import { Handle, NodeToolbar, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HEX_POINTS } from "../../components/HexTile";
import { paletteOf } from "../../lib/theme";
import { isDone, statKeys } from "../../shared/graphModel";
import { nodeLevel } from "../../shared/progression";
import { type GraphNode, type Priority, type StatKey, type StatWeights } from "../../shared/types";
import type { Act } from "./HomePage";
import { InlineInput } from "./InlineInput";
import { useIsNowStep } from "./nowMirror";
import { Tick } from "./Tick";
import { addRowHeight, canHover, labelSlot, plusOneButton, questTitleType, stepRow, stepTitleType } from "./graphLayout";

/**
 * The graph's cards, as React Flow draws them: a quest (QuestCard), a step or box (StepCard), and a
 * finished box folded to one line (FoldedCard), with the buttons, menus and pickers on them.
 *
 * A card gets what it shows as values in CardData (and whether it is Now's step from nowMirror), and
 * everything it can do through one shared CardActions object, so a card is drawn again only when its
 * own values change (sameCard). On the desktop a box's small buttons show on hover; on the phone one
 * labelled menu per box (PhoneMenu) holds them.
 * Card sizes are decided by the layout (graphLayout.ts); the classes here must match its constants.
 */
const nowPill = "rounded bg-ember/15 px-1 font-mono text-[10px] font-semibold text-ember";

// The quest menu's height with its longest labels, and the room the toolbar takes over the canvas
const questMenuHeight = 400;
const canvasToolbarHeight = 64;

// A card's data holds only values, so it stays the same object while they do, and React Flow and
// the memoised cards skip it
export type CardData = {
  node: GraphNode;
  depth: number;
  header: number; // the height of its title row, which grows as the title wraps
  xp: number;
  hasSteps: boolean;
  shelved: boolean; // a step shelved itself, or inside a shelved box, shown with its quest's shelved steps: greyed
  collapsed: boolean;
  folded: number | null; // a finished box folded to one line: how many steps it holds
  earlierDone: number; // a quest: its steps finished on an earlier day, hidden unless opened today
  showsDone: boolean; // a quest opened today: those steps are shown
  shelvedSteps: number; // a quest: its shelved steps (not counting any inside one), off the graph unless shown
  showsShelved: boolean; // a quest showing its shelved steps
  adding: boolean;
  menuOpen: boolean;
  look: PriorityLook;
  phone: boolean; // view-only placement, and one labelled menu instead of the small buttons
  actions: CardActions;
};

// How a card shows priority: a quest box the most urgent inside it, a step its own chain's
type PriorityLook = Priority | undefined;

// What a card can do, one object shared by every card; each takes the card's node id
export type CardActions = {
  act: Act;
  toggleCollapsed: (id: string) => void;
  open: (id: string) => void; // a folded box, or a quest's earlier done steps, until the next day starts
  close: (id: string) => void;
  toggleShelved: (id: string) => void; // shows or hides a quest's shelved steps, until the app reloads
  setAdding: (id: string, open: boolean) => void;
  setMenu: (id: string, open: boolean) => void;
};

function QuestCard({ data }: NodeProps<Node<CardData>>) {
  const { node, xp } = data;
  const { act } = data.actions;
  const level = nodeLevel(xp);
  const palette = paletteOf(data.look);

  return (
    <div data-priority={data.look} className="relative h-full w-full">
      <Handles phone={data.phone} />
      <div className="priority-mark rounded-2xl" />

      <div className="quest-face absolute inset-0 overflow-hidden rounded-2xl border border-ink/12 bg-card shadow-[var(--node-shadow)]" />

      <div className="group relative flex flex-col justify-between px-4 pt-3 pb-3.5" style={{ height: data.header }}>
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <HexDot className={palette.hexFill} />
            <Title node={node} act={act} textSize="text-[14px]" className={`line-clamp-3 ${questTitleType} text-ink`} />
            {data.phone ? null : (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void act("levelUp", node.id, crypto.randomUUID());
                }}
                title="Level up: log a session of progress"
                className={`nodrag shrink-0 ${plusOneButton}`}
              >
                +1
              </button>
            )}
          </div>
          <BoxButtons data={data} />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10.5px] text-muted">LVL {level.level}</span>
            <span className="flex gap-3">
              {data.shelvedSteps > 0 ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    data.actions.toggleShelved(node.id);
                  }}
                  title={data.showsShelved ? "Hide the shelved steps" : "Show the shelved steps, to unshelve one"}
                  className="nodrag font-mono text-[10.5px] text-muted hover:text-ink/85"
                >
                  {data.showsShelved ? "Hide shelved" : `${data.shelvedSteps} shelved`}
                </button>
              ) : null}
              {data.earlierDone > 0 ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (data.showsDone) data.actions.close(node.id);
                    else data.actions.open(node.id);
                  }}
                  title={data.showsDone ? "Hide the steps done before today" : "Show the steps done before today, until the day ends"}
                  className="nodrag font-mono text-[10.5px] text-muted hover:text-ink/85"
                >
                  {data.showsDone ? "Hide earlier done" : `${data.earlierDone} done earlier`}
                </button>
              ) : null}
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink/8">
            <div className={`progress-fill h-full rounded-full ${palette.bar}`} style={{ width: `${level.percent}%` }} />
          </div>
        </div>
      </div>

      <AddRow data={data} />
    </div>
  );
}

function StepCard({ data }: NodeProps<Node<CardData>>) {
  const { node } = data;
  const { act } = data.actions;
  const done = isDone(node);
  const now = useIsNowStep(node.id);
  if (data.folded !== null) return <FoldedCard data={data} steps={data.folded} />;
  const holdsSteps = data.hasSteps && !data.collapsed;

  return (
    <div
      data-priority={data.look}
      className={`group relative h-full w-full rounded-xl border ${done ? "border-ink/[0.05]" : "border-ink/10"} ${
        holdsSteps ? "bg-ink/[0.02]" : done ? "bg-ink/[0.012]" : "step-face bg-panel"
      } ${data.shelved ? shelvedLook : ""}`}
    >
      <Handles height={stepRow.height} phone={data.phone} />
      <div className="priority-mark rounded-xl" />
      <div className="relative flex items-center gap-2.5 px-3" style={{ height: data.header }}>
        {/* The tick and labels sit on the title's first line, where the links attach */}
        <span className="flex shrink-0 items-center self-start" style={{ height: stepRow.height }}>
          <Tick done={done} onClick={() => void act("updateNode", node.id, { done: !done })} className="nodrag" />
        </span>
        <Title
          node={node}
          act={act}
          textSize="text-[12.5px]"
          className={`line-clamp-3 flex-1 ${stepTitleType(holdsSteps)} ${done ? "text-ink/35 line-through decoration-ink/25" : holdsSteps ? "text-ink/80" : "text-ink/88"}`}
        />
        <span className="flex shrink-0 items-center justify-end self-start" style={{ width: labelSlot, height: stepRow.height }}>
          {now ? (
            <span className={`${nowPill} group-hover:invisible`}>Now</span>
          ) : node.priority && !data.phone ? (
            <span className="font-mono text-[10px] text-muted group-hover:invisible">P{node.priority}</span>
          ) : node.description ? (
            <span title="Has a description" className="text-muted group-hover:invisible">
              <NotesIcon />
            </span>
          ) : null}
        </span>
        {data.phone ? (
          <span className="flex shrink-0 items-center self-start" style={{ height: stepRow.height }}>
            <BoxButtons data={data} />
          </span>
        ) : (
          <BoxButtons data={data} />
        )}
      </div>
      <AddRow data={data} />
    </div>
  );
}

// A finished box folded to one line; a click opens it until the next day starts
function FoldedCard({ data, steps }: { data: CardData; steps: number }) {
  return (
    <div className="relative h-full w-full rounded-xl border border-ink/[0.06] bg-ink/[0.015]">
      <Handles height={stepRow.height} phone={data.phone} />
      <button
        type="button"
        onClick={() => data.actions.open(data.node.id)}
        title="Show its steps"
        className="nodrag flex w-full items-center gap-2 px-3 text-left text-xs text-muted hover:text-ink/65"
        style={{ height: stepRow.height }}
      >
        <span className="text-emerald-300/60">✓</span>
        <span className="min-w-0 flex-1 truncate">{data.node.title}</span>
        <span className="shrink-0 text-ink/30">· {steps} done</span>
      </button>
    </div>
  );
}

// A card draws from its data and size alone; React Flow's other props (its position, among
// them) change whenever the box it sits in moves
const sameCard = (before: NodeProps<Node<CardData>>, after: NodeProps<Node<CardData>>) =>
  before.data === after.data && before.width === after.width && before.height === after.height;

export const nodeTypes = { quest: memo(QuestCard, sameCard), step: memo(StepCard, sameCard) };

// A card's actions, bound to its node
function boundActions({ node, actions }: CardData) {
  return {
    act: actions.act,
    onToggleCollapsed: () => actions.toggleCollapsed(node.id),
    onAdding: (open: boolean) => actions.setAdding(node.id, open),
    onMenu: (open: boolean) => actions.setMenu(node.id, open),
  };
}

// A shelved step, shown with its quest's shelved steps, is greyed but works as usual, so it can be unshelved or ticked
const shelvedLook = "opacity-45 saturate-0";

// A box's title; double-click to rename (Enter or leaving the field saves, Escape cancels)
function Title({ node, act, textSize, className }: { node: GraphNode; act: Act; textSize: string; className: string }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={node.title}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.preventDefault();
            event.currentTarget.value = node.title;
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => {
          const title = event.currentTarget.value.trim();
          if (title && title !== node.title) void act("updateNode", node.id, { title });
          setEditing(false);
        }}
        className={`nodrag nopan min-w-0 flex-1 rounded-md border border-ink/20 bg-canvas/70 px-1.5 py-0.5 text-ink/90 focus:outline-none ${textSize}`}
      />
    );
  }

  return (
    <p
      onDoubleClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
      title={node.title}
      className={`min-w-0 cursor-text ${textSize} ${className}`}
    >
      {node.title}
    </p>
  );
}

// Edges attach at the middle of a step's row, or of the whole quest box (no height). On the phone
// links run downward, so they attach at the top and bottom; linking there is left to the agent, so
// the dots are hidden but still anchor the edges.
function Handles({ height, phone }: { height?: number; phone: boolean }) {
  const style = phone || height === undefined ? undefined : { top: height / 2 };
  // nodrag: pressing a dot draws a link rather than dragging the node
  const look = phone ? "!invisible" : "nodrag !z-10 !h-2.5 !w-2.5 !border-ink/35 !bg-panel";
  return (
    <>
      <Handle type="target" position={phone ? Position.Top : Position.Left} style={style} className={look} />
      <Handle type="source" position={phone ? Position.Bottom : Position.Right} style={style} className={look} />
    </>
  );
}

// The top-right buttons of every box: hide/show its steps, add a step inside, then ⋯ on a quest,
// priority, shelve and delete on a step
function BoxButtons({ data }: { data: CardData }) {
  const { depth, hasSteps, collapsed, adding } = data;
  const { onToggleCollapsed, onAdding } = boundActions(data);
  if (data.phone) return <PhoneMenu data={data} />;

  // The buttons float over the end of the title on hover or focus, so the title has the card's
  // width the rest of the time; a quest's stay while its menu is open, and in its header without hover
  const steps = depth > 0;
  const floating = "pointer-events-none absolute flex items-center bg-linear-to-l to-transparent opacity-0 [&>*]:pointer-events-auto transition-opacity group-hover:opacity-100 focus-within:opacity-100";
  return (
    <div
      className={
        steps
          ? `${floating} top-1 right-2 h-8 gap-1 from-panel from-70% pl-12`
          : !canHover
            ? "flex shrink-0 items-center gap-0.5"
            : `${floating} top-2.5 right-4 gap-0.5 from-card from-70% pl-10 ${data.menuOpen ? "opacity-100" : ""}`
      }
    >
      {hasSteps ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapsed();
          }}
          title={collapsed ? "Show steps" : "Hide steps"}
          className={`nodrag ${iconButton} text-muted hover:bg-ink/8 hover:text-ink/80`}
        >
          <EyeIcon crossed={collapsed} />
        </button>
      ) : null}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onAdding(!adding);
        }}
        title="Add a step inside"
        className={`nodrag ${iconButton} text-muted hover:bg-ink/8 hover:text-ink`}
      >
        <PlusIcon />
      </button>
      {depth === 0 ? (
        <MenuButton data={data} />
      ) : (
        <>
          <PriorityButton data={data} />
          <ShelveButton data={data} />
          <DeleteButton data={data} />
        </>
      )}
    </div>
  );
}

function PriorityButton({ data }: { data: CardData }) {
  const { node, menuOpen } = data;
  const { act, onMenu } = boundActions(data);
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onMenu(!menuOpen);
        }}
        title="Priority and description"
        className={`nodrag ${iconButton} font-mono text-[10px] font-semibold text-muted hover:bg-ink/8 hover:text-ink`}
      >
        {node.priority ? `P${node.priority}` : "P"}
      </button>
      <NodeToolbar isVisible={menuOpen} position={Position.Bottom} align="end" offset={6}>
        <div className="nodrag nopan w-64 space-y-2.5 rounded-xl border border-ink/10 bg-card p-2.5 text-xs text-ink/75 shadow-[var(--card-shadow)]">
          <PriorityPicker node={node} act={act} />
          <DescriptionEditor node={node} act={act} />
        </div>
      </NodeToolbar>
    </>
  );
}

function NotesIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 4h10M3 8h10M3 12h6" />
    </svg>
  );
}

// A box's description, free text that wraps (where its details are kept, say); saved on leaving the field
function DescriptionEditor({ node, act, rows = 4 }: { node: GraphNode; act: Act; rows?: number }) {
  return (
    <textarea
      key={node.description}
      defaultValue={node.description}
      rows={rows}
      maxLength={4000}
      placeholder="Description (optional)"
      aria-label="Description"
      onKeyDown={(event) => event.stopPropagation()}
      onBlur={(event) => {
        const description = event.currentTarget.value.trim();
        if (description !== node.description) void act("updateNode", node.id, { description });
      }}
      className="block w-full resize-y rounded-lg border border-ink/10 bg-canvas/60 px-2.5 py-2 text-[12.5px] leading-5 text-ink/85 placeholder:text-muted/70 focus:border-ember/60 focus:outline-none"
    />
  );
}

// Sets the node's own priority, which covers its chain; 1 is the most urgent
function PriorityPicker({ node, act }: { node: GraphNode; act: Act }) {
  return (
    <div className="flex w-full items-center justify-between gap-1" role="radiogroup" aria-label="Priority">
      {([null, 1, 2, 3, 4] as const).map((priority) => (
        <button
          key={priority ?? "none"}
          type="button"
          role="radio"
          aria-checked={node.priority === priority}
          aria-label={priority ? `Priority ${priority}` : "No priority"}
          onClick={() => void act("updateNode", node.id, { priority })}
          data-priority={priority ?? "none"}
          className={`flex-1 rounded-md border px-1 py-1 font-mono text-[11px] phone:min-h-11 ${node.priority === priority ? "border-[var(--mark,var(--color-ink))] bg-[color-mix(in_oklab,var(--mark,var(--color-ink))_14%,transparent)] text-ink" : "border-ink/10 text-muted hover:border-ink/25"}`}
        >
          {priority ? `P${priority}` : "–"}
        </button>
      ))}
    </div>
  );
}

// Shelves a step, or unshelves one shown with its quest's shelved steps
function ShelveButton({ data }: { data: CardData }) {
  const { node } = data;
  const { act } = data.actions;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void act("updateNode", node.id, { shelved: !node.shelved });
      }}
      title={node.shelved ? "Unshelve: pursue it again" : "Shelve: keep it, but not now"}
      className={`nodrag ${iconButton} text-muted hover:bg-ink/8 hover:text-ink/90`}
    >
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true" fill="currentColor">
        <rect x="2" y="1.5" width="2" height="7" rx="0.6" />
        <rect x="6" y="1.5" width="2" height="7" rx="0.6" />
      </svg>
    </button>
  );
}

// A red × in a circle; the first click asks "Delete?", a second deletes the step and its steps
function DeleteButton({ data }: { data: CardData }) {
  const { node } = data;
  const { act } = data.actions;
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timeout = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [confirming]);

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        if (confirming) void act("deleteNode", node.id);
        else setConfirming(true);
      }}
      title={confirming ? "Click again to delete" : "Delete"}
      className={`nodrag ${iconButton} ${
        confirming ? "w-auto bg-red-500/20 px-2 text-[11px] leading-none text-red-200" : "text-muted hover:bg-red-500/15 hover:text-red-300"
      }`}
    >
      {confirming ? (
        "Delete?"
      ) : (
        <CrossIcon />
      )}
    </button>
  );
}

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <path d="M1.5 8 C3.5 4.2 12.5 4.2 14.5 8 C12.5 11.8 3.5 11.8 1.5 8 Z" />
      <circle cx="8" cy="8" r="2" />
      {crossed ? <path d="M2.5 13.5 L13.5 2.5" /> : null}
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M5 1 V9 M1 5 H9" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 2 L8 8 M8 2 L2 8" />
    </svg>
  );
}

// Every small button on a card: one square (the × widens only to ask "Delete?")
const iconButton = "flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md";

// A quest's colour as a small flat-topped hex
function HexDot({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 56 48" className="mt-[3px] h-3 w-3.5 shrink-0" aria-hidden="true">
      <polygon points={HEX_POINTS} className={className} />
    </svg>
  );
}

// The input row at the bottom of a box being added to; Enter adds and stays open, Escape closes
function AddRow({ data }: { data: CardData }) {
  const { node, adding } = data;
  const { act, onAdding } = boundActions(data);
  if (!adding) return null;

  return (
    <div className="absolute right-0 bottom-0 left-0 flex items-center gap-1 px-3" style={{ height: addRowHeight }}>
      <InlineInput
        autoFocus
        placeholder="Step name, Enter to add"
        onSubmit={(title) => act("createNode", title, node.id)}
        onEscape={() => onAdding(false)}
        className="min-w-0 flex-1 px-2.5 py-1"
      />
    </div>
  );
}

// A quest's ⋯ button and its small menu: its priority, the stats it trains, layout, shelve, delete
function MenuButton({ data }: { data: CardData }) {
  const { node, menuOpen } = data;
  const { act, onMenu } = boundActions(data);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The menu opens where it fits whole in the canvas, clear of the toolbar: below the card, above
  // it, or else beside it, on the side with more room and running towards the canvas's middle
  const [side, setSide] = useState(Position.Bottom);
  const [align, setAlign] = useState<"start" | "end">("end");

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          const card = event.currentTarget.closest(".react-flow__node")?.getBoundingClientRect();
          const canvas = event.currentTarget.closest(".react-flow")?.getBoundingClientRect();
          if (card && canvas) {
            if (canvas.bottom - card.bottom >= questMenuHeight) setSide(Position.Bottom);
            else if (card.top - canvas.top - canvasToolbarHeight >= questMenuHeight) setSide(Position.Top);
            else {
              setSide(canvas.right - card.right >= card.left - canvas.left ? Position.Right : Position.Left);
              setAlign(card.top + card.height / 2 > canvas.top + canvas.height / 2 ? "end" : "start");
            }
          }
          setConfirmDelete(false);
          onMenu(!menuOpen);
        }}
        title="Options"
        className="nodrag flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-sm leading-none text-muted hover:bg-ink/8 hover:text-ink/80"
      >
        ⋯
      </button>

      <NodeToolbar isVisible={menuOpen} position={side} align={side === Position.Top || side === Position.Bottom ? "end" : align} offset={6}>
        <div className="nodrag nopan w-64 space-y-3 rounded-xl border border-ink/10 bg-card p-3 text-[12px] text-ink/75 shadow-[var(--card-shadow)]">
          <div>
            <p className="mb-1 text-[11.5px] text-muted">Priority</p>
            <PriorityPicker node={node} act={act} />
          </div>
          <DescriptionEditor node={node} act={act} rows={3} />
          <StatWeightsEditor node={node} act={act} />

          <div className="flex flex-wrap items-center gap-1.5 border-t border-ink/8 pt-3">
            <button
              type="button"
              onClick={() => void act("updateNode", node.id, { shelved: true })}
              title="Keep it, but off the graph and the to-do; it stays under Quests"
              className="rounded-lg border border-ink/12 px-2.5 py-1 text-[12px] text-ink/75 hover:bg-ink/6"
            >
              Shelve
            </button>
            <button
              type="button"
              onClick={() => (confirmDelete ? void act("deleteNode", node.id) : setConfirmDelete(true))}
              className="ml-auto rounded-lg border border-red-400/25 px-2.5 py-1 text-[12px] text-red-300 hover:bg-red-400/10"
            >
              {confirmDelete ? "Really delete?" : "Delete"}
            </button>
          </div>
        </div>
      </NodeToolbar>
    </>
  );
}

// On the phone every box has one ⋯, opening its actions as a sheet from the bottom of the screen,
// with words: there is no room for the desktop's small buttons, and fingers need bigger targets
function PhoneMenu({ data }: { data: CardData }) {
  const { node, depth, hasSteps, collapsed, menuOpen } = data;
  const { act, onMenu, onToggleCollapsed, onAdding } = boundActions(data);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isQuest = depth === 0;
  const choose = (action: () => unknown) => () => {
    action();
    onMenu(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setConfirmDelete(false);
          onMenu(!menuOpen);
        }}
        aria-label="Actions"
        className="nodrag relative flex h-6 w-8 shrink-0 items-center justify-center rounded-lg text-base leading-none text-muted before:absolute before:-inset-x-1.5 before:-inset-y-2.5 before:content-[''] active:bg-ink/10"
      >
        ⋯
      </button>

      {menuOpen
        ? createPortal(
          <div className="fixed inset-0 z-[60] flex items-end bg-canvas/60" onClick={() => onMenu(false)}>
            <div
              onClick={(event) => event.stopPropagation()}
              className="panel-scroll max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t border-ink/10 bg-card p-3 pb-[max(1rem,env(safe-area-inset-bottom))] text-[14px] text-ink/85 shadow-[var(--sheet-shadow)] transition-transform duration-200 ease-out starting:translate-y-full"
            >
              <input
                defaultValue={node.title}
                aria-label="Rename"
                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                onBlur={(event) => {
                  const title = event.currentTarget.value.trim();
                  if (!title) event.currentTarget.value = node.title;
                  else if (title !== node.title) void act("updateNode", node.id, { title });
                }}
                className="mb-1 min-h-11 w-full rounded-lg border border-ink/10 bg-canvas/60 px-3 py-2 font-display text-[15px] font-semibold text-ink/90 focus:border-ember/60 focus:outline-none"
              />
              <div className="mb-1">
                <DescriptionEditor node={node} act={act} rows={3} />
              </div>
              <button type="button" onClick={choose(() => onAdding(true))} className={phoneItem}>
                <PlusIcon /> Add a step inside
              </button>
              {hasSteps ? (
                <button type="button" onClick={choose(onToggleCollapsed)} className={phoneItem}>
                  <EyeIcon crossed={!collapsed} /> {collapsed ? "Show steps" : "Hide steps"}
                </button>
              ) : null}
              <div className={phoneRow}>
                <p className="mb-1 text-[11.5px] text-muted">Priority</p>
                <PriorityPicker node={node} act={act} />
              </div>
              {isQuest ? (
                <>
                  <button type="button" onClick={choose(() => act("levelUp", node.id, crypto.randomUUID()))} className={phoneItem}>
                    <span className="text-[11px] font-semibold text-red-300">++</span> Level up
                  </button>
                  <div className={phoneRow}>
                    <StatWeightsEditor node={node} act={act} />
                  </div>
                </>
              ) : null}
              <button type="button" onClick={choose(() => act("updateNode", node.id, { shelved: !node.shelved }))} className={phoneItem}>
                <span className="text-[11px] text-ink/60">❚❚</span> {node.shelved ? "Unshelve: pursue it again" : "Shelve: keep it, but not now"}
              </button>
              <button
                type="button"
                onClick={() => (confirmDelete ? void act("deleteNode", node.id) : setConfirmDelete(true))}
                className={`${phoneItem} text-red-300`}
              >
                <CrossIcon /> {confirmDelete ? "Tap again to delete" : "Delete"}
              </button>
            </div>
          </div>,
          document.body,
        )
        : null}
    </>
  );
}

const phoneItem = "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left active:bg-ink/8";
const phoneRow = "w-full px-3 py-2";

// The weight of each stat the quest trains: each XP in the quest adds weight × XP to the stat.
// A weight is saved when its field loses focus or on Enter; empty is 0. Every save sends the map
// built from all six fields (the API sends changes to one node in order). The fields take the
// stored weights back only once no save is pending, and never over an edit not yet saved.
function StatWeightsEditor({ node, act }: { node: GraphNode; act: Act }) {
  const [drafts, setDrafts] = useState(() => weightDrafts(node.statWeights));
  const unsaved = useRef(new Set<StatKey>());
  const inFlight = useRef(0);
  const [settled, setSettled] = useState(0);
  useEffect(() => {
    if (inFlight.current > 0) return;
    const stored = weightDrafts(node.statWeights);
    setDrafts((current) => Object.fromEntries(statKeys.map((key) => [key, unsaved.current.has(key) ? current[key] : stored[key]])) as Record<StatKey, string>);
  }, [node.statWeights, settled]);

  const save = () => {
    const weights = Object.fromEntries(statKeys.map((key) => [key, parseWeight(drafts[key]) ?? node.statWeights[key] ?? 0]));
    unsaved.current.clear();
    if (statKeys.every((key) => weights[key] === (node.statWeights[key] ?? 0))) return setDrafts(weightDrafts(node.statWeights));
    inFlight.current += 1;
    void act("updateNode", node.id, { statWeights: weights }).finally(() => {
      inFlight.current -= 1;
      setSettled((count) => count + 1);
    });
  };
  // Escape closes the menu without its field losing focus, so an edit still open is saved as it goes
  const saveLatest = useRef(save);
  saveLatest.current = save;
  useEffect(
    () => () => {
      if (unsaved.current.size > 0) saveLatest.current();
    },
    [],
  );

  return (
    <div className="w-full">
      <span className="text-[11.5px] text-muted">Trains (XP × weight)</span>
      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
        {statKeys.map((key) => (
          <label key={key} className="flex items-center justify-between gap-1.5">
            <span className="font-mono text-[11px] text-muted">{key}</span>
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              placeholder="0"
              aria-label={`${key} weight`}
              value={drafts[key]}
              onChange={(event) => {
                unsaved.current.add(key);
                setDrafts({ ...drafts, [key]: event.target.value });
              }}
              onBlur={save}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="w-14 rounded-md border border-ink/10 bg-canvas/60 px-1.5 py-0.5 text-right font-mono text-[12px] tabular-nums text-ink/85 [appearance:textfield] focus:border-ember/60 focus:outline-none phone:min-h-11 phone:w-16 [&::-webkit-inner-spin-button]:appearance-none"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

const weightDrafts = (weights: StatWeights) => Object.fromEntries(statKeys.map((key) => [key, weights[key] ? String(weights[key]) : ""])) as Record<StatKey, string>;

// A field's weight, or undefined when it holds no valid one; empty is 0
function parseWeight(draft: string): number | undefined {
  const value = draft.trim() === "" ? 0 : Number(draft);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}
