import ELK, { type ElkNode } from "elkjs/lib/elk-api.js";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import {
  Controls,
  Handle,
  MarkerType,
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
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HEX_POINTS, HexMark } from "../../components/HexTile";
import { paletteOf } from "../../lib/theme";
import { useToday } from "../../lib/useToday";
import { isDone, isFinished, statKeys, type GraphModel } from "../../shared/graphModel";
import { dayOf } from "../../shared/dates";
import { inboxLast } from "../../shared/inbox";
import { byPriority, derivePriorities, linkPriority } from "../../shared/priority";
import { nodeLevel } from "../../shared/progression";
import { packQuests, prerequisitesFirst, type Canvas, type Size } from "../../shared/questPacking";
import { type GraphEdge, type GraphNode, type ISODate, type Priority, type Snapshot, type StatKey, type StatWeights } from "../../shared/types";
import { MoveTargets, MoveToPicker } from "./Capture";
import type { Act } from "./HomePage";
import { InlineInput } from "./InlineInput";
import { SplitContext, SplitSteps } from "./SplitSteps";
import { useIsNowStep } from "./nowMirror";
import { onShowOnGraph, takeWaitingShow } from "./showOnGraph";
import { sharpen, usePhonePanZoom } from "./phonePanZoom";
import Territories from "./territory/Territories";
import type { TerritoryQuest } from "./territory/territoryGrid";
import { Tick } from "./Tick";
import { fontsLoaded, labelWidth, lineHeight, measureTitles, titleLines, type TitleText } from "./titleLines";

// Box sizes. A quest is a header above its steps; a step is a row that grows into a box when
// it holds steps of its own. A box being added to gets an input row at the bottom.
const questHeader = { width: 264, height: 76 };
const stepRow = { width: 248, height: 40 };
const addRowHeight = 40;
const padding = 16;
// Titles wrap to three lines (titleMaxLines, line-clamp-3 on the cards), and a card grows by a
// line's height for each line past the first. Below, the classes and fixed parts that set the
// room a title has.
const questTitleType = "font-display text-[14px] leading-snug font-semibold break-words";
const stepTitleType = (holdsSteps: boolean) => `text-[12.5px] break-words ${holdsSteps ? "font-medium" : ""}`;
const plusOneButton = "rounded-md bg-ember/15 px-1.5 py-[3px] font-mono text-[10px] leading-none font-semibold text-ember hover:bg-ember/25";
const nowPill = "rounded bg-ember/15 px-1 font-mono text-[10px] font-semibold text-ember";
// Every step row keeps room for the Now pill or its P label, so Now moving never changes a height
const labelSlot = 32;
const iconSize = 24; // iconButton
const phoneMenuWidth = 32;
// Where nothing can hover (a touch screen in the desktop layout), a quest's buttons stay in its
// header: group-hover never applies there
const canHover = window.matchMedia("(hover: hover)").matches;
const questGap = 40;
// The quest menu's height with its longest labels, and the room the toolbar takes over the canvas
const questMenuHeight = 400;
const canvasToolbarHeight = 64;
// Links in the theme's ink: a met prerequisite fades
const linkOpen = "color-mix(in oklab, var(--color-ink) 34%, transparent)";
const linkDone = "color-mix(in oklab, var(--color-ink) 15%, transparent)";
const collapsedStorageKey = "ashborn-collapsed";
// Quests are locked unless the user unlocked them, so only the unlocked ones are kept
const unlockedStorageKey = "ashborn-unlocked";
// Finished boxes the user opened, with the day they did; open until the next day starts
const openedStorageKey = "ashborn-opened";

const fitOptions = { padding: 0.15, maxZoom: 1.1 };
const zoomRange = { min: 0.15, max: 2 };

// On the phone the quests stand in one column, too tall to fit. The view opens on its top, zoomed
// so the widest box fits the screen's width (never above 1); the rest is a scroll away.
const PHONE_MARGIN = 12;
// Room at the top for the toolbar (+ New quest, Quests) that floats over the canvas
const PHONE_TOOLBAR_HEIGHT = 48;

function phoneViewport(shown: GraphNode[], placements: Record<string, Box>, paneWidth: number) {
  const boxes = shown.flatMap((quest) => (placements[quest.id] ? [placements[quest.id]] : []));
  const left = Math.min(...boxes.map((box) => box.position.x));
  const top = Math.min(...boxes.map((box) => box.position.y));
  const right = Math.max(...boxes.map((box) => box.position.x + box.size.width));
  const zoom = Math.min(1, Math.max(zoomRange.min, (paneWidth - 2 * PHONE_MARGIN) / (right - left)));
  return { x: PHONE_MARGIN - left * zoom, y: PHONE_TOOLBAR_HEIGHT + PHONE_MARGIN - top * zoom, zoom };
}

// The phone's camera on one node, at the overview's zoom, a third of the way down the pane; a node
// not laid out (folded away) gives its nearest box that is
function phoneFocus(id: string, model: GraphModel, placements: Record<string, Box>, zoom: number, paneWidth: number, paneHeight: number) {
  let target: string | null = id;
  while (target && !placements[target]) target = model.byId.get(target)?.parentId ?? null;
  if (!target) return null;
  // Each box sits relative to its parent box
  const corner = { x: 0, y: 0 };
  for (let at: string | null = target; at; at = model.byId.get(at)?.parentId ?? null) {
    corner.x += placements[at]?.position.x ?? 0;
    corner.y += placements[at]?.position.y ?? 0;
  }
  const { size } = placements[target];
  return {
    target,
    viewport: { x: paneWidth / 2 - (corner.x + size.width / 2) * zoom, y: paneHeight / 3 - (corner.y + size.height / 2) * zoom, zoom },
  };
}

const nodeElement = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);

// Marks a node on screen for a moment
function flash(id: string) {
  const element = nodeElement(id);
  if (!element) return;
  element.classList.remove("node-flash");
  void element.offsetWidth; // restarts the animation when asked twice in a row
  element.classList.add("node-flash");
  window.setTimeout(() => element.classList.remove("node-flash"), 1600);
}

// ELK (1.6 MB) is loaded and runs in a worker, so neither holds the main thread
const elk = new ELK({ workerUrl: elkWorkerUrl });
// Each box's layout is kept by its input (its nodes in order, their sizes, its links), so a
// relayout sends the worker only the boxes that changed. Oldest dropped first.
const levelLayouts = new Map<string, ElkNode>();
const maxLevelLayouts = 500;

// position is relative to the parent box; header is the height of its title row
type Box = { position: XYPosition; size: Size; header: number };
type Measured = Size & { header: number };
// What sits beside a card's title, which sets the room the title has
type CardShape = { phone: boolean; hasSteps: (id: string) => boolean; collapsed: (id: string) => boolean; folded: (id: string) => boolean };

// A card's data holds only values, so it stays the same object while they do, and React Flow and
// the memoised cards skip it
type CardData = {
  node: GraphNode;
  depth: number;
  header: number; // the height of its title row, which grows as the title wraps
  xp: number;
  hasSteps: boolean;
  shelved: boolean; // shelved itself, or inside a shelved box: shown greyed
  collapsed: boolean;
  folded: number | null; // a finished box folded to one line: how many steps it holds
  earlierDone: number; // a quest: its steps finished on an earlier day, hidden unless opened today
  showsDone: boolean; // a quest opened today: those steps are shown
  locked: boolean; // the quest it sits in, or is, keeps its steps where they are
  adding: boolean;
  menuOpen: boolean;
  look: PriorityLook;
  phone: boolean; // view-only placement, and one labelled menu instead of the small buttons
  sortable: boolean; // a step in the Inbox: offers Move to…
  actions: CardActions;
};

// How a card shows priority: a quest box the most urgent inside it, a step its own chain's
type PriorityLook = Priority | undefined;

// What a card can do, one object shared by every card; each takes the card's node id
type CardActions = {
  act: Act;
  toggleCollapsed: (id: string) => void;
  open: (id: string) => void; // a folded box, or a quest's earlier done steps, until the next day starts
  close: (id: string) => void;
  toggleLocked: (id: string) => void;
  setAdding: (id: string, open: boolean) => void;
  setMenu: (id: string, open: boolean) => void;
  subtreeIds: (id: string) => string[]; // the node and every step inside it
};

type QuestGraphProps = {
  snapshot: Snapshot;
  model: GraphModel;
  act: Act;
  phone: boolean;
};

export function QuestGraph(props: QuestGraphProps) {
  const { model, snapshot } = props;
  const { inboxId } = snapshot;
  const moveTargets = useMemo(() => ({ model, inboxId }), [model, inboxId]);
  const splitContext = useMemo(() => ({ model, snapshot }), [model, snapshot]);
  return (
    <ReactFlowProvider>
      <MoveTargets.Provider value={moveTargets}>
        <SplitContext.Provider value={splitContext}>
          <GraphCanvas {...props} />
        </SplitContext.Provider>
      </MoveTargets.Provider>
    </ReactFlowProvider>
  );
}

function GraphCanvas({ snapshot, model, act, phone }: QuestGraphProps) {
  const { fitView, setViewport } = useReactFlow();
  const latestModel = useRef(model);
  latestModel.current = model;

  // A new quest opens straight onto Split, its first steps being the obvious next question
  const newQuest = (title: string) => {
    const id = crypto.randomUUID();
    listWanted.add(id);
    void act("createNode", title, null, id);
    setAddingTo(id);
  };

  // Brings a node into view and marks it a moment, as Focus asks; a node folded away or inside a
  // hidden box shows its nearest box on screen instead. The phone's graph is a tab of its own, kept
  // mounted once built: a request made before it was built waits for it, and one made while it is
  // hidden is taken when the tab opens.
  const [asked, setAsked] = useState(() => (phone ? takeWaitingShow() : null));
  useEffect(
    () =>
      onShowOnGraph((id) => {
        takeWaitingShow();
        if (phone) return setAsked(id);
        let target: string | null = id;
        while (target && !nodeElement(target)) target = latestModel.current.byId.get(target)?.parentId ?? null;
        if (!target) return;
        void fitView({ nodes: [{ id: target }], duration: 400, padding: 0.8, maxZoom: 1.1 });
        flash(target);
      }),
    [phone, fitView],
  );
  const [placements, setPlacements] = useState<Record<string, Box>>({});
  // Positions mid-drag, shown until the layout includes them; a layout that lands mid-drag keeps
  // the dragged node's
  const [moving, setMoving] = useState<Record<string, XYPosition>>({});
  const dragging = useRef<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => loadIds(collapsedStorageKey));
  const [unlocked, setUnlocked] = useState(() => loadIds(unlockedStorageKey));
  const [opened, setOpened] = useState(loadOpened);
  const { dayStartHour } = snapshot.settings;
  const today = useToday(dayStartHour);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [questsOpen, setQuestsOpen] = useState(false);
  const fittedFor = useRef<string | null>(null);
  // Hidden until the first layout is fitted: before it, every node sits at the origin
  const [shownYet, setShownYet] = useState(false);
  const phonePanZoom = usePhonePanZoom(phone, zoomRange.min, zoomRange.max);
  const zoomAtMoveStart = useRef(1);

  // A box whose steps are all done folds at once, unless opened today. A folded quest leaves the
  // graph for the Completed list.
  const isFolded = (id: string) => isFinished(model, id) && (opened[id] ?? "") < today;

  const priorities = useMemo(() => derivePriorities(model, snapshot, today), [model, snapshot.edges, snapshot.deadlines, today]);

  // A box shows all its steps, done ones greyed, most urgent first, unless the user collapsed it or
  // it is folded
  const visibleSteps = (id: string) => (collapsed.has(id) || isFolded(id) ? [] : byPriority(model.children.get(id) ?? [], priorities));
  // A step or box finished on an earlier day leaves the graph, unless its quest is opened today
  const doneEarlier = (node: GraphNode) => {
    const finished = model.finishedAt.get(node.id) ?? (node.completedAt ? Date.parse(node.completedAt) : null);
    return finished !== null && dayOf(new Date(finished), dayStartHour) < today;
  };
  const showsDone = (questId: string) => (opened[questId] ?? "") >= today;

  const quests = model.children.get(null) ?? [];
  const completed = quests.filter((quest) => quest.active && isFolded(quest.id));
  // An archived quest is a finished one that is hidden
  const archived = quests.filter((quest) => !quest.active && model.finishedAt.has(quest.id));

  // Rendered nodes, parents before their steps (React Flow needs that order), and the links
  // between them; worked out again only when the graph or what is open changes, not per drag move
  // Titles are measured again once the fonts have loaded
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => void fontsLoaded.then(() => setFontsReady(true)), []);
  const { shown, rendered, stepsOf, depthOf, renderedEdges, structureKey, earlierDone } = useMemo(() => {
    const shown = inboxLast(byPriority(quests.filter((quest) => quest.active && !isFolded(quest.id)), priorities), snapshot.inboxId);
    const rendered: Array<{ node: GraphNode; depth: number; questId: string }> = [];
    // Per quest, how many of its steps finished on an earlier day, shown or not
    const earlierDone = new Map<string, number>();
    // Per box, its steps that are drawn, which layout sizes and places
    const stepsOf = new Map<string, GraphNode[]>();
    const visit = (node: GraphNode, depth: number, questId: string) => {
      rendered.push({ node, depth, questId });
      const steps: GraphNode[] = [];
      visibleSteps(node.id).forEach((step) => {
        if (doneEarlier(step)) {
          earlierDone.set(questId, (earlierDone.get(questId) ?? 0) + 1);
          if (!showsDone(questId)) return;
        }
        steps.push(step);
        visit(step, depth + 1, questId);
      });
      stepsOf.set(node.id, steps);
    };
    shown.forEach((quest) => visit(quest, 0, quest.id));
    const depthOf = new Map(rendered.map(({ node, depth }) => [node.id, depth]));
    const renderedEdges = snapshot.edges.filter((edge) => depthOf.has(edge.from) && depthOf.has(edge.to));
    const structureKey = JSON.stringify([
      rendered.map(({ node }) => [node.id, node.position, node.title, model.children.has(node.id)]),
      renderedEdges.map((edge) => [edge.from, edge.to]),
      addingTo,
      fontsReady,
      phone,
    ]);
    return { shown, rendered, stepsOf, depthOf, renderedEdges, structureKey, earlierDone };
  }, [model, snapshot.edges, collapsed, opened, today, dayStartHour, addingTo, priorities, fontsReady, phone]);
  // The set of quests shown, whatever their order: a priority that only reorders them keeps the view
  const topKey = `${phone}:${shown.map((quest) => quest.id).sort().join()}`;

  const paneMeasured = useStore((state) => state.width > 0 && state.height > 0);
  const paneWidth = useStore((state) => state.width);
  const paneHeight = useStore((state) => state.height);

  // Re-layout only when the rendered structure changes, not on every level-up or window resize.
  // Quests pack to the room a fit has; the phone is read by scrolling, so it stays one screen wide.
  useEffect(() => {
    if (!paneMeasured) return;
    let cancelled = false;

    const canvas = { width: paneWidth / (1 + fitOptions.padding), height: paneHeight / (1 + fitOptions.padding), maxZoom: fitOptions.maxZoom };
    const shape: CardShape = { phone, hasSteps: (id) => model.children.has(id), collapsed: (id) => collapsed.has(id), folded: isFolded };
    void layoutTree(shown, renderedEdges, (id) => stepsOf.get(id) ?? [], addingTo, phone ? null : canvas, shape).then((next) => {
      if (cancelled) return;
      setPlacements(next);
      setMoving((current) => {
        const held = dragging.current;
        return held && current[held] ? { [held]: current[held] } : {};
      });
    });

    return () => {
      cancelled = true;
    };
  }, [structureKey, paneMeasured]);

  // Fit the view when the set of quests shown changes, not on every step edit, and only once
  // React Flow knows the canvas size (before that, a fit is silently lost). Nodes carry their
  // sizes, so their bounds are known as soon as they are laid out.
  useEffect(() => {
    if (!paneMeasured || fittedFor.current === topKey || Object.keys(placements).length === 0) return;
    // A frame later React Flow holds the laid-out nodes; a fit cancelled by a newer layout is
    // not counted as done, so the newer one fits instead
    const frame = window.requestAnimationFrame(() => {
      fittedFor.current = topKey;
      const overview = phoneViewport(shown, placements, paneWidth);
      const focus = phone && asked ? phoneFocus(asked, latestModel.current, placements, overview.zoom, paneWidth, paneHeight) : null;
      if (focus) setAsked(null);
      void (phone ? setViewport(focus?.viewport ?? overview) : fitView(fitOptions)).then(() => {
        setShownYet(true);
        if (focus) flash(focus.target);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [placements, paneMeasured, fitView, setViewport, phone, paneWidth, paneHeight, asked]);

  // A node asked for after the phone's view was first framed
  useEffect(() => {
    if (!asked || fittedFor.current !== topKey) return;
    setAsked(null);
    const focus = phoneFocus(asked, latestModel.current, placements, phoneViewport(shown, placements, paneWidth).zoom, paneWidth, paneHeight);
    if (focus) void setViewport(focus.viewport).then(() => flash(focus.target));
  }, [asked, placements]);

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

  // The cards' actions read the latest state through this ref, so `actions` is made once
  const latest = useRef<CardActions>(null!);
  latest.current = {
    act,
    toggleCollapsed: (id) => setCollapsedFor(id, !collapsed.has(id)),
    open: (id) =>
      setOpened((current) => {
        // Only today's openings still count
        const next = Object.fromEntries(Object.entries({ ...current, [id]: today }).filter(([, day]) => day >= today));
        saveOpened(next);
        return next;
      }),
    close: (id) =>
      setOpened((current) => {
        const { [id]: _closed, ...next } = current;
        saveOpened(next);
        return next;
      }),
    toggleLocked: (id) =>
      setUnlocked((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        saveIds(unlockedStorageKey, next);
        return next;
      }),
    // Adding to a collapsed box opens it, so the new steps are seen
    setAdding: (id, open) => {
      if (open) setCollapsedFor(id, false);
      setAddingTo(open ? id : null);
    },
    setMenu: (id, open) => setMenuFor(open ? id : null),
    subtreeIds: (id) => subtreeOf(model, id),
  };
  const actions = useMemo<CardActions>(
    () => ({
      act: (name, ...args) => latest.current.act(name, ...args),
      toggleCollapsed: (id) => latest.current.toggleCollapsed(id),
      open: (id) => latest.current.open(id),
      close: (id) => latest.current.close(id),
      toggleLocked: (id) => latest.current.toggleLocked(id),
      setAdding: (id, open) => latest.current.setAdding(id, open),
      setMenu: (id, open) => latest.current.setMenu(id, open),
      subtreeIds: (id) => latest.current.subtreeIds(id),
    }),
    [],
  );

  // Each node keeps its previous object while its position, size and data are unchanged, so a
  // drag hands React Flow one new node per move, and an edit only the nodes it touched
  const built = useRef(new Map<string, Node<CardData>>());
  const nodes = useMemo<Node<CardData>[]>(() => {
    const previous = built.current;
    built.current = new Map();
    return rendered.map(({ node, depth, questId }) => {
      const placement = placements[node.id];
      const base = depth === 0 ? questHeader : stepRow;
      const size = placement?.size ?? base;
      const position = moving[node.id] ?? placement?.position ?? { x: 0, y: 0 };
      const data: CardData = {
        node,
        depth,
        header: placement?.header ?? base.height,
        xp: model.totalXp.get(node.id) ?? 0,
        hasSteps: model.children.has(node.id),
        shelved: model.shelved.has(node.id),
        collapsed: collapsed.has(node.id),
        folded: depth > 0 && isFolded(node.id) ? subtreeOf(model, node.id).length - 1 : null,
        earlierDone: depth === 0 ? (earlierDone.get(node.id) ?? 0) : 0,
        showsDone: depth === 0 && showsDone(node.id),
        locked: !unlocked.has(questId),
        adding: addingTo === node.id,
        menuOpen: menuFor === node.id,
        look: depth === 0 ? priorities.best.get(node.id) : priorities.marked.get(node.id),
        phone,
        sortable: depth > 0 && questId === snapshot.inboxId,
        actions,
      };
      const kept = previous.get(node.id);
      // A moved box keeps its data object too, so its card is not drawn again
      const sameData = kept !== undefined && (Object.keys(data) as (keyof CardData)[]).every((key) => kept.data[key] === data[key]);
      const unchanged =
        sameData &&
        kept.position.x === position.x &&
        kept.position.y === position.y &&
        kept.width === size.width &&
        kept.height === size.height;
      const next: Node<CardData> = unchanged
        ? kept
        : {
            id: node.id,
            type: depth === 0 ? "quest" : "step",
            parentId: node.parentId ?? undefined,
            extent: node.parentId ? ("parent" as const) : undefined,
            position,
            // A quest box moves even when locked; its steps do not
            draggable: !phone && (depth === 0 || !data.locked),
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
            data: sameData ? kept.data : data,
          };
      built.current.set(node.id, next);
      return next;
    });
  }, [rendered, model, placements, moving, collapsed, opened, today, dayStartHour, unlocked, addingTo, menuFor, priorities, phone, snapshot.inboxId, actions]);

  const edges = useMemo<Edge[]>(
    () =>
      renderedEdges.map((edge) => {
        const isSelected = selectedEdge?.from === edge.from && selectedEdge?.to === edge.to;
        // Above the box that holds the two nodes, below the nodes themselves
        const depth = depthOf.get(edge.from) ?? 0;
        // A link out of a done step is a met prerequisite
        const met = model.byId.get(edge.from)?.completedAt;
        const priority = linkPriority(priorities, edge.from, edge.to);
        const color = met ? linkDone : priority ? `var(--priority-${priority})` : linkOpen;
        return {
          id: `${edge.from}->${edge.to}`,
          source: edge.from,
          target: edge.to,
          deletable: false,
          zIndex: depth * 10 - 5,
          markerEnd: { type: MarkerType.ArrowClosed, color },
          style: {
            stroke: isSelected ? "var(--color-ember)" : color,
            strokeWidth: isSelected ? 2 : 1.25,
            strokeDasharray: met && !isSelected ? "4 4" : undefined,
          },
        };
      }),
    [renderedEdges, depthOf, model, selectedEdge, priorities],
  );

  // Each shown quest claims the hex cells around it, in its colour, following it as it is
  // dragged. The list stays the same object until a quest moves or changes colour, so moving a
  // step or editing one does not recolour the grid.
  const shownTerritories = useRef<TerritoryQuest[]>([]);
  const territories = useMemo(() => {
    const next = shown.flatMap((quest, z) => {
      const placement = placements[quest.id];
      if (!placement) return [];
      const rect = { ...placement.position, ...placement.size, ...moving[quest.id] };
      return [{ id: quest.id, rect, color: priorities.best.get(quest.id) ?? ("none" as const), z }];
    });
    const previous = shownTerritories.current;
    const same = (a: TerritoryQuest, b: TerritoryQuest | undefined) =>
      b !== undefined && a.id === b.id && a.color === b.color && a.z === b.z && (["x", "y", "width", "height"] as const).every((key) => a.rect[key] === b.rect[key]);
    if (next.length !== previous.length || !next.every((quest, i) => same(quest, previous[i]))) shownTerritories.current = next;
    return shownTerritories.current;
  }, [shown, placements, moving]);

  // Drags show at once; the end of one saves it. A step the user places pins its siblings where
  // they are, so the ones still placed automatically do not jump; a quest pins only itself, and the
  // others pack around it. (React Flow's own change stream is left alone: it also carries the
  // measurements links attach by.)
  const follow = (id: string, position: XYPosition) => setMoving((current) => ({ ...current, [id]: position }));

  const place = (node: GraphNode, position: XYPosition) => {
    const siblings = (node.parentId ? (model.children.get(node.parentId) ?? []) : []).filter(
      (sibling) => sibling.id !== node.id && !sibling.position && placements[sibling.id],
    );
    void act("placeNodes", [
      { id: node.id, position },
      ...siblings.map((sibling) => ({ id: sibling.id, position: placements[sibling.id].position })),
    ]);
  };

  // Dragging back along an existing link removes it: from its head's incoming dot to its tail,
  // or from its head's outgoing dot to its tail's incoming one. React Flow reports a drag begun
  // on an incoming dot with source and target swapped back, so where it began is kept here.
  const startedOnIncoming = useRef(false);
  const connect = ({ source, target }: Connection) => {
    const existing = startedOnIncoming.current
      ? snapshot.edges.find((edge) => edge.from === source && edge.to === target)
      : snapshot.edges.find((edge) => edge.from === target && edge.to === source);
    if (existing) void act("removeEdge", existing);
    else void act("addEdge", { from: source, to: target });
  };

  return (
    <ReactFlow
      ref={phonePanZoom.ref}
      // Pointer events can't stop the browser's own touch scrolling; on a card, outside React
      // Flow's pane, only touch-action can
      style={{ opacity: shownYet || shown.length === 0 ? 1 : 0, touchAction: phone ? "none" : undefined }}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onConnectStart={(_event, { handleType }) => {
        startedOnIncoming.current = handleType === "target";
      }}
      onConnect={connect}
      onMoveStart={(_event, viewport) => (zoomAtMoveStart.current = viewport.zoom)}
      onMoveEnd={(_event, viewport) => viewport.zoom !== zoomAtMoveStart.current && phonePanZoom.ref.current && sharpen(phonePanZoom.ref.current)}
      onEdgeClick={(_event, edge) => {
        setMenuFor(null);
        setSelectedEdge({ from: edge.source, to: edge.target });
      }}
      onPaneClick={() => {
        setMenuFor(null);
        setAddingTo(null);
        setSelectedEdge(null);
        setQuestsOpen(false);
      }}
      // On the phone the fingers pan and pinch through usePhonePanZoom
      panOnDrag={!phone}
      zoomOnPinch={!phone}
      nodesDraggable={!phone}
      nodeDragThreshold={4}
      nodesConnectable={!phone}
      onNodeDragStart={(_event, dragged) => (dragging.current = dragged.id)}
      onNodeDrag={(_event, dragged) => follow(dragged.id, dragged.position)}
      onNodeDragStop={(_event, dragged) => {
        dragging.current = null;
        const node = model.byId.get(dragged.id);
        if (node) place(node, dragged.position);
      }}
      zoomOnDoubleClick={false}
      deleteKeyCode={null}
      minZoom={zoomRange.min}
      maxZoom={zoomRange.max}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
      className="!bg-transparent"
    >
      <Territories quests={territories} camera={phone ? phonePanZoom.feed : undefined} />
      <Controls position="bottom-left" showInteractive={false} fitViewOptions={{ ...fitOptions, duration: 300 }} />

      {quests.length > 0 ? (
        <Panel position="top-left" className="flex flex-col items-start gap-2">
          <div className="flex items-center gap-2">
            <InlineInput placeholder="+ New quest" onSubmit={newQuest} className="w-52" />
            <button
              type="button"
              onClick={() => setQuestsOpen((open) => !open)}
              className={`${toolbarPill} ${questsOpen ? "border-ink/25 text-ink" : ""}`}
            >
              Quests <span className="ml-1 font-mono text-muted tabular-nums">{shown.length}/{quests.length}</span>
            </button>
            {phone ? null : (
              <ResetLayoutButton
                onReset={(alsoSteps) => {
                  // Fit again once the automatic layout lands
                  fittedFor.current = null;
                  void act("resetLayout", snapshot.nodes.filter((node) => node.position && (alsoSteps || !node.parentId)).map((node) => node.id));
                }}
              />
            )}
          </div>

          {questsOpen ? (
            <div className="w-72 rounded-xl border border-ink/10 bg-card p-3 shadow-[var(--card-shadow)]">
              <p className="caps font-display text-[11px] font-semibold text-ink/60">Shown on the graph</p>
              <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                {quests.filter((quest) => !completed.includes(quest) && !archived.includes(quest)).map((quest) => (
                  <label key={quest.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-ink/80 hover:bg-ink/6">
                    <input type="checkbox" className="accent-[var(--color-ember)]" checked={quest.active} onChange={(event) => void act("updateNode", quest.id, { active: event.target.checked })} />
                    <span className="truncate">{quest.title}</span>
                  </label>
                ))}
              </div>
              <FinishedQuests
                title="Completed"
                quests={completed}
                buttons={[
                  { label: "Reopen", onClick: (id) => actions.open(id) },
                  { label: "Archive", onClick: (id) => void act("updateNode", id, { active: false }) },
                ]}
              />
              <FinishedQuests title="Archive" quests={archived} buttons={[{ label: "Unarchive", onClick: (id) => void act("updateNode", id, { active: true }) }]} />
            </div>
          ) : null}
        </Panel>
      ) : null}

      {selectedEdge ? (
        <Panel position="bottom-center" className="flex items-center gap-3 rounded-xl border border-ink/10 bg-card px-3 py-2 text-[13px] text-ink/70 shadow-[var(--card-shadow)]">
          <span className="max-w-72 truncate text-ink/60">
            {model.byId.get(selectedEdge.from)?.title} → {model.byId.get(selectedEdge.to)?.title}
          </span>
          <button
            type="button"
            onClick={() => {
              void act("removeEdge", selectedEdge);
              setSelectedEdge(null);
            }}
            className="ml-auto rounded-lg border border-red-400/25 px-2.5 py-1 text-[12px] text-red-300 hover:bg-red-400/10"
          >
            Remove link
          </button>
        </Panel>
      ) : null}

      {shown.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 text-center">
          {quests.length === 0 ? (
            <>
              <HexMark className="h-14 w-16 text-ember/50" />
              <p className="max-w-sm font-display text-base font-semibold text-ink/75">
                Start a quest: something you are learning or building.
              </p>
              <div className="pointer-events-auto">
                <InlineInput placeholder="Name your first quest (Enter)" onSubmit={newQuest} className="w-72 py-2 text-center" />
              </div>
            </>
          ) : (
            <>
              <HexMark className="h-10 w-12 text-ink/15" />
              <p className="text-[13px] text-muted">
              {completed.length > 0 ? "Every shown quest is done. Reopen one under Quests." : "All quests are hidden. Pick some under Quests."}
              </p>
            </>
          )}
        </div>
      ) : null}
    </ReactFlow>
  );
}

function QuestCard({ data }: NodeProps<Node<CardData>>) {
  const { node, xp } = data;
  const { act } = data.actions;
  const level = nodeLevel(xp);
  const palette = paletteOf(data.look);

  return (
    <div data-priority={data.look} className={`relative h-full w-full ${data.shelved ? shelvedLook : ""}`}>
      <Handles phone={data.phone} />
      <div className="priority-mark rounded-2xl" />

      <div className="absolute inset-0 overflow-hidden rounded-2xl border border-ink/12 bg-card shadow-[var(--card-shadow)]" />

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
            <span className="font-mono text-[10.5px] text-muted">
              LVL {level.level}
              {node.shelved ? <span className="ml-2 text-ink/60">· Shelved</span> : null}
            </span>
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
        holdsSteps ? "bg-ink/[0.02]" : done ? "bg-ink/[0.012]" : "bg-panel"
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

const nodeTypes = { quest: memo(QuestCard, sameCard), step: memo(StepCard, sameCard) };

// A card's actions, bound to its node
function boundActions({ node, actions }: CardData) {
  return {
    act: actions.act,
    onToggleCollapsed: () => actions.toggleCollapsed(node.id),
    onToggleLocked: () => actions.toggleLocked(node.id),
    onAdding: (open: boolean) => actions.setAdding(node.id, open),
    onMenu: (open: boolean) => actions.setMenu(node.id, open),
    subtreeIds: () => actions.subtreeIds(node.id),
  };
}

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

// The top-right buttons of every box: hide/show its steps, add a step inside, then the lock and
// ⋯ on a quest or delete on a step
function BoxButtons({ data }: { data: CardData }) {
  const { depth, hasSteps, collapsed, locked, adding } = data;
  const { onToggleCollapsed, onToggleLocked, onAdding } = boundActions(data);
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
        <>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleLocked();
            }}
            title={locked ? "Unlock: let its steps be moved" : "Lock: keep its steps where they are"}
            className={`nodrag ${iconButton} hover:bg-ink/8 ${locked ? "text-muted hover:text-ink/80" : "text-ember"}`}
          >
            <LockIcon open={!locked} />
          </button>
          <MenuButton data={data} />
        </>
      ) : (
        <>
          {data.sortable ? <MoveButton data={data} /> : null}
          <PriorityButton data={data} />
          <ShelveButton data={data} />
          <DeleteButton data={data} />
        </>
      )}
    </div>
  );
}

// The Move to… list opens from an arrow: the select lies invisibly over it
function MoveButton({ data }: { data: CardData }) {
  return (
    <span title="Move to…" className={`nodrag relative ${iconButton} text-muted hover:bg-ink/8 hover:text-ink`}>
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 5 H9 M5.5 1.5 L9 5 L5.5 8.5" />
      </svg>
      <MoveToPicker step={data.node} act={data.actions.act} className="absolute inset-0 w-full cursor-pointer opacity-0" />
    </span>
  );
}

// Shelves or unshelves a step; shown on hover, and always on a shelved step so it can be undone
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
        title="Priority"
        className={`nodrag ${iconButton} font-mono text-[10px] font-semibold text-muted hover:bg-ink/8 hover:text-ink`}
      >
        {node.priority ? `P${node.priority}` : "P"}
      </button>
      <NodeToolbar isVisible={menuOpen} position={Position.Bottom} align="end" offset={6}>
        <div className="nodrag nopan w-52 rounded-xl border border-ink/10 bg-card p-2 text-xs text-ink/75 shadow-[var(--card-shadow)]">
          <PriorityPicker node={node} act={act} />
        </div>
      </NodeToolbar>
    </>
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

function LockIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <rect x="3.5" y="7.5" width="9" height="6.5" rx="1.2" />
      <path d={open ? "M5.5 7.5 V5 A2.5 2.5 0 0 1 10.3 4" : "M5.5 7.5 V5 A2.5 2.5 0 0 1 10.5 5 V7.5"} />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <path d="M4.5 3 H10.5 M4.5 6 H10.5 M4.5 9 H10.5" />
      <circle cx="2" cy="3" r="0.6" fill="currentColor" />
      <circle cx="2" cy="6" r="0.6" fill="currentColor" />
      <circle cx="2" cy="9" r="0.6" fill="currentColor" />
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
const toolbarPill = "rounded-lg border border-ink/10 bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink/75 hover:border-ink/25 hover:text-ink";

// A quest's colour as a small flat-topped hex
function HexDot({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 56 48" className="mt-[3px] h-3 w-3.5 shrink-0" aria-hidden="true">
      <polygon points={HEX_POINTS} className={className} />
    </svg>
  );
}

// Boxes whose add row should open on the Split panel: a quest just made
const listWanted = new Set<string>();

// The input row at the bottom of a box being added to; Enter adds and stays open, Escape closes
function AddRow({ data }: { data: CardData }) {
  const { node, adding } = data;
  const { act, onAdding } = boundActions(data);
  // A list being split into steps: what was pasted, or "" when opened from the button
  const [list, setList] = useState<string | null>(null);
  useEffect(() => {
    if (adding && listWanted.delete(node.id)) setList("");
  }, [adding, node.id]);
  if (!adding) return null;

  return (
    <>
      <div className="absolute right-0 bottom-0 left-0 flex items-center gap-1 px-3" style={{ height: addRowHeight }}>
        <InlineInput
          autoFocus
          placeholder="Step name, Enter to add"
          onSubmit={(title) => act("createNode", title, node.id)}
          onEscape={() => onAdding(false)}
          onPasteList={setList}
          className="min-w-0 flex-1 px-2.5 py-1"
        />
        <button
          type="button"
          onClick={() => setList("")}
          title="Split into steps: type or paste a list"
          className={`nodrag ${iconButton} text-muted hover:bg-ink/8 hover:text-ink`}
        >
          <ListIcon />
        </button>
      </div>
      <NodeToolbar isVisible={list !== null} position={Position.Bottom} align="start" offset={8}>
        {list !== null ? (
          <SplitSteps
            act={act}
            parentId={node.id}
            initial={list}
            onDone={() => {
              setList(null);
              onAdding(false);
            }}
          />
        ) : null}
      </NodeToolbar>
    </>
  );
}

// A quest's ⋯ button and its small menu: its colour, the stats it trains, layout, hide, delete
function MenuButton({ data }: { data: CardData }) {
  const { node, menuOpen } = data;
  const { act, onMenu, subtreeIds } = boundActions(data);
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
          <StatWeightsEditor node={node} act={act} />

          <button
            type="button"
            onClick={() => {
              // The quest itself stays where it is; the toolbar's Reset layout moves quests
              void act("resetLayout", subtreeIds().slice(1));
              onMenu(false);
            }}
            className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-ink/70 hover:bg-ink/6"
          >
            Reset layout: arrange its steps automatically
          </button>

          <div className="flex flex-wrap items-center gap-1.5 border-t border-ink/8 pt-3">
            <button type="button" onClick={() => void act("updateNode", node.id, { active: false })} className="rounded-lg border border-ink/12 px-2.5 py-1 text-[12px] text-ink/75 hover:bg-ink/6">
              Hide quest
            </button>
            <button type="button" onClick={() => void act("updateNode", node.id, { shelved: !node.shelved })} className="rounded-lg border border-ink/12 px-2.5 py-1 text-[12px] text-ink/75 hover:bg-ink/6">
              {node.shelved ? "Unshelve" : "Shelve"}
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
  const [splitting, setSplitting] = useState(false);
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
          setSplitting(false);
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
              {splitting ? (
                <SplitSteps act={act} parentId={node.id} onDone={() => onMenu(false)} className="w-full" />
              ) : (
                <>
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
                  {data.sortable ? (
                    <div className={phoneRow}>
                      <MoveToPicker step={node} act={act} onMoved={() => onMenu(false)} className="min-h-11 w-full rounded-lg border border-ink/10 bg-canvas/60 px-3 py-2 text-[14px] text-ink/85" />
                    </div>
                  ) : null}
                  <button type="button" onClick={choose(() => onAdding(true))} className={phoneItem}>
                    <PlusIcon /> Add a step inside
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (collapsed) onToggleCollapsed();
                      setSplitting(true);
                    }}
                    className={phoneItem}
                  >
                    <ListIcon /> Split into steps
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
                      <button type="button" onClick={choose(() => act("updateNode", node.id, { active: false }))} className={phoneItem}>
                        Hide quest
                      </button>
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
                </>
              )}
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

// Puts every node back to automatic placement; the first click asks
// The first click offers the two resets; moving focus away takes them back
function ResetLayoutButton({ onReset }: { onReset: (alsoSteps: boolean) => void }) {
  const [confirming, setConfirming] = useState(false);
  const look = "rounded-lg border bg-panel px-3 py-1.5 text-[12.5px] font-medium";
  const reset = (alsoSteps: boolean) => {
    onReset(alsoSteps);
    setConfirming(false);
  };
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={`${look} border-ink/10 text-ink/70 hover:border-ink/25 hover:text-ink`}>
        Reset layout
      </button>
    );
  }
  return (
    <div
      className="flex items-center gap-2"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setConfirming(false);
      }}
    >
      <button type="button" autoFocus onClick={() => reset(false)} className={`${look} border-red-400/40 text-red-200`}>
        Reset quests?
      </button>
      <button type="button" onClick={() => reset(true)} className={`${look} border-red-400/20 text-red-200/70 hover:text-red-200`}>
        Also steps in every box
      </button>
    </div>
  );
}

// A list of finished quests in the Quests panel, closed until its heading is clicked
function FinishedQuests({ title, quests, buttons }: { title: string; quests: GraphNode[]; buttons: { label: string; onClick: (id: string) => void }[] }) {
  const [open, setOpen] = useState(false);
  if (quests.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="caps mt-3 flex w-full items-center gap-1.5 font-display text-[11px] font-semibold text-ink/60 hover:text-ink/85"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        {title} <span className="font-mono font-normal text-muted tabular-nums">{quests.length}</span>
      </button>
      {open ? (
        <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {quests.map((quest) => (
            <div key={quest.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-ink/60">
              <span className="text-emerald-300">✓</span>
              <span className="flex-1 truncate">{quest.title}</span>
              {buttons.map(({ label, onClick }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => onClick(quest.id)}
                  className="rounded-md border border-ink/12 px-2 py-0.5 text-[11.5px] text-ink/70 hover:bg-ink/6 phone:min-h-11"
                >
                  {label}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

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

// Lays out every rendered level. Inside a box, steps the user has placed keep their place and
// the rest are laid out automatically (prerequisites to the left) below them. A box is as big as
// its content needs. Quests are packed on the canvas around the ones the user placed.
// The phone has a layout of its own, fixed: nothing placed is read, prerequisites run top to
// bottom, and the quests stand in one column in the order given.
async function layoutTree(
  quests: GraphNode[],
  edges: GraphEdge[],
  stepsOf: (id: string) => GraphNode[],
  addingTo: string | null,
  canvas: Canvas | null,
  shape: CardShape,
) {
  const placements: Record<string, Box> = {};
  const placedAt = (node: GraphNode) => (shape.phone ? null : node.position);
  const direction = shape.phone ? "DOWN" : "RIGHT";
  const headerOf = (node: GraphNode, depth: number, width: number) => headerHeight(node, depth, width, shape);
  // Every title at its card's narrowest, in one pass; only a box wider than that is measured again
  const titles: TitleText[] = [];
  const collect = (node: GraphNode, depth: number) => {
    const title = titleText(node, depth, depth === 0 ? questHeader.width : stepRow.width, shape);
    if (title) titles.push(title);
    stepsOf(node.id).forEach((step) => collect(step, depth + 1));
  };
  quests.forEach((quest) => collect(quest, 0));
  measureTitles(titles);

  const layoutSteps = async (nodes: GraphNode[], sizes: Size[]): Promise<ElkNode> => {
    const ids = new Set(nodes.map((node) => node.id));
    const links = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    const key = JSON.stringify([direction, nodes.map((node, i) => [node.id, sizes[i].width, sizes[i].height]), links.map((edge) => [edge.from, edge.to])]);
    const known = levelLayouts.get(key);
    if (known) return known;
    const result = await elk.layout({
      id: "level",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": direction,
        "elk.padding": "[top=0,left=0,bottom=0,right=0]",
        "elk.spacing.nodeNode": "12",
        // Room for a link's arrow between layers: across on the desktop, down on the phone
        "elk.layered.spacing.nodeNodeBetweenLayers": shape.phone ? "28" : "48",
        "elk.spacing.componentComponent": "12",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        // Otherwise an unlinked step goes above the chains, whatever its priority
        "elk.layered.considerModelOrder.components": "MODEL_ORDER",
      },
      children: nodes.map((node, i) => ({ id: node.id, width: sizes[i].width, height: sizes[i].height })),
      edges: links.map((edge, i) => ({ id: `e${i}`, sources: [edge.from], targets: [edge.to] })),
    });
    levelLayouts.set(key, result);
    if (levelLayouts.size > maxLevelLayouts) levelLayouts.delete(levelLayouts.keys().next().value!);
    return result;
  };

  // Places `nodes` in a box whose content starts at `origin`; returns the content's far corner
  const arrange = async (nodes: GraphNode[], sizes: Measured[], origin: XYPosition) => {
    let right = origin.x;
    let bottom = origin.y;
    const extend = (position: XYPosition, size: Size) => {
      right = Math.max(right, position.x + size.width);
      bottom = Math.max(bottom, position.y + size.height);
    };

    nodes.forEach((node, i) => {
      const position = placedAt(node);
      if (!position) return;
      placements[node.id] = placed(position, sizes[i]);
      extend(position, sizes[i]);
    });

    const loose = nodes.flatMap((node, i) => (placedAt(node) ? [] : [{ node, size: sizes[i] }]));
    if (loose.length > 0) {
      const result = await layoutSteps(
        loose.map(({ node }) => node),
        loose.map(({ size }) => size),
      );
      const top = bottom > origin.y ? bottom + 12 : origin.y;
      (result.children ?? []).forEach((child) => {
        const { size } = loose.find(({ node }) => node.id === child.id)!;
        const position = { x: origin.x + (child.x ?? 0), y: top + (child.y ?? 0) };
        placements[child.id] = placed(position, size);
        extend(position, size);
      });
    }
    return { right, bottom };
  };

  const measure = async (node: GraphNode, depth: number): Promise<Measured> => {
    const base = depth === 0 ? questHeader : stepRow;
    const addRow = node.id === addingTo ? addRowHeight : 0;
    const steps = stepsOf(node.id);
    if (steps.length === 0) {
      const header = headerOf(node, depth, base.width);
      return { width: base.width, height: header + addRow, header };
    }

    // A box is as wide as its steps need, and its title wraps to that width; the steps are placed
    // again if the header then takes a different number of lines
    const sizes = await Promise.all(steps.map((step) => measure(step, depth + 1)));
    const first = headerOf(node, depth, base.width);
    const arranged = await arrange(steps, sizes, { x: padding, y: first });
    const width = Math.max(base.width, arranged.right + padding);
    const header = headerOf(node, depth, width);
    const { bottom } = header === first ? arranged : await arrange(steps, sizes, { x: padding, y: header });
    return { width, height: bottom + (addRow || padding / 2), header };
  };

  const sizes = await Promise.all(quests.map((quest) => measure(quest, 0)));
  if (shape.phone) {
    let top = 0;
    quests.forEach((quest, i) => {
      placements[quest.id] = placed({ x: 0, y: top }, sizes[i]);
      top += sizes[i].height + questGap;
    });
    return placements;
  }
  const sized = quests.map((quest, i) => ({ id: quest.id, position: quest.position, size: sizes[i] }));
  const pinned = sized.flatMap(({ id, position, size }) => (position ? [{ id, position, size }] : []));
  pinned.forEach(({ id, position, size }) => (placements[id] = placed(position, size)));
  const loose = prerequisitesFirst(sized.filter(({ position }) => !position), edges);
  const packed = packQuests(pinned, loose, canvas, questGap);
  loose.forEach(({ id, size }) => (placements[id] = placed(packed[id], size)));

  return placements;
}

const placed = (position: XYPosition, { width, height, header }: Measured): Box => ({ position, size: { width, height }, header });

// A card's title row: its height, grown by a line for each line its title wraps to past the first
function headerHeight(node: GraphNode, depth: number, width: number, shape: CardShape) {
  const base = depth === 0 ? questHeader.height : stepRow.height;
  const title = titleText(node, depth, width, shape);
  return title ? base + (titleLines(title) - 1) * lineHeight(title.className) : base;
}

// A card's title as the card sets it, at the width it gets: the card's less the fixed parts beside
// it. A folded box's one line is cut, not wrapped.
function titleText(node: GraphNode, depth: number, width: number, shape: CardShape): TitleText | null {
  if (depth === 0) {
    // px-4, the hex dot (w-3.5) and its gap-2
    const fixed = 32 + 14 + 8;
    // The phone's menu after a gap-2; on the desktop the +1 after its gap-2, and without hover the
    // icon buttons after another gap-2, with gap-0.5 between them (with hover they float over the title)
    const icons = !canHover ? 8 + (shape.hasSteps(node.id) ? 4 : 3) * (iconSize + 2) - 2 : 0;
    const buttons = shape.phone ? 8 + phoneMenuWidth : 8 + labelWidth(plusOneButton, "+1") + icons;
    return { text: node.title, className: questTitleType, width: width - fixed - buttons };
  }
  if (shape.folded(node.id)) return null;
  // px-3, the tick (w-4), the gap-2.5 on each side of the title, the label slot, and the phone's menu
  const fixed = 24 + 16 + 10 + 10 + labelSlot + (shape.phone ? 10 + phoneMenuWidth : 0);
  const holdsSteps = shape.hasSteps(node.id) && !shape.collapsed(node.id);
  return { text: node.title, className: stepTitleType(holdsSteps), width: width - fixed };
}

function subtreeOf(model: GraphModel, id: string): string[] {
  return [id, ...(model.children.get(id) ?? []).flatMap((child) => subtreeOf(model, child.id))];
}

// The finished boxes opened, by day. Openings from an earlier day no longer count, and are dropped
// at the next opening.
function loadOpened(): Record<string, ISODate> {
  try {
    return JSON.parse(window.localStorage.getItem(openedStorageKey) ?? "{}") as Record<string, ISODate>;
  } catch {
    return {};
  }
}

function saveOpened(opened: Record<string, ISODate>) {
  try {
    window.localStorage.setItem(openedStorageKey, JSON.stringify(opened));
  } catch {
    // Storage blocked: opened boxes fold again next time
  }
}

// A set of box ids kept between sessions: the boxes whose steps are hidden, the unlocked quests
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
    // Storage blocked: the boxes are as they were by default next time
  }
}
