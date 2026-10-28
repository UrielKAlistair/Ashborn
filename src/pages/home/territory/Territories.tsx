import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { useStoreApi } from "@xyflow/react";
import { buildGrid, computeOwners, gridExtent } from "./territoryGrid";
import type { TerritoryQuest } from "./territoryGrid";
import { TerritoryRenderer } from "./territoryRenderer";
import type { CameraFeed } from "../phonePanZoom";

// The hex fabric behind the quest graph, and the territories coloured into it (see
// territoryGrid.ts), drawn on a WebGL canvas (territoryRenderer.ts). Without WebGL the graph
// simply has no background.

// `camera`, on the phone, moves the territory during a gesture, before React Flow's store knows
function Territories({ quests, camera }: { quests: TerritoryQuest[]; camera?: CameraFeed }) {
  const store = useStoreApi();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<TerritoryRenderer | null>(null);

  // The grid only changes when quests move into a new block of cells
  const gridKey = quests.length === 0 ? "" : Object.values(gridExtent(quests)).flat().join(",");
  const grid = useMemo(() => {
    if (!gridKey) return null;
    const [c0, c1, r0, r1] = gridKey.split(",").map(Number);
    return buildGrid({ cols: [c0, c1], rows: [r0, r1] });
  }, [gridKey]);
  const looks = useMemo(() => (grid ? computeOwners(grid, quests) : null), [grid, quests]);

  // The renderer lives as long as the canvas, and follows the camera without re-rendering React
  useLayoutEffect(() => {
    const renderer = TerritoryRenderer.create(canvasRef.current!);
    if (!renderer) return;
    rendererRef.current = renderer;
    const follow = ({ transform: [x, y, zoom] }: { transform: [number, number, number] }) => renderer.setCamera({ x, y, zoom });
    follow(store.getState());
    const unsubscribe = store.subscribe(follow);
    return () => {
      unsubscribe();
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [store]);

  useLayoutEffect(() => camera?.subscribe((next) => rendererRef.current?.setCamera(next)), [camera]);

  useLayoutEffect(() => {
    if (grid && looks) rendererRef.current?.paint(grid, looks);
  }, [grid, looks]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" style={{ zIndex: 0 }} aria-hidden="true" />;
}

export default memo(Territories);
