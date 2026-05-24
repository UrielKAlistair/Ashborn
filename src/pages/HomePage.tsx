import { useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { useContainerWidth, verticalCompactor, type Layout } from "react-grid-layout";
import { BoardWidgetCard } from "../components/home/BoardWidgetCard";
import { DashboardHeader } from "../components/home/DashboardHeader";
import { StatPanel } from "../components/home/StatPanel";
import type { HomePageProps } from "../components/home/types";
import type {BoardWidgetData} from "../shared/types"
import type { BoardWidget, GridRect } from "../shared/types";

const STATS_PANEL_ID = "stats-panel";
const DASHBOARD_GRID = {
  columns: 24,
  rowHeight: 84,
  gap: 16,
  minWidgetWidth: 3,
  minWidgetHeight: 2,
  minRows: 4,
} as const;
const STATS_PANEL_RECT: GridRect = { x: 19, y: 0, w: 5, h: 5 };

function getDashboardRowCount(widgets: BoardWidget[]) {
  return widgets.reduce(
    (max, widget) => Math.max(max, widget.y + widget.h),
    STATS_PANEL_RECT.y + STATS_PANEL_RECT.h,
  );
}

type HomePageDataProps = HomePageProps & {
  allBoardsData: BoardWidgetData[];
  initialDashConfig: BoardWidget[];
  onSaveWidgets: (widgets: BoardWidget[]) => void | Promise<void>;
};

export function HomePage({
  fp,
  hp,
  allBoardsData,
  initialDashConfig,
  onSaveWidgets,
  stats,
}: HomePageDataProps) {
  const { width, containerRef, mounted } = useContainerWidth();
  const [isEditingDashboard, setIsEditingDashboard] = useState(false);
  const [widgets, setWidgets] = useState(initialDashConfig);
  const lastPersistedWidgets = useRef(JSON.stringify(initialDashConfig));

  // Initialisation
  useEffect(() => {
    const serializedWidgets = JSON.stringify(initialDashConfig);

    lastPersistedWidgets.current = serializedWidgets;
    setWidgets(initialDashConfig);
  }, [initialDashConfig]);

  // Debounced DB Save
  useEffect(() => {
    const serializedWidgets = JSON.stringify(widgets);

    if (serializedWidgets === lastPersistedWidgets.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      lastPersistedWidgets.current = serializedWidgets;
      void onSaveWidgets(widgets);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [onSaveWidgets, widgets]);

  const availableBoards = useMemo(
    () =>
      allBoardsData.filter(
        (board) => !widgets.some((widget) => widget.boardId === board.id),
      ),
    [allBoardsData, widgets],
  );

  const boardWidgetMap = useMemo(
    () => new Map(allBoardsData.map((board) => [board.id, board])),
    [allBoardsData],
  );

  const layout = useMemo<Layout>(
    () => [
      {
        i: STATS_PANEL_ID,
        ...STATS_PANEL_RECT,
        static: true,
        isDraggable: false,
        isResizable: false,
      },
      ...widgets.map((widget) => ({
        i: widget.boardId,
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
        minW: DASHBOARD_GRID.minWidgetWidth,
        minH: DASHBOARD_GRID.minWidgetHeight,
      })),
    ],
    [widgets],
  );

  const dashboardRows = useMemo(() => getDashboardRowCount(widgets), [widgets]);

  const addBoardWidget = (boardId: string) => {
    const nextY = getDashboardRowCount(widgets);

    setWidgets((current) => [
      ...current,
      {
        boardId,
        x: 0,
        y: nextY,
        w: 12,
        h: 4,
      },
    ]);
  };

  const removeWidget = (boardId: string) => {
    setWidgets((current) => current.filter((widget) => widget.boardId !== boardId));
  };

  const handleLayoutChange = (nextLayout: Layout) => {
    setWidgets((current) => {
      const widgetMap = new Map(current.map((widget) => [widget.boardId, widget]));

      return nextLayout
        .filter((item) => item.i !== STATS_PANEL_ID)
        .map((item) => {
          const currentWidget = widgetMap.get(item.i);

          if (!currentWidget) {
            return null;
          }

          return {
            ...currentWidget,
            x: item.x,
            y: item.y,
            w: item.w,
            h: item.h,
          };
        })
        .filter((widget): widget is BoardWidget => Boolean(widget));
    });
  };

  // The state of the Homepage dashboard, which is "The set of widgets present and their positions", is persisted in a React State (widgets) for smooth UX and committed periodically to the DB via a debounce effect.  
  // The main dash shows all widgets present in the react state object. The contents of each quest board is fetched from the board id, which is in the state.

  // DashboardHeader has an edit button that can add widgets to the state via addBoardWidget.
  // Each widget in edit mode shows a remove button that can call removeWidget.
  // On LayoutChange, triggered by react-grid-layout, we persist new positions and sizes to the react state. 

  return (
    <section className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-[28px] border border-white/12 bg-white/6 backdrop-blur-xl">
      <div className="panel-scroll h-full overflow-y-auto p-5 pr-3">
        <DashboardHeader
          isEditing={isEditingDashboard}
          availableBoardTitles={availableBoards.map((board) => ({
            id: board.id,
            title: board.title,
          }))}
          onAddBoard={addBoardWidget}
          onToggleEdit={() => setIsEditingDashboard((current) => !current)}
        />

        <div
          ref={containerRef}
          className="relative min-h-[24rem] rounded-[24px] border border-white/10 bg-black/12 p-2"
        >
          {/* This is the dotted grid overlay used for alignment when editing */}
          {isEditingDashboard ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-2 grid"
              style={{
                gridTemplateColumns: `repeat(${DASHBOARD_GRID.columns}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${dashboardRows}, ${DASHBOARD_GRID.rowHeight}px)`,
                gap: `${DASHBOARD_GRID.gap}px`,
              }}
            >
              {Array.from({ length: DASHBOARD_GRID.columns * dashboardRows }).map((_, index) => (
                <div key={index} className="relative">
                  <span className="absolute top-0 left-0 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/12" />
                </div>
              ))}
            </div>
          ) : null} 
          
          {/* Layouting is governed by react-grid-layout */}
          {mounted ? (
            <GridLayout
              width={width}
              layout={layout}
              gridConfig={{
                cols: DASHBOARD_GRID.columns,
                rowHeight: DASHBOARD_GRID.rowHeight,
                margin: [DASHBOARD_GRID.gap, DASHBOARD_GRID.gap],
                containerPadding: [0, 0],
              }}
              dragConfig={{
                enabled: isEditingDashboard,
                handle: ".board-widget-drag-handle",
              }}
              resizeConfig={{
                enabled: isEditingDashboard,
                handles: ["n", "s", "e", "w", "ne", "nw", "se", "sw"],
              }}
              compactor={verticalCompactor}
              onLayoutChange={handleLayoutChange}
            >
              <div key={STATS_PANEL_ID} className="flex h-full justify-end">
                <StatPanel fp={fp} hp={hp} stats={stats} />
              </div>

              {widgets.map((widget) => {
                const board = boardWidgetMap.get(widget.boardId);

                if (!board) {
                  return <div key={widget.boardId} />;
                }

                return (
                  <div key={widget.boardId} className="h-full">
                    <BoardWidgetCard
                      board={board}
                      widget={widget}
                      isEditing={isEditingDashboard}
                      onRemove={removeWidget}
                    />
                  </div>
                );
              })}
            </GridLayout>
          ) : null}
        </div>
      </div>
    </section>
  );
}
