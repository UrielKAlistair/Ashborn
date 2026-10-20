import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import {
  Controls,
  Handle,
  MarkerType,
  NodeResizeControl,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type XYPosition,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { paletteOf, palettes } from "../../lib/theme";
import { isDone, statKeys, type GraphModel } from "../../shared/graphModel";
import { nodeLevel } from "../../shared/progression";
import { threadColors, type GraphEdge, type GraphNode, type Snapshot, type StatKey, type StatWeights, type ThreadColor } from "../../shared/types";
import type { Act } from "./HomePage";
import { InlineInput } from "./InlineInput";
import Territories from "./territory/Territories";
import { Tick } from "./Tick";

// Box sizes. A thread is a header above its steps; a step is a row that grows into a box when
// it holds steps of its own. A box being added to gets an input row at the bottom.
const threadHeader = { width: 264, height: 76 };
const stepRow = { width: 248, height: 40 };
const addRowHeight = 40;
const padding = 16;
const collapsedStorageKey = "ashborn-collapsed";

const fitOptions = { padding: 0.15, maxZoom: 1.1 };

// On the phone the whole graph would fit too small to read. The view opens instead on its
// top-left corner, so the first threads' headers show, as wide as fits but never smaller than
// PHONE_MIN_ZOOM; the rest is a pan away.
const PHONE_MIN_ZOOM = 0.75;
const PHONE_MARGIN = 12;
// Room at the top for the toolbar (+ New thread, Threads) that floats over the canvas
const PHONE_TOOLBAR_HEIGHT = 48;

function phoneViewport(shown: GraphNode[], placements: Record<string, Box>, paneWidth: number) {
  const boxes = shown.flatMap((thread) => (placements[thread.id] ? [placements[thread.id]] : []));
  const left = Math.min(...boxes.map((box) => box.position.x));
  const top = Math.min(...boxes.map((box) => box.position.y));
  const right = Math.max(...boxes.map((box) => box.position.x + box.size.width));
  const zoom = Math.min(fitOptions.maxZoom, Math.max(PHONE_MIN_ZOOM, (paneWidth - 2 * PHONE_MARGIN) / (right - left)));
  return { x: PHONE_MARGIN - left * zoom, y: PHONE_TOOLBAR_HEIGHT + PHONE_MARGIN - top * zoom, zoom };
}

const elk = new ELK();

type Size = { width: number; height: number };
type Box = { position: XYPosition; size: Size }; // position is relative to the parent box

type CardData = {
  node: GraphNode;
  depth: number;
  xp: number;
  hasSteps: boolean;
  shelved: boolean; // shelved itself, or inside a shelved box: shown greyed
  collapsed: boolean;
  adding: boolean;
  menuOpen: boolean;
  phone: boolean; // view-only placement, and one labelled menu instead of the small buttons
  act: Act;
  onToggleCollapsed: () => void;
  onAdding: (open: boolean) => void;
  onMenu: (open: boolean) => void;
  onResizing: (size: Size) => void;
  onResized: (size: Size) => void;
  subtreeIds: () => string[]; // the node and every step inside it
};

type ThreadGraphProps = {
  snapshot: Snapshot;
  model: GraphModel;
  act: Act;
  phone: boolean;
};

export function ThreadGraph(props: ThreadGraphProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}

function GraphCanvas({ snapshot, model, act, phone }: ThreadGraphProps) {
  const { fitView, setViewport } = useReactFlow();
  const [placements, setPlacements] = useState<Record<string, Box>>({});
  // Positions and sizes mid-drag or mid-resize, shown until the layout includes them
  const [moving, setMoving] = useState<Record<string, Partial<Box>>>({});
  const [collapsed, setCollapsed] = useState(() => loadIds(collapsedStorageKey));
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const fittedFor = useRef<string | null>(null);
  // Hidden until the first layout is fitted: before it, every node sits at the origin
  const [shownYet, setShownYet] = useState(false);

  // A box shows all its steps, done ones greyed, unless the user collapsed it
  const visibleSteps = (id: string) => (collapsed.has(id) ? [] : (model.children.get(id) ?? []));

  const threads = model.children.get(null) ?? [];
  const shown = threads.filter((thread) => thread.active);

  // Rendered nodes, parents before their steps (React Flow needs that order)
  const rendered: Array<{ node: GraphNode; depth: number }> = [];
  const visit = (node: GraphNode, depth: number) => {
    rendered.push({ node, depth });
    visibleSteps(node.id).forEach((step) => visit(step, depth + 1));
  };
  shown.forEach((thread) => visit(thread, 0));
  const renderedIds = new Set(rendered.map(({ node }) => node.id));
  const renderedEdges = snapshot.edges.filter((edge) => renderedIds.has(edge.from) && renderedIds.has(edge.to));

  const structureKey = JSON.stringify([
    rendered.map(({ node }) => [node.id, node.position, node.size]),
    renderedEdges.map((edge) => [edge.from, edge.to]),
    addingTo,
  ]);
  const topKey = shown.map((thread) => thread.id).join();

  // Re-layout only when the rendered structure changes, not on every level-up
  useEffect(() => {
    let cancelled = false;

    void layoutTree(shown, renderedEdges, visibleSteps, addingTo).then((next) => {
      if (cancelled) return;
      setPlacements(next);
      setMoving({});
    });

    return () => {
      cancelled = true;
    };
  }, [structureKey]);

  // Fit the view when the set of threads shown changes, not on every step edit, and only once
  // React Flow knows the canvas size (before that, a fit is silently lost). Nodes carry their
  // sizes, so their bounds are known as soon as they are laid out.
  const paneMeasured = useStore((state) => state.width > 0 && state.height > 0);
  const paneWidth = useStore((state) => state.width);
  useEffect(() => {
    if (!paneMeasured || fittedFor.current === topKey || Object.keys(placements).length === 0) return;
    // A frame later React Flow holds the laid-out nodes; a fit cancelled by a newer layout is
    // not counted as done, so the newer one fits instead
    const frame = window.requestAnimationFrame(() => {
      fittedFor.current = topKey;
      void (phone ? setViewport(phoneViewport(shown, placements, paneWidth)) : fitView(fitOptions)).then(() => setShownYet(true));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [placements, paneMeasured, fitView, setViewport, phone, paneWidth]);

  // Escape closes an open menu before the navbar's hide-to-tray handler sees it
  useEffect(() => {
    if (!menuFor) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuFor(null);
      }
    };
    window.addEventListener("keydown", close, { capture: true });
    return () => window.removeEventListener("keydown", close, { capture: true });
  }, [menuFor]);

  const setCollapsedFor = (id: string, value: boolean) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      saveIds(collapsedStorageKey, next);
      return next;
    });

  const depthOf = new Map(rendered.map(({ node, depth }) => [node.id, depth]));

  const nodes = useMemo<Node<CardData>[]>(
    () =>
      rendered.map(({ node, depth }) => {
        const placement = placements[node.id];
        const size = moving[node.id]?.size ?? placement?.size ?? (depth === 0 ? threadHeader : stepRow);
        return {
          id: node.id,
          type: depth === 0 ? "thread" : "step",
          parentId: node.parentId ?? undefined,
          extent: node.parentId ? ("parent" as const) : undefined,
          position: moving[node.id]?.position ?? placement?.position ?? { x: 0, y: 0 },
          draggable: !phone,
          selectable: false,
          deletable: false,
          zIndex: depth * 10,
          // Known sizes: React Flow then skips measuring, during which it hides the node and
          // the browser drops focus from any input inside it
          width: size.width,
          height: size.height,
          // React Flow ignores the pointer on nodes that can't be dragged or selected; the
          // cards' buttons and inputs need it
          style: { ...size, pointerEvents: "all" },
          data: {
            node,
            depth,
            xp: model.totalXp.get(node.id) ?? 0,
            hasSteps: model.children.has(node.id),
            shelved: model.shelved.has(node.id),
            collapsed: collapsed.has(node.id),
            adding: addingTo === node.id,
            menuOpen: menuFor === node.id,
            phone,
            act,
            onToggleCollapsed: () => setCollapsedFor(node.id, !collapsed.has(node.id)),
            // Adding to a collapsed box opens it, so the new steps are seen
            onAdding: (open: boolean) => {
              if (open) setCollapsedFor(node.id, false);
              setAddingTo(open ? node.id : null);
            },
            onMenu: (open: boolean) => setMenuFor(open ? node.id : null),
            onResizing: (newSize: Size) => follow(node.id, { size: newSize }),
            onResized: (newSize: Size) => place(node, { size: newSize }),
            subtreeIds: () => subtreeOf(model, node.id),
          },
        };
      }),
    [snapshot, model, placements, moving, collapsed, addingTo, menuFor],
  );

  const edges = useMemo<Edge[]>(
    () =>
      renderedEdges.map((edge) => {
        const isSelected = selectedEdge?.from === edge.from && selectedEdge?.to === edge.to;
        // Above the box that holds the two nodes, below the nodes themselves
        const depth = depthOf.get(edge.from) ?? 0;
        // A link out of a done step is a met prerequisite
        const met = model.byId.get(edge.from)?.completedAt;
        return {
          id: `${edge.from}->${edge.to}`,
          source: edge.from,
          target: edge.to,
          deletable: false,
          zIndex: depth * 10 - 5,
          markerEnd: { type: MarkerType.ArrowClosed, color: met ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.32)" },
          style: {
            stroke: isSelected ? "rgba(125,211,252,0.9)" : met ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.32)",
            strokeWidth: isSelected ? 2 : 1.25,
            strokeDasharray: met && !isSelected ? "4 4" : undefined,
          },
        };
      }),
    [snapshot, model, selectedEdge, collapsed],
  );

  // Each shown thread claims the hex cells around it, in its colour, following it as it is
  // dragged
  const territories = useMemo(
    () =>
      shown.flatMap((thread, z) => {
        const placement = placements[thread.id];
        if (!placement) return [];
        const rect = { ...placement.position, ...placement.size, ...moving[thread.id]?.position, ...moving[thread.id]?.size };
        return [{ id: thread.id, rect, color: thread.color ?? ("none" as const), z }];
      }),
    [placements, moving, snapshot],
  );

  // Drags and resizes show at once; the end of one saves it. A node the user places pins its
  // siblings where they are, so the ones still placed automatically do not jump. (React Flow's
  // own change stream is left alone: it also carries the measurements links attach by.)
  const follow = (id: string, box: Partial<Box>) => setMoving((current) => ({ ...current, [id]: { ...current[id], ...box } }));

  const place = (node: GraphNode, change: { position?: XYPosition; size?: Size }) => {
    const siblings = (model.children.get(node.parentId) ?? []).filter(
      (sibling) => sibling.id !== node.id && !sibling.position && placements[sibling.id] && (node.parentId || sibling.active),
    );
    void act("placeNodes", [
      { id: node.id, position: change.position ?? placements[node.id].position, size: change.size },
      ...siblings.map((sibling) => ({ id: sibling.id, position: placements[sibling.id].position })),
    ]);
  };

  // Dragging against an existing link (from its head back to its tail) removes it
  const connect = ({ source, target }: Connection) => {
    const reverse = snapshot.edges.find((edge) => edge.from === target && edge.to === source);
    if (reverse) void act("removeEdge", reverse);
    else void act("addEdge", { from: source, to: target });
  };

  return (
    <ReactFlow
      style={{ opacity: shownYet || shown.length === 0 ? 1 : 0 }}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onConnect={connect}
      onEdgeClick={(_event, edge) => {
        setMenuFor(null);
        setSelectedEdge({ from: edge.source, to: edge.target });
      }}
      onPaneClick={() => {
        setMenuFor(null);
        setAddingTo(null);
        setSelectedEdge(null);
        setThreadsOpen(false);
      }}
      nodesDraggable={!phone}
      nodeDragThreshold={4}
      nodesConnectable={!phone}
      onNodeDrag={(_event, dragged) => follow(dragged.id, { position: dragged.position })}
      onNodeDragStop={(_event, dragged) => {
        const node = model.byId.get(dragged.id);
        if (node) place(node, { position: dragged.position });
      }}
      zoomOnDoubleClick={false}
      deleteKeyCode={null}
      minZoom={0.15}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
      className="!bg-transparent"
    >
      <Territories threads={territories} />
      <Controls position="bottom-left" showInteractive={false} fitViewOptions={{ ...fitOptions, duration: 300 }} />

      {threads.length > 0 ? (
        <Panel position="top-left" className="flex flex-col items-start gap-2">
          <div className="flex items-center gap-2">
            <InlineInput placeholder="+ New thread" onSubmit={(title) => act("createNode", title, null)} className="w-48" />
            <button
              type="button"
              onClick={() => setThreadsOpen((open) => !open)}
              className="rounded-full border border-white/10 bg-night-panel/80 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/70 backdrop-blur-sm hover:border-white/25 hover:text-white"
            >
              Threads {shown.length}/{threads.length}
            </button>
            {phone ? null : (
              <ResetLayoutButton
                onReset={() => {
                  // Fit again once the automatic layout lands
                  fittedFor.current = null;
                  void act("resetLayout", snapshot.nodes.filter((node) => node.position || node.size).map((node) => node.id));
                }}
              />
            )}
          </div>

          {threadsOpen ? (
            <div className="w-72 rounded-xl border border-white/10 bg-night-card/95 p-3 backdrop-blur-md">
              <p className="text-[10px] uppercase tracking-[0.22em] text-white/40">Shown on the dashboard</p>
              <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                {threads.map((thread) => (
                  <label key={thread.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-xs text-white/75 hover:bg-white/6">
                    <input type="checkbox" checked={thread.active} onChange={(event) => void act("updateNode", thread.id, { active: event.target.checked })} />
                    <span className="truncate">{thread.title}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {selectedEdge ? (
        <Panel position="bottom-center" className="flex items-center gap-3 rounded-xl border border-white/10 bg-night-card/95 px-3 py-2 text-xs text-white/70 backdrop-blur-md">
          <span className="max-w-72 truncate text-white/60">
            {model.byId.get(selectedEdge.from)?.title} → {model.byId.get(selectedEdge.to)?.title}
          </span>
          <button
            type="button"
            onClick={() => {
              void act("removeEdge", selectedEdge);
              setSelectedEdge(null);
            }}
            className="rounded-md border border-red-400/30 px-2 py-1 text-red-200 hover:border-red-300/50"
          >
            Remove link
          </button>
        </Panel>
      ) : null}

      {shown.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 text-center">
          {threads.length === 0 ? (
            <>
              <p className="max-w-sm text-xs leading-relaxed tracking-[0.12em] text-white/45">
                Start a thread: something you are learning or building.
              </p>
              <div className="pointer-events-auto">
                <InlineInput placeholder="Name your first thread (Enter)" onSubmit={(title) => act("createNode", title, null)} className="w-72 py-2 text-center" />
              </div>
            </>
          ) : (
            <p className="text-xs tracking-[0.12em] text-white/45">All threads are hidden. Pick some under Threads.</p>
          )}
        </div>
      ) : null}
    </ReactFlow>
  );
}

function ThreadCard({ data }: NodeProps<Node<CardData>>) {
  const { node, xp, act } = data;
  const level = nodeLevel(xp);
  const palette = paletteOf(node.color);

  return (
    <div className={`relative h-full w-full ${data.shelved ? shelvedLook : ""}`}>
      <Handles height={threadHeader.height} hidden={data.phone} />

      {/* A frosted sheet in the thread's colour, as the trail's chapters are */}
      <div
        className={`absolute inset-0 overflow-hidden rounded-3xl border bg-night-card/80 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.9)] backdrop-blur-md ${palette.border}`}
      >
        <div className={`pointer-events-none absolute inset-0 bg-linear-to-b to-transparent to-60% ${palette.tint}`} />
      </div>

      <div className="relative flex flex-col justify-between px-4 py-3" style={{ height: threadHeader.height }}>
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${palette.dot}`} />
            <Title node={node} act={act} textSize="text-[13px]" className="line-clamp-2 leading-snug font-semibold text-white" />
            {data.phone ? null : (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void act("levelUp", node.id, crypto.randomUUID());
                }}
                title="Level up: log a session of progress"
                className="nodrag shrink-0 rounded-md border border-red-300/30 bg-red-400/12 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-red-200 hover:border-red-200/60 hover:bg-red-400/25 hover:text-red-100"
              >
                ++
              </button>
            )}
          </div>
          <BoxButtons data={data} />
        </div>
        <div>
          <span className="text-[10px] tracking-[0.14em] text-white/45">
            Lv {level.level}
            {node.shelved ? <span className="ml-2 uppercase text-white/60">· Shelved</span> : null}
          </span>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full border border-white/8 bg-night/50">
            <div className={`h-full rounded-full ${palette.bar}`} style={{ width: `${level.percent}%` }} />
          </div>
        </div>
      </div>

      <AddRow data={data} />
      <ResizeGrip data={data} minWidth={200} minHeight={threadHeader.height} />
    </div>
  );
}

function StepCard({ data, height }: NodeProps<Node<CardData>>) {
  const { node, act } = data;
  const done = isDone(node);
  const holdsSteps = data.hasSteps && !data.collapsed;
  // A step made taller than one row shows its whole title, wrapped, instead of cutting it short
  const wraps = !holdsSteps && (height ?? 0) > stepRow.height + (data.adding ? addRowHeight : 0);

  return (
    <div
      className={`group relative h-full w-full rounded-xl border ${done ? "border-white/[0.06]" : "border-white/12"} ${
        holdsSteps ? "bg-white/[0.025]" : done ? "bg-white/[0.015]" : "bg-white/[0.05]"
      } ${data.shelved ? shelvedLook : ""}`}
    >
      <Handles height={stepRow.height} hidden={data.phone} />
      <div
        className={`flex gap-2 px-3 ${wraps ? "items-start py-3" : "items-center"}`}
        style={{ height: wraps ? (height ?? stepRow.height) - (data.adding ? addRowHeight : 0) : stepRow.height }}
      >
        <Tick done={done} onClick={() => void act("updateNode", node.id, { done: !done })} className="nodrag" />
        <Title
          node={node}
          act={act}
          textSize="text-xs"
          className={`flex-1 ${wraps ? "overflow-hidden break-words leading-snug" : "truncate"} ${done ? "text-white/35 line-through decoration-white/25" : "text-white/90"}`}
        />
        <BoxButtons data={data} />
      </div>
      <AddRow data={data} />
      <ResizeGrip data={data} minWidth={110} minHeight={stepRow.height} />
    </div>
  );
}

const nodeTypes = { thread: ThreadCard, step: StepCard };

// A shelved box is greyed but works as usual, so it can be unshelved or ticked
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
        className={`nodrag nopan min-w-0 flex-1 rounded-md border border-white/20 bg-night/70 px-1.5 py-0.5 text-white/90 focus:outline-none ${textSize}`}
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

// Edges attach at the middle of the header row. On the phone, where linking is left to the
// agent, the dots are hidden but still anchor the edges.
function Handles({ height, hidden }: { height: number; hidden: boolean }) {
  const style = { top: height / 2 };
  // nodrag: pressing a dot draws a link rather than dragging the node
  const look = hidden ? "!invisible" : "nodrag !h-2.5 !w-2.5 !border-white/35 !bg-night-panel";
  return (
    <>
      <Handle type="target" position={Position.Left} style={style} className={look} />
      <Handle type="source" position={Position.Right} style={style} className={look} />
    </>
  );
}

// The top-right buttons of every box: hide/show its steps, add a step inside, then ⋯
// on a thread or delete on a step
function BoxButtons({ data }: { data: CardData }) {
  const { depth, hasSteps, collapsed, adding, onToggleCollapsed, onAdding } = data;
  if (data.phone) return <PhoneMenu data={data} />;

  return (
    <div className="flex shrink-0 items-center gap-1">
      {hasSteps ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapsed();
          }}
          title={collapsed ? "Show steps" : "Hide steps"}
          className="nodrag flex h-6 w-6 items-center justify-center rounded-md text-white/40 hover:bg-white/8 hover:text-white/80"
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
        className={`nodrag ${boxButton} rounded-[5px] border border-emerald-300/35 bg-emerald-400/12 text-emerald-200 hover:border-emerald-200/60 hover:bg-emerald-400/25 hover:text-emerald-100`}
      >
        <PlusIcon />
      </button>
      {depth === 0 ? (
        <MenuButton data={data} />
      ) : (
        <>
          <ShelveButton data={data} />
          <DeleteButton data={data} />
        </>
      )}
    </div>
  );
}

// Shelves or unshelves a step; shown on hover, and always on a shelved step so it can be undone
function ShelveButton({ data }: { data: CardData }) {
  const { node, act } = data;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void act("updateNode", node.id, { shelved: !node.shelved });
      }}
      title={node.shelved ? "Unshelve: pursue it again" : "Shelve: keep it, but not now"}
      className={`nodrag ${boxButton} rounded-[5px] border border-white/20 text-[9px] leading-none text-white/60 hover:border-white/40 hover:text-white/90 ${
        node.shelved ? "" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
      }`}
    >
      ❚❚
    </button>
  );
}

// A red × in a circle; the first click asks "Delete?", a second deletes the step and its steps
function DeleteButton({ data }: { data: CardData }) {
  const { node, act } = data;
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
      className={`nodrag ${boxButton} rounded-full border ${
        confirming
          ? "border-red-300/60 bg-red-500/25 px-2 text-[10px] leading-none text-red-100"
          : "border-red-300/45 text-red-300/85 hover:border-red-200/70 hover:bg-red-500/15 hover:text-red-100"
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

// The + and × share one bounding box (the × widens only to ask "Delete?")
const boxButton = "flex h-[18px] min-w-[18px] shrink-0 items-center justify-center";

// A small grip at a box's bottom-right corner for resizing it (desktop only); the new size is kept
function ResizeGrip({ data, minWidth, minHeight }: { data: CardData; minWidth: number; minHeight: number }) {
  if (data.phone) return null;
  return (
    <NodeResizeControl
      position="bottom-right"
      minWidth={minWidth}
      minHeight={minHeight}
      onResize={(_event, { width, height }) => data.onResizing({ width, height })}
      onResizeEnd={(_event, { width, height }) => data.onResized({ width, height })}
      style={{ background: "transparent", border: "none" }}
    >
      <svg viewBox="0 0 10 10" className="absolute -top-3 -left-3 h-2.5 w-2.5 text-white/25 hover:text-white/60" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <path d="M9 3 L3 9 M9 6 L6 9" />
      </svg>
    </NodeResizeControl>
  );
}

// The input row at the bottom of a box being added to; Enter adds and stays open, Escape closes
function AddRow({ data }: { data: CardData }) {
  const { node, adding, act, onAdding } = data;
  if (!adding) return null;

  return (
    <div className="absolute right-0 bottom-0 left-0 flex items-center px-3" style={{ height: addRowHeight }}>
      <InlineInput autoFocus placeholder="Step name, Enter to add" onSubmit={(title) => act("createNode", title, node.id)} onEscape={() => onAdding(false)} className="w-full px-2.5 py-1" />
    </div>
  );
}

// A thread's ⋯ button and its small menu: its colour, the stats it trains, layout, hide, delete
function MenuButton({ data }: { data: CardData }) {
  const { node, menuOpen, act, onMenu } = data;
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The menu opens on whichever side of the card has more room in the canvas, so it is never cut off
  const [side, setSide] = useState(Position.Bottom);

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          const card = event.currentTarget.closest(".react-flow__node")?.getBoundingClientRect();
          const canvas = event.currentTarget.closest(".react-flow")?.getBoundingClientRect();
          if (card && canvas) setSide(canvas.bottom - card.bottom >= card.top - canvas.top ? Position.Bottom : Position.Top);
          setConfirmDelete(false);
          onMenu(!menuOpen);
        }}
        title="Options"
        className="nodrag flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-sm leading-none text-white/40 hover:bg-white/8 hover:text-white/80"
      >
        ⋯
      </button>

      <NodeToolbar isVisible={menuOpen} position={side} align="end" offset={6}>
        <div className="nodrag nopan w-60 space-y-2 rounded-xl border border-white/12 bg-night-card/95 p-3 text-xs text-white/75 shadow-xl">
          <ColorPicker node={node} act={act} />
          <StatWeightsEditor node={node} act={act} />

          <button
            type="button"
            onClick={() => {
              void act("resetLayout", data.subtreeIds());
              onMenu(false);
            }}
            className="w-full rounded-md border border-white/10 px-2 py-1 text-left hover:border-white/24"
          >
            Reset layout: place this thread automatically
          </button>

          <div className="flex justify-between gap-2 pt-1">
            <button type="button" onClick={() => void act("updateNode", node.id, { active: false })} className="rounded-md border border-white/10 px-2 py-1 hover:border-white/24">
              Hide thread
            </button>
            <button type="button" onClick={() => void act("updateNode", node.id, { shelved: !node.shelved })} className="rounded-md border border-white/10 px-2 py-1 hover:border-white/24">
              {node.shelved ? "Unshelve" : "Shelve"}
            </button>
            <button
              type="button"
              onClick={() => (confirmDelete ? void act("deleteNode", node.id) : setConfirmDelete(true))}
              className="rounded-md border border-red-400/30 px-2 py-1 text-red-200 hover:border-red-300/50"
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
  const { node, depth, hasSteps, collapsed, menuOpen, act, onMenu, onToggleCollapsed, onAdding } = data;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isThread = depth === 0;
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
        className="nodrag flex h-6 w-8 shrink-0 items-center justify-center rounded-lg text-base leading-none text-white/55 active:bg-white/10"
      >
        ⋯
      </button>

      {menuOpen
        ? createPortal(
          <div className="fixed inset-0 z-[60] flex items-end bg-night/60" onClick={() => onMenu(false)}>
            <div
              onClick={(event) => event.stopPropagation()}
              className="w-full rounded-t-3xl border-t border-white/12 bg-night-card p-3 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm text-white/85 shadow-[0_-20px_60px_rgba(0,0,0,0.6)]"
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
                className="mb-1 w-full rounded-lg border border-white/10 bg-night/70 px-3 py-2 text-sm text-white/90 focus:border-white/30 focus:outline-none"
              />
              <button type="button" onClick={choose(() => onAdding(true))} className={phoneItem}>
                <PlusIcon /> Add a step inside
              </button>
              {hasSteps ? (
                <button type="button" onClick={choose(onToggleCollapsed)} className={phoneItem}>
                  <EyeIcon crossed={!collapsed} /> {collapsed ? "Show steps" : "Hide steps"}
                </button>
              ) : null}
              {isThread ? (
                <>
                  <button type="button" onClick={choose(() => act("levelUp", node.id, crypto.randomUUID()))} className={phoneItem}>
                    <span className="text-[10px] font-semibold text-red-200">++</span> Level up
                  </button>
                  <div className={phoneItem}>
                    <ColorPicker node={node} act={act} />
                  </div>
                  <div className={phoneItem}>
                    <StatWeightsEditor node={node} act={act} />
                  </div>
                  <button type="button" onClick={choose(() => act("updateNode", node.id, { active: false }))} className={phoneItem}>
                    Hide thread
                  </button>
                </>
              ) : null}
              <button type="button" onClick={choose(() => act("updateNode", node.id, { shelved: !node.shelved }))} className={phoneItem}>
                <span className="text-[9px] text-white/60">❚❚</span> {node.shelved ? "Unshelve: pursue it again" : "Shelve: keep it, but not now"}
              </button>
              <button
                type="button"
                onClick={() => (confirmDelete ? void act("deleteNode", node.id) : setConfirmDelete(true))}
                className={`${phoneItem} text-red-200`}
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

const phoneItem = "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left active:bg-white/10";

// Puts every node back to automatic placement; the first click asks
function ResetLayoutButton({ onReset }: { onReset: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        if (confirming) onReset();
        setConfirming(!confirming);
      }}
      onBlur={() => setConfirming(false)}
      className={`rounded-full border bg-night-panel/80 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.18em] backdrop-blur-sm ${
        confirming ? "border-red-400/40 text-red-200" : "border-white/10 text-white/70 hover:border-white/25 hover:text-white"
      }`}
    >
      {confirming ? "Reset every box?" : "Reset layout"}
    </button>
  );
}

// One swatch per colour, plus white for none
function ColorPicker({ node, act }: { node: GraphNode; act: Act }) {
  const choices: (ThreadColor | null)[] = [null, ...threadColors];
  return (
    <div className="flex w-full justify-between" role="radiogroup" aria-label="Colour">
      {choices.map((color) => (
        <button
          key={color ?? "none"}
          type="button"
          role="radio"
          aria-checked={node.color === color}
          aria-label={color ?? "white"}
          title={color ?? "white"}
          onClick={() => void act("updateNode", node.id, { color })}
          className={`flex h-6 w-6 items-center justify-center rounded-full border ${node.color === color ? "border-white/70" : "border-transparent hover:border-white/25"}`}
        >
          <span className={`h-3.5 w-3.5 rounded-full ${palettes[color ?? "none"].dot}`} />
        </button>
      ))}
    </div>
  );
}

// The weight of each stat the thread trains: each XP in the thread adds weight × XP to the stat.
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

  return (
    <div className="w-full">
      <span className="text-white/45">Trains (XP × weight)</span>
      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
        {statKeys.map((key) => (
          <label key={key} className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] tracking-[0.12em] text-white/55">{key}</span>
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
              className="w-12 rounded-md border border-white/10 bg-night/70 px-1.5 py-0.5 text-right text-xs text-white/85 [appearance:textfield] focus:border-white/30 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
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

// Lays out every rendered level. Inside a box, steps the user has placed keep their place and
// the rest are laid out automatically (prerequisites to the left) below them. A box is as big as
// its content needs, or bigger if the user made it so; a step with nothing inside it takes the
// size the user gave it. Threads are placed on the canvas the same way.
async function layoutTree(
  threads: GraphNode[],
  edges: GraphEdge[],
  visibleSteps: (id: string) => GraphNode[],
  addingTo: string | null,
) {
  const placements: Record<string, Box> = {};

  // Unlinked steps inside a box pack closer than separate threads
  const layoutLevel = async (nodes: GraphNode[], sizes: Size[], nested: boolean): Promise<ElkNode> => {
    const ids = new Set(nodes.map((node) => node.id));
    return elk.layout({
      id: "level",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.padding": "[top=0,left=0,bottom=0,right=0]",
        "elk.spacing.nodeNode": nested ? "12" : "22",
        "elk.layered.spacing.nodeNodeBetweenLayers": "48",
        "elk.spacing.componentComponent": nested ? "12" : "40",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      },
      children: nodes.map((node, i) => ({ id: node.id, ...sizes[i] })),
      edges: edges
        .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
        .map((edge, i) => ({ id: `e${i}`, sources: [edge.from], targets: [edge.to] })),
    });
  };

  // Places `nodes` in a box whose content starts at `origin`; returns the content's far corner
  const arrange = async (nodes: GraphNode[], sizes: Size[], origin: XYPosition, nested: boolean) => {
    let right = origin.x;
    let bottom = origin.y;
    const extend = (position: XYPosition, size: Size) => {
      right = Math.max(right, position.x + size.width);
      bottom = Math.max(bottom, position.y + size.height);
    };

    nodes.forEach((node, i) => {
      if (!node.position) return;
      placements[node.id] = { position: node.position, size: sizes[i] };
      extend(node.position, sizes[i]);
    });

    const loose = nodes.flatMap((node, i) => (node.position ? [] : [{ node, size: sizes[i] }]));
    if (loose.length > 0) {
      const result = await layoutLevel(
        loose.map(({ node }) => node),
        loose.map(({ size }) => size),
        nested,
      );
      const top = bottom > origin.y ? bottom + (nested ? 12 : 40) : origin.y;
      (result.children ?? []).forEach((child) => {
        const { size } = loose.find(({ node }) => node.id === child.id)!;
        const position = { x: origin.x + (child.x ?? 0), y: top + (child.y ?? 0) };
        placements[child.id] = { position, size };
        extend(position, size);
      });
    }
    return { right, bottom };
  };

  const measure = async (node: GraphNode, depth: number): Promise<Size> => {
    const header = depth === 0 ? threadHeader : stepRow;
    const addRow = node.id === addingTo ? addRowHeight : 0;
    const steps = visibleSteps(node.id);
    if (steps.length === 0) {
      return { width: node.size?.width ?? header.width, height: Math.max(node.size?.height ?? 0, header.height + addRow) };
    }

    const sizes = await Promise.all(steps.map((step) => measure(step, depth + 1)));
    const { right, bottom } = await arrange(steps, sizes, { x: padding, y: header.height }, true);
    return {
      width: Math.max(header.width, right + padding, node.size?.width ?? 0),
      height: Math.max(bottom + (addRow || padding / 2), node.size?.height ?? 0),
    };
  };

  const sizes = await Promise.all(threads.map((thread) => measure(thread, 0)));
  await arrange(threads, sizes, { x: 0, y: 0 }, false);

  return placements;
}

function subtreeOf(model: GraphModel, id: string): string[] {
  return [id, ...(model.children.get(id) ?? []).flatMap((child) => subtreeOf(model, child.id))];
}

// The boxes whose steps are hidden, kept between sessions
function loadIds(storageKey: string): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveIds(storageKey: string, ids: Set<string>) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...ids]));
  } catch {
    // Storage blocked: collapsed boxes open again next time
  }
}
