import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type XYPosition,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { nodeLevel } from "../../shared/progression";
import type { GraphEdge, GraphNode, Snapshot, StatKey } from "../../shared/types";
import type { Act } from "./HomePage";
import { isDone, statKeys, type GraphModel } from "./graphModel";
import { InlineInput } from "./InlineInput";
import { Tick } from "./Tick";

// Box sizes. A thread is a header above its steps; a step is a row that grows into a box when
// it holds steps of its own. A box being added to gets an input row at the bottom.
const threadHeader = { width: 264, height: 76 };
const stepRow = { width: 248, height: 40 };
const addRowHeight = 40;
const padding = 16;
const collapsedStorageKey = "ashborn-collapsed";

const elk = new ELK();

type Size = { width: number; height: number };
type Placement = { position: XYPosition; size: Size }; // position is relative to the parent

type CardData = {
  node: GraphNode;
  depth: number;
  xp: number;
  hasSteps: boolean;
  collapsed: boolean;
  adding: boolean;
  menuOpen: boolean;
  act: Act;
  onToggleCollapsed: () => void;
  onAdding: (open: boolean) => void;
  onMenu: (open: boolean) => void;
};

type ThreadGraphProps = {
  snapshot: Snapshot;
  model: GraphModel;
  act: Act;
};

export function ThreadGraph(props: ThreadGraphProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}

function GraphCanvas({ snapshot, model, act }: ThreadGraphProps) {
  const { fitView } = useReactFlow();
  const [placements, setPlacements] = useState<Record<string, Placement>>({});
  const [collapsed, setCollapsed] = useState(() => loadIds(collapsedStorageKey));
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const fittedFor = useRef<string | null>(null);

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
    rendered.map(({ node }) => node.id),
    renderedEdges.map((edge) => [edge.from, edge.to]),
    addingTo,
  ]);
  const topKey = shown.map((thread) => thread.id).join();

  // Re-layout only when the rendered structure changes, not on every level-up
  useEffect(() => {
    let cancelled = false;

    void layoutTree(shown, renderedEdges, visibleSteps, addingTo).then((next) => {
      if (!cancelled) setPlacements(next);
    });

    return () => {
      cancelled = true;
    };
  }, [structureKey]);

  // Fit the view when the set of threads shown changes, not on every step edit. React Flow
  // takes the new positions into its store after this render, so fit a moment later.
  useEffect(() => {
    if (fittedFor.current === topKey || Object.keys(placements).length === 0) return;
    fittedFor.current = topKey;
    const timeout = window.setTimeout(() => void fitView({ duration: 300, padding: 0.15, maxZoom: 1.1 }), 60);

    return () => window.clearTimeout(timeout);
  }, [placements, fitView]);

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
        const size = placement?.size ?? (depth === 0 ? threadHeader : stepRow);
        return {
          id: node.id,
          type: depth === 0 ? "thread" : "step",
          parentId: node.parentId ?? undefined,
          extent: node.parentId ? ("parent" as const) : undefined,
          position: placement?.position ?? { x: 0, y: 0 },
          draggable: false,
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
            collapsed: collapsed.has(node.id),
            adding: addingTo === node.id,
            menuOpen: menuFor === node.id,
            act,
            onToggleCollapsed: () => setCollapsedFor(node.id, !collapsed.has(node.id)),
            // Adding to a collapsed box opens it, so the new steps are seen
            onAdding: (open: boolean) => {
              if (open) setCollapsedFor(node.id, false);
              setAddingTo(open ? node.id : null);
            },
            onMenu: (open: boolean) => setMenuFor(open ? node.id : null),
          },
        };
      }),
    [snapshot, model, placements, collapsed, addingTo, menuFor],
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
          markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(255,255,255,0.45)" },
          style: {
            stroke: isSelected ? "rgba(167,243,208,0.9)" : met ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.35)",
            strokeWidth: isSelected ? 2 : 1.4,
            strokeDasharray: met && !isSelected ? "4 4" : undefined,
          },
        };
      }),
    [snapshot, model, selectedEdge, collapsed],
  );

  // Dragging against an existing link (from its head back to its tail) removes it
  const connect = ({ source, target }: Connection) => {
    const reverse = snapshot.edges.find((edge) => edge.from === target && edge.to === source);
    if (reverse) void act("removeEdge", reverse);
    else void act("addEdge", { from: source, to: target });
  };

  return (
    <ReactFlow
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
      nodesDraggable={false}
      zoomOnDoubleClick={false}
      deleteKeyCode={null}
      minZoom={0.15}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
      className="!bg-transparent"
    >
      <Background color="rgba(255,255,255,0.08)" gap={24} />
      <Controls position="bottom-left" showInteractive={false} fitViewOptions={{ duration: 300, padding: 0.15, maxZoom: 1.1 }} />

      {threads.length > 0 ? (
        <Panel position="top-left" className="flex flex-col items-start gap-2">
          <div className="flex items-center gap-2">
            <InlineInput placeholder="+ New thread" onSubmit={(title) => act("createNode", title, null)} className="w-48" />
            <button
              type="button"
              onClick={() => setThreadsOpen((open) => !open)}
              className="rounded-lg border border-white/12 bg-black/40 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/70 hover:border-white/22 hover:text-white/88"
            >
              Threads {shown.length}/{threads.length}
            </button>
          </div>

          {threadsOpen ? (
            <div className="w-72 rounded-xl border border-white/12 bg-black/80 p-3 backdrop-blur-md">
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
        <Panel position="bottom-center" className="flex items-center gap-3 rounded-xl border border-white/12 bg-black/80 px-3 py-2 text-xs text-white/70 backdrop-blur-md">
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

  return (
    <div className="relative h-full w-full rounded-2xl border border-white/14 bg-black/45 backdrop-blur-md">
      <Handles height={threadHeader.height} />

      <div className="flex flex-col justify-between px-3.5 py-3" style={{ height: threadHeader.height }}>
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <Title node={node} act={act} textSize="text-[13px]" className="line-clamp-2 leading-snug text-white/90" />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void act("levelUp", node.id);
              }}
              title="Level up: log a session of progress"
              className="nodrag shrink-0 rounded-md border border-red-300/30 bg-red-400/12 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-red-200 hover:border-red-200/60 hover:bg-red-400/25 hover:text-red-100"
            >
              ++
            </button>
          </div>
          <BoxButtons data={data} />
        </div>
        <div>
          <span className="text-[10px] tracking-[0.14em] text-white/45">Lv {level.level}</span>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full border border-white/8 bg-black/30">
            <div className="h-full rounded-full bg-emerald-300/80" style={{ width: `${level.percent}%` }} />
          </div>
        </div>
      </div>

      <AddRow data={data} />
    </div>
  );
}

function StepCard({ data, height }: NodeProps<Node<CardData>>) {
  const { node, act } = data;
  const done = isDone(node);
  const holdsSteps = (height ?? 0) > stepRow.height;

  return (
    <div
      className={`relative h-full w-full rounded-xl border ${done ? "border-white/8" : "border-white/12"} ${
        holdsSteps ? "bg-white/[0.03]" : done ? "bg-black/25" : "bg-black/55"
      }`}
    >
      <Handles height={stepRow.height} />
      <div className="flex items-center gap-2 px-3" style={{ height: stepRow.height }}>
        <Tick done={done} onClick={() => void act("updateNode", node.id, { done: !done })} className="nodrag" />
        <Title
          node={node}
          act={act}
          textSize="text-xs"
          className={`flex-1 truncate ${done ? "text-white/40 line-through decoration-white/25" : "text-white/85"}`}
        />
        <BoxButtons data={data} />
      </div>
      <AddRow data={data} />
    </div>
  );
}

const nodeTypes = { thread: ThreadCard, step: StepCard };

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
        className={`nodrag nopan min-w-0 flex-1 rounded-md border border-white/20 bg-black/50 px-1.5 py-0.5 text-white/90 focus:outline-none ${textSize}`}
      />
    );
  }

  return (
    <p
      onDoubleClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
      title="Double-click to rename"
      className={`min-w-0 cursor-text ${textSize} ${className}`}
    >
      {node.title}
    </p>
  );
}

// Edges attach at the middle of the header row
function Handles({ height }: { height: number }) {
  const style = { top: height / 2 };
  return (
    <>
      <Handle type="target" position={Position.Left} style={style} className="!h-2.5 !w-2.5 !border-white/40 !bg-black" />
      <Handle type="source" position={Position.Right} style={style} className="!h-2.5 !w-2.5 !border-white/40 !bg-black" />
    </>
  );
}

// The top-right buttons of every box: hide/show its steps, add a step inside, then ⋯
// on a thread or delete on a step
function BoxButtons({ data }: { data: CardData }) {
  const { depth, hasSteps, collapsed, adding, onToggleCollapsed, onAdding } = data;

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
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <path d="M1.5 8 C3.5 4.2 12.5 4.2 14.5 8 C12.5 11.8 3.5 11.8 1.5 8 Z" />
            <circle cx="8" cy="8" r="2" />
            {collapsed ? <path d="M2.5 13.5 L13.5 2.5" /> : null}
          </svg>
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
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M5 1 V9 M1 5 H9" />
        </svg>
      </button>
      {depth === 0 ? <MenuButton data={data} /> : <DeleteButton data={data} />}
    </div>
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
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 2 L8 8 M8 2 L2 8" />
        </svg>
      )}
    </button>
  );
}

// The + and × share one bounding box (the × widens only to ask "Delete?")
const boxButton = "flex h-[18px] min-w-[18px] shrink-0 items-center justify-center";

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

// A thread's ⋯ button and its small menu: the stat it trains, hide, delete
function MenuButton({ data }: { data: CardData }) {
  const { node, menuOpen, act, onMenu } = data;
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setConfirmDelete(false);
          onMenu(!menuOpen);
        }}
        title="Options"
        className="nodrag flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-sm leading-none text-white/40 hover:bg-white/8 hover:text-white/80"
      >
        ⋯
      </button>

      <NodeToolbar isVisible={menuOpen} position={Position.Bottom} align="end" offset={6}>
        <div className="nodrag nopan w-60 space-y-2 rounded-xl border border-white/14 bg-black/90 p-3 text-xs text-white/75 shadow-xl">
          <MenuRow label="Trains">
            <select
              value={node.stat ?? ""}
              onChange={(event) => void act("updateNode", node.id, { stat: (event.target.value || null) as StatKey | null })}
              className="rounded-md border border-white/12 bg-black/50 px-2 py-1 text-xs text-white/85"
            >
              <option value="">no stat</option>
              {statKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </MenuRow>

          <div className="flex justify-between gap-2 pt-1">
            <button type="button" onClick={() => void act("updateNode", node.id, { active: false })} className="rounded-md border border-white/12 px-2 py-1 hover:border-white/24">
              Hide thread
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

function MenuRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/45">{label}</span>
      {children}
    </div>
  );
}

// Lays out every rendered level: each open node's steps inside it (prerequisites to the left),
// then the threads using the sizes that gives them.
async function layoutTree(
  threads: GraphNode[],
  edges: GraphEdge[],
  visibleSteps: (id: string) => GraphNode[],
  addingTo: string | null,
) {
  const placements: Record<string, Placement> = {};

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

  const measure = async (node: GraphNode, depth: number): Promise<Size> => {
    const header = depth === 0 ? threadHeader : stepRow;
    const addRow = node.id === addingTo ? addRowHeight : 0;
    const steps = visibleSteps(node.id);
    if (steps.length === 0) return { width: header.width, height: header.height + addRow };

    const sizes = await Promise.all(steps.map((step) => measure(step, depth + 1)));
    const result = await layoutLevel(steps, sizes, true);
    (result.children ?? []).forEach((child) => {
      const i = steps.findIndex((step) => step.id === child.id);
      placements[child.id] = {
        position: { x: (child.x ?? 0) + padding, y: (child.y ?? 0) + header.height },
        size: sizes[i],
      };
    });
    return {
      width: Math.max(header.width, (result.width ?? 0) + 2 * padding),
      height: header.height + (result.height ?? 0) + (addRow || padding / 2),
    };
  };

  const sizes = await Promise.all(threads.map((thread) => measure(thread, 0)));
  const result = await layoutLevel(threads, sizes, false);
  (result.children ?? []).forEach((child) => {
    const i = threads.findIndex((thread) => thread.id === child.id);
    placements[child.id] = { position: { x: child.x ?? 0, y: child.y ?? 0 }, size: sizes[i] };
  });

  return placements;
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
