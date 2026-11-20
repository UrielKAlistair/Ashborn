import { useReactFlow, useStore } from "@xyflow/react";
import { useRef } from "react";

/**
 * The desktop graph's vertical scrollbar, on its right edge: the track stands for the quests' full
 * height together with what is on screen, the thumb for what is on screen. Dragging the thumb, or
 * pressing the track, moves the view up or down at its zoom. Hidden while everything fits.
 */

// Room kept around the quests, in graph units, so the last card can come clear of the edge
const MARGIN = 80;
const MIN_THUMB_PX = 28;

export function GraphScrollbar() {
  const { setViewport } = useReactFlow();
  // The quests' top and bottom in graph units, as one string so the store's equality check holds
  const bounds = useStore((state) => {
    let top = Infinity;
    let bottom = -Infinity;
    for (const node of state.nodeLookup.values()) {
      const y = node.internals.positionAbsolute.y;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + (node.measured.height ?? 0));
    }
    return top === Infinity ? "" : `${top - MARGIN},${bottom + MARGIN}`;
  });
  const [x, y, zoom] = useStore((state) => state.transform);
  const height = useStore((state) => state.height);
  const track = useRef<HTMLDivElement>(null);
  if (!bounds || height === 0) return null;

  const [contentTop, contentBottom] = bounds.split(",").map(Number);
  const viewTop = -y / zoom;
  const viewBottom = viewTop + height / zoom;
  if (viewTop <= contentTop && viewBottom >= contentBottom) return null;
  const top = Math.min(contentTop, viewTop);
  const span = Math.max(contentBottom, viewBottom) - top;
  const trackPx = height - 16;
  const thumbPx = Math.max(MIN_THUMB_PX, ((viewBottom - viewTop) / span) * trackPx);
  const thumbTop = ((viewTop - top) / span) * (trackPx - thumbPx) / Math.max(1e-6, 1 - (viewBottom - viewTop) / span);
  // Graph units moved per pixel of thumb travel
  const unitsPerPx = (span - (viewBottom - viewTop)) / Math.max(1, trackPx - thumbPx);

  const drag = (event: React.PointerEvent, startViewTop: number) => {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const move = (moved: PointerEvent) => void setViewport({ x, y: -(startViewTop + (moved.clientY - startY) * unitsPerPx) * zoom, zoom });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // A press on the track centres the thumb there, then drags from it
  const pressTrack = (event: React.PointerEvent) => {
    const box = track.current!.getBoundingClientRect();
    const wanted = Math.min(Math.max(0, event.clientY - box.top - thumbPx / 2), trackPx - thumbPx);
    const newTop = top + wanted * unitsPerPx;
    void setViewport({ x, y: -newTop * zoom, zoom });
    drag(event, newTop);
  };

  return (
    <div ref={track} onPointerDown={pressTrack} className="nodrag nopan absolute top-2 right-0.5 bottom-2 z-10 w-2.5 cursor-default rounded-full hover:bg-ink/[0.04]" aria-hidden="true">
      <div
        onPointerDown={(event) => drag(event, viewTop)}
        style={{ top: thumbTop, height: thumbPx }}
        className="absolute inset-x-0.5 rounded-full bg-ink/20 hover:bg-ink/35 active:bg-ink/45"
      />
    </div>
  );
}
