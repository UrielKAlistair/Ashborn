import { GraphScrollbar } from "./GraphScrollbar";
import { Controls, MarkerType, Panel, ReactFlow, ReactFlowProvider, useReactFlow, useStore, type Connection, type Edge, type Node } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { HexMark } from "../../components/HexTile";
import { useToday } from "../../lib/useToday";
import { isFinished, type GraphModel } from "../../shared/graphModel";
import { toISODate } from "../../shared/dates";
import { byPriority, derivePriorities, linkPriority, type Priorities } from "../../shared/priority";
import { type GraphEdge, type GraphNode, type ISODate, type Snapshot } from "../../shared/types";
import type { Act } from "./HomePage";
import { InlineInput } from "./InlineInput";
import { onShowOnGraph, takeWaitingShow } from "./showOnGraph";
import { sharpen, usePhonePanZoom } from "./phonePanZoom";
import Territories, { setTerritoryFocus } from "./territory/Territories";
import type { TerritoryQuest } from "./territory/territoryGrid";
import { fontsLoaded } from "./titleLines";
import { readStored, writeStored } from "../../lib/storage";
import { Box, CardShape, PHONE_MARGIN, canHover, layoutTree, phoneFocus, phoneViewport, questHeader, stepRow, zoomRange } from "./graphLayout";
import { CardActions, CardData, nodeTypes } from "./graphCards";

/**
 * The quest graph: every shown quest as a box of its steps, linked by prerequisites, on a canvas over
 * the hex territories. Used by the desktop's Home and the phone's Graph tab.
 *
 * GraphCanvas tells the story. From the model it works out what is drawn: quests not shelved or
 * folded away (finished, unless opened today), and in each box its steps, less those collapsed,
 * folded, shelved or finished on an earlier day (unless asked for); that pass is drawnGraph, further
 * down. It lays them out (graphLayout.ts) when that structure changes, fits the view when the set of
 * quests changes (and after a resize, unless the user has moved the view), and turns the result
 * into React Flow nodes and edges, kept as the same objects while unchanged so an edit redraws only
 * the cards it touched. The cards themselves are in graphCards.tsx. Around the canvas: the toolbar
 * (+ New quest, the Quests panel), a chosen link's Remove panel, and the empty states. Cards are
 * never dragged; dragging between dots adds a link, or removes one dragged back along.
 * What is collapsed or opened today is kept on this device.
 */
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Links in the theme's ink: a met prerequisite fades
const linkOpen = "color-mix(in oklab, var(--color-ink) 34%, transparent)";

const linkDone = "color-mix(in oklab, var(--color-ink) 15%, transparent)";

const collapsedStorageKey = "ashborn-collapsed";

// Finished boxes the user opened, with the day they did; open until the next day starts
const openedStorageKey = "ashborn-opened";

const fitOptions = { padding: 0.15, maxZoom: 1.1 };

const nodeElement = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);

// Marks a node on screen for a moment, in its priority's colour (ember without one)
function flash(id: string) {
  const element = nodeElement(id);
  if (!element) return;
  const card = element.querySelector<HTMLElement>("[data-priority]");
  const mark = card ? getComputedStyle(card).getPropertyValue("--mark").trim() : "";
  element.style.setProperty("--flash", mark || "var(--color-ember)");
  element.classList.remove("node-flash");
  void element.offsetWidth; // restarts the animation when asked twice in a row
  element.classList.add("node-flash");
  window.setTimeout(() => element.classList.remove("node-flash"), 1600);
}

type QuestGraphProps = {
  snapshot: Snapshot;
  model: GraphModel;
  act: Act;
  phone: boolean;
};

export function QuestGraph(props: QuestGraphProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}

function GraphCanvas({ snapshot, model, act, phone }: QuestGraphProps) {
  const { fitView, setViewport } = useReactFlow();
  const latestModel = useRef(model);
  latestModel.current = model;

  // A new quest opens straight onto its add row, its first steps being the obvious next question
  const newQuest = (title: string) => {
    const id = crypto.randomUUID();
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
        userMoved.current = true;
        void fitView({ nodes: [{ id: target }], duration: 400, padding: 0.8, maxZoom: 1.1 });
        flash(target);
      }),
    [phone, fitView],
  );
  const [placements, setPlacements] = useState<Record<string, Box>>({});
  const [collapsed, setCollapsed] = useState(() => loadIds(collapsedStorageKey));
  const [opened, setOpened] = useState(loadOpened);
  const [showingShelved, setShowingShelved] = useState<ReadonlySet<string>>(new Set());
  const today = useToday();
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  // The link chosen, while it still exists: one removed elsewhere (another device, the agent) drops its panel
  const chosenLink = selectedEdge && snapshot.edges.some((edge) => edge.from === selectedEdge.from && edge.to === selectedEdge.to) ? selectedEdge : null;
  const [questsOpen, setQuestsOpen] = useState(false);
  const fittedFor = useRef<string | null>(null);
  // Whether the view moved, by the user or to a node asked for, since the last automatic fit
  const userMoved = useRef(false);
  // Hidden until the first layout is fitted: before it, every node sits at the origin
  const [shownYet, setShownYet] = useState(false);
  const phonePanZoom = usePhonePanZoom(phone, zoomRange.min, zoomRange.max);
  const zoomAtMoveStart = useRef(1);

  const priorities = useMemo(() => derivePriorities(model, snapshot), [model, snapshot.edges]);
  const view: ViewChoices = { collapsed, opened, showingShelved, today };
  const folded = (id: string) => isFolded(model, view, id);

  const quests = model.children.get(null) ?? [];
  const completed = quests.filter((quest) => !quest.shelved && folded(quest.id));
  // An archived quest is a finished one that is shelved
  const archived = quests.filter((quest) => quest.shelved && model.finishedAt.has(quest.id));

  // Titles are measured again once the fonts have loaded
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => void fontsLoaded.then(() => setFontsReady(true)), []);
  // Worked out again only when the graph or what is open changes
  const { shown, rendered, stepsOf, depthOf, renderedEdges, structureKey, earlierDone, shelvedSteps } = useMemo(
    () => drawnGraph(model, snapshot.edges, priorities, view, { addingTo, fontsReady, phone }),
    [model, snapshot.edges, collapsed, opened, showingShelved, today, addingTo, priorities, fontsReady, phone],
  );
  // Each rendered node's quest, whose territory a hover keeps lit
  const questOf = useMemo(() => new Map(rendered.map(({ node, questId }) => [node.id, questId])), [rendered]);
  // The card under the pointer. One deleted or hidden there never gets its mouseleave, so its going clears the hover.
  const hovered = useRef<string | null>(null);
  useEffect(() => {
    if (hovered.current && !questOf.has(hovered.current)) {
      hovered.current = null;
      setTerritoryFocus(null);
    }
  }, [questOf]);
  // A card's open menu or add row goes with the card (shelved, deleted, folded away here or elsewhere),
  // so its Escape catcher doesn't outlive it, nor reopen when the card comes back
  useEffect(() => {
    if (menuFor && !questOf.has(menuFor)) setMenuFor(null);
    if (addingTo && !questOf.has(addingTo)) setAddingTo(null);
  }, [questOf]);
  // A quest with no shelved steps left stops showing them, so the next step shelved there leaves
  useEffect(() => {
    if ([...showingShelved].some((id) => !shelvedSteps.get(id)))
      setShowingShelved((current) => new Set([...current].filter((id) => shelvedSteps.get(id))));
  }, [shelvedSteps]);
  const paneMeasured = useStore((state) => state.width > 0 && state.height > 0);
  const paneWidth = useStore((state) => state.width);
  const paneHeight = useStore((state) => state.height);
  const phoneRowWidth = paneWidth - 2 * PHONE_MARGIN;
  // The set of quests shown, whatever their order: a priority that only reorders them keeps the
  // view. The phone is framed afresh when it turns.
  const topKey = `${phone && phoneRowWidth}:${shown.map((quest) => quest.id).sort().join()}`;

  // Re-layout only when the rendered structure changes, not on every level-up or window resize.
  // Quests pack to the room a fit has; the phone is read by scrolling, so it stays one screen wide,
  // and is laid out again when that width changes (the phone turned).
  // The layout the placements were made for: the phone aims at a node only once it matches, since a
  // graph kept hidden lays out again only when shown, and aiming by the earlier layout lands off it
  const layoutKey = `${structureKey}:${phone && phoneRowWidth}`;
  const [laidOutFor, setLaidOutFor] = useState("");

  // A desktop window that settles at a new size while its view is still the automatic fit (not
  // panned or zoomed since) is laid out and fitted again: a fit made mid-minimize or mid-restore
  // would otherwise leave the graph framed for a pane that is gone
  const [refits, setRefits] = useState(0);
  useEffect(() => {
    if (phone || !paneMeasured || fittedFor.current === null) return;
    const timer = window.setTimeout(() => {
      if (userMoved.current) return;
      fittedFor.current = null;
      setRefits((count) => count + 1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [paneWidth, paneHeight]);

  useEffect(() => {
    if (!paneMeasured) return;
    const canvas = { width: paneWidth / (1 + fitOptions.padding), height: paneHeight / (1 + fitOptions.padding), maxZoom: fitOptions.maxZoom };
    const shape: CardShape = { phone, hasSteps: (id) => model.children.has(id), collapsed: (id) => collapsed.has(id), folded };
    setPlacements(layoutTree(shown, renderedEdges, (id) => stepsOf.get(id) ?? [], addingTo, phone ? phoneRowWidth : canvas, shape));
    setLaidOutFor(layoutKey);
  }, [structureKey, paneMeasured, phone && phoneRowWidth, refits]);

  // Fit the view when the set of quests shown changes, not on every step edit, and only once
  // React Flow knows the canvas size (before that, a fit is silently lost). Nodes carry their
  // sizes, so their bounds are known as soon as they are laid out.
  useEffect(() => {
    if (!paneMeasured || fittedFor.current === topKey || Object.keys(placements).length === 0) return;
    // The phone frames the shown quests' boxes: none laid out yet would make the view NaN
    if (phone && !shown.some((quest) => placements[quest.id])) return;
    // A frame later React Flow holds the laid-out nodes; a fit cancelled by a newer layout is
    // not counted as done, so the newer one fits instead
    const frame = window.requestAnimationFrame(() => {
      fittedFor.current = topKey;
      userMoved.current = false;
      const overview = phoneViewport(shown, placements, paneWidth);
      const focus = phone && asked && laidOutFor === layoutKey ? phoneFocus(asked, latestModel.current, placements, overview.zoom, paneWidth, paneHeight) : null;
      if (focus) setAsked(null);
      void (phone ? setViewport(focus?.viewport ?? overview) : fitView(fitOptions)).then(() => {
        setShownYet(true);
        if (focus) flash(focus.target);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [placements, paneMeasured, fitView, setViewport, phone, paneWidth, paneHeight, asked, laidOutFor]);

  // A node asked for after the phone's view was first framed
  useEffect(() => {
    if (!asked || fittedFor.current !== topKey || laidOutFor !== layoutKey) return;
    setAsked(null);
    const focus = phoneFocus(asked, latestModel.current, placements, phoneViewport(shown, placements, paneWidth).zoom, paneWidth, paneHeight);
    if (focus) void setViewport(focus.viewport).then(() => flash(focus.target));
  }, [asked, placements, laidOutFor]);

  // Escape closes an open card menu, the Quests panel or a chosen link's panel, before the navbar's
  // hide-to-tray handler sees it
  const somethingOpen = Boolean(menuFor || questsOpen || chosenLink);
  useEffect(() => {
    if (!somethingOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuFor(null);
      setQuestsOpen(false);
      setSelectedEdge(null);
    };
    window.addEventListener("keydown", close, { capture: true });
    return () => window.removeEventListener("keydown", close, { capture: true });
  }, [somethingOpen]);

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
    toggleShelved: (id) =>
      setShowingShelved((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    // Adding to a collapsed box opens it, so the new steps are seen
    setAdding: (id, open) => {
      if (open) setCollapsedFor(id, false);
      setAddingTo(open ? id : null);
    },
    setMenu: (id, open) => setMenuFor(open ? id : null),
  };
  const actions = useMemo<CardActions>(
    () => ({
      act: (name, ...args) => latest.current.act(name, ...args),
      toggleCollapsed: (id) => latest.current.toggleCollapsed(id),
      open: (id) => latest.current.open(id),
      close: (id) => latest.current.close(id),
      toggleShelved: (id) => latest.current.toggleShelved(id),
      setAdding: (id, open) => latest.current.setAdding(id, open),
      setMenu: (id, open) => latest.current.setMenu(id, open),
    }),
    [],
  );

  // Each node keeps its previous object while its position, size and data are unchanged, so an edit
  // hands React Flow only the nodes it touched
  const built = useRef(new Map<string, Node<CardData>>());
  const nodes = useMemo<Node<CardData>[]>(() => {
    const previous = built.current;
    built.current = new Map();
    return rendered.map(({ node, depth }) => {
      const placement = placements[node.id];
      const base = depth === 0 ? questHeader : stepRow;
      const size = placement?.size ?? base;
      const position = placement?.position ?? { x: 0, y: 0 };
      const data: CardData = {
        node,
        depth,
        header: placement?.header ?? base.height,
        xp: model.totalXp.get(node.id) ?? 0,
        hasSteps: model.children.has(node.id),
        shelved: model.shelved.has(node.id),
        collapsed: collapsed.has(node.id),
        folded: depth > 0 && folded(node.id) ? subtreeOf(model, node.id).length - 1 : null,
        earlierDone: depth === 0 ? (earlierDone.get(node.id) ?? 0) : 0,
        showsDone: depth === 0 && showsDone(view, node.id),
        shelvedSteps: depth === 0 ? (shelvedSteps.get(node.id) ?? 0) : 0,
        showsShelved: depth === 0 && showingShelved.has(node.id),
        adding: addingTo === node.id,
        menuOpen: menuFor === node.id,
        look: depth === 0 ? priorities.best.get(node.id) : priorities.marked.get(node.id),
        phone,
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
            data: sameData ? kept.data : data,
          };
      built.current.set(node.id, next);
      return next;
    });
  }, [rendered, model, placements, collapsed, opened, today, addingTo, menuFor, priorities, phone, actions]);

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

  // Each shown quest claims the hex cells around it, in its colour. The list stays the same object
  // until a quest moves or changes colour, so editing a step does not recolour the grid.
  const shownTerritories = useRef<TerritoryQuest[]>([]);
  const territories = useMemo(() => {
    const next = shown.flatMap((quest, z) => {
      const placement = placements[quest.id];
      if (!placement) return [];
      const rect = { ...placement.position, ...placement.size };
      return [{ id: quest.id, rect, color: priorities.best.get(quest.id) ?? ("none" as const), z }];
    });
    const previous = shownTerritories.current;
    const same = (a: TerritoryQuest, b: TerritoryQuest | undefined) =>
      b !== undefined && a.id === b.id && a.color === b.color && a.z === b.z && (["x", "y", "width", "height"] as const).every((key) => a.rect[key] === b.rect[key]);
    if (next.length !== previous.length || !next.every((quest, i) => same(quest, previous[i]))) shownTerritories.current = next;
    return shownTerritories.current;
  }, [shown, placements]);

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
      // Fades in once the first layout is fitted, rather than appearing at once
      style={{ opacity: shownYet || shown.length === 0 ? 1 : 0, transition: reducedMotion ? undefined : "opacity 160ms ease-out", touchAction: phone ? "none" : undefined }}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onConnectStart={(_event, { handleType }) => {
        startedOnIncoming.current = handleType === "target";
      }}
      onConnect={connect}
      onMoveStart={(event, viewport) => {
        zoomAtMoveStart.current = viewport.zoom;
        // Only the user's own moves carry an event; a fit's don't
        if (event) userMoved.current = true;
      }}
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
      nodesDraggable={false}
      // Only where there is hover: a tap's emulated mouseenter would dim the others until the next tap elsewhere
      onNodeMouseEnter={
        canHover
          ? (_event, entered) => {
              hovered.current = entered.id;
              setTerritoryFocus(questOf.get(entered.id) ?? null);
            }
          : undefined
      }
      onNodeMouseLeave={
        canHover
          ? () => {
              hovered.current = null;
              setTerritoryFocus(null);
            }
          : undefined
      }
      nodesConnectable={!phone}
      zoomOnDoubleClick={false}
      deleteKeyCode={null}
      minZoom={zoomRange.min}
      maxZoom={zoomRange.max}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
      className="!bg-transparent"
    >
      <Territories quests={territories} camera={phone ? phonePanZoom.feed : undefined} />
      {phone ? null : <GraphScrollbar />}
      <Controls
        position="bottom-left"
        showInteractive={false}
        fitViewOptions={{ ...fitOptions, duration: 300 }}
        onFitView={() => (userMoved.current = false)}
        // The zoom buttons move the view without an event, so onMoveStart doesn't count them
        onZoomIn={() => (userMoved.current = true)}
        onZoomOut={() => (userMoved.current = true)}
      />

      {quests.length > 0 ? (
        <Panel position="top-left" className="flex flex-col items-start gap-2">
          <div className="flex items-center gap-2">
            <InlineInput placeholder="+ New quest" onSubmit={newQuest} className="graph-field w-52" />
            <button
              type="button"
              onClick={() => setQuestsOpen((open) => !open)}
              className={`${toolbarPill} ${questsOpen ? "border-ink/25 text-ink" : ""}`}
            >
              Quests <span className="ml-1 font-mono text-muted tabular-nums">{shown.length}/{quests.length}</span>
            </button>
          </div>

          {questsOpen ? <QuestsPanel quests={quests} completed={completed} archived={archived} act={act} onReopen={(id) => actions.open(id)} /> : null}
        </Panel>
      ) : null}

      {chosenLink ? (
        <Panel position="bottom-center" className="flex items-center gap-3 rounded-xl border border-ink/10 bg-card px-3 py-2 text-[13px] text-ink/70 shadow-[var(--card-shadow)]">
          <span className="max-w-72 truncate text-ink/60">
            {model.byId.get(chosenLink.from)?.title} → {model.byId.get(chosenLink.to)?.title}
          </span>
          <button
            type="button"
            onClick={() => {
              void act("removeEdge", chosenLink);
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
                <InlineInput placeholder="Name your first quest (Enter)" onSubmit={newQuest} className="graph-field w-72 py-2 text-center" />
              </div>
            </>
          ) : (
            <>
              <HexMark className="h-10 w-12 text-ink/15" />
              <p className="text-[13px] text-muted">
              {completed.length > 0 ? "Every shown quest is done. Reopen one under Quests." : "All quests are shelved. Pick some under Quests."}
              </p>
            </>
          )}
        </div>
      ) : null}
    </ReactFlow>
  );
}

const toolbarPill = "rounded-lg border border-ink/10 bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink/75 hover:border-ink/25 hover:text-ink";

// What this device chose to show: boxes collapsed, finished boxes opened today (by day), and quests
// showing their shelved steps; with the day, which decides what counts as done earlier
type ViewChoices = { collapsed: ReadonlySet<string>; opened: Record<string, ISODate>; showingShelved: ReadonlySet<string>; today: ISODate };

// A finished box (shared/graphModel.ts) folds at once, unless opened today. A folded quest leaves the graph
// for the Completed list.
function isFolded(model: GraphModel, { opened, today }: ViewChoices, id: string) {
  return isFinished(model, id) && (opened[id] ?? "") < today;
}

// A quest opened today shows its steps finished on an earlier day
function showsDone({ opened, today }: ViewChoices, questId: string) {
  return (opened[questId] ?? "") >= today;
}

// What the graph draws. The quests shown: not shelved or folded, most urgent first.
// In each box, its steps most urgent first, less those of a collapsed or folded box, shelved steps
// (unless the quest shows them) and steps finished on an earlier day (unless the quest was opened
// today); per quest it counts the last two, shown or not, for the buttons that show them.
// `rendered` lists parents before their steps, as React Flow needs; `stepsOf` gives the layout each
// box's steps. `structureKey` changes exactly when the layout must be made again.
function drawnGraph(
  model: GraphModel,
  edges: GraphEdge[],
  priorities: Priorities,
  view: ViewChoices,
  { addingTo, fontsReady, phone }: { addingTo: string | null; fontsReady: boolean; phone: boolean },
) {
  const visibleSteps = (id: string) => (view.collapsed.has(id) || isFolded(model, view, id) ? [] : byPriority(model.children.get(id) ?? [], priorities));
  const doneEarlier = (node: GraphNode) => {
    const finished = model.finishedAt.get(node.id) ?? (node.completedAt ? Date.parse(node.completedAt) : null);
    return finished !== null && toISODate(new Date(finished)) < view.today;
  };
  const quests = model.children.get(null) ?? [];
  const shown = byPriority(quests.filter((quest) => !quest.shelved && !isFolded(model, view, quest.id)), priorities);
  const rendered: Array<{ node: GraphNode; depth: number; questId: string }> = [];
  const earlierDone = new Map<string, number>();
  // One inside a shelved box counts with the box
  const shelvedSteps = new Map<string, number>();
  const stepsOf = new Map<string, GraphNode[]>();
  const visit = (node: GraphNode, depth: number, questId: string, insideShelved = false) => {
    rendered.push({ node, depth, questId });
    const steps: GraphNode[] = [];
    visibleSteps(node.id).forEach((step) => {
      if (step.shelved && !insideShelved) {
        shelvedSteps.set(questId, (shelvedSteps.get(questId) ?? 0) + 1);
        if (!view.showingShelved.has(questId)) return;
      }
      if (doneEarlier(step)) {
        earlierDone.set(questId, (earlierDone.get(questId) ?? 0) + 1);
        if (!showsDone(view, questId)) return;
      }
      steps.push(step);
      visit(step, depth + 1, questId, insideShelved || step.shelved);
    });
    stepsOf.set(node.id, steps);
  };
  shown.forEach((quest) => visit(quest, 0, quest.id));
  const depthOf = new Map(rendered.map(({ node, depth }) => [node.id, depth]));
  const renderedEdges = edges.filter((edge) => depthOf.has(edge.from) && depthOf.has(edge.to));
  const structureKey = JSON.stringify([
    // Collapsed and folded too: they set a title's weight and wrap, even when no step shows either way
    rendered.map(({ node }) => [node.id, node.title, model.children.has(node.id), view.collapsed.has(node.id), isFolded(model, view, node.id)]),
    renderedEdges.map((edge) => [edge.from, edge.to]),
    addingTo,
    fontsReady,
    phone,
  ]);
  return { shown, rendered, stepsOf, depthOf, renderedEdges, structureKey, earlierDone, shelvedSteps };
}

// The Quests panel: a switch per quest for whether the graph shows it (off is shelved), then the
// finished quests, Completed (shown, folded away) and Archive (finished and shelved)
function QuestsPanel({ quests, completed, archived, act, onReopen }: { quests: GraphNode[]; completed: GraphNode[]; archived: GraphNode[]; act: Act; onReopen: (id: string) => void }) {
  return (
    <div className="w-72 rounded-xl border border-ink/10 bg-card p-3 shadow-[var(--card-shadow)]">
      <p className="caps font-display text-[11px] font-semibold text-ink/60">Shown on the graph; the rest are shelved</p>
      <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
        {quests.filter((quest) => !completed.includes(quest) && !archived.includes(quest)).map((quest) => (
          <label key={quest.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-ink/80 hover:bg-ink/6">
            <input type="checkbox" className="accent-[var(--color-ember)]" checked={!quest.shelved} onChange={(event) => void act("updateNode", quest.id, { shelved: !event.target.checked })} />
            <span className="truncate">{quest.title}</span>
          </label>
        ))}
      </div>
      <FinishedQuests
        title="Completed"
        quests={completed}
        buttons={[
          { label: "Reopen", onClick: onReopen },
          { label: "Archive", onClick: (id) => void act("updateNode", id, { shelved: true }) },
        ]}
      />
      <FinishedQuests title="Archive" quests={archived} buttons={[{ label: "Unarchive", onClick: (id) => void act("updateNode", id, { shelved: false }) }]} />
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

function subtreeOf(model: GraphModel, id: string): string[] {
  return [id, ...(model.children.get(id) ?? []).flatMap((child) => subtreeOf(model, child.id))];
}

// The finished boxes opened, by day. Openings from an earlier day no longer count, and are dropped
// at the next opening.
function loadOpened(): Record<string, ISODate> {
  return readStored<Record<string, ISODate>>(openedStorageKey, {});
}

function saveOpened(opened: Record<string, ISODate>) {
  writeStored(openedStorageKey, opened);
}

// A set of box ids kept between sessions: the boxes whose steps are hidden
function loadIds(storageKey: string): Set<string> {
  return new Set(readStored<string[]>(storageKey, []));
}

function saveIds(storageKey: string, ids: Set<string>) {
  writeStored(storageKey, [...ids]);
}
