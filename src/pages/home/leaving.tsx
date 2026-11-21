import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

// A row ticked here shows its filled tick, then folds away, so the rows below close up rather than
// jump; the change itself is sent at once. The first share of the time is the hold. The fold starts a
// frame or two after the tap, so from the tap it lasts about 200 ms.
const LEAVE_MS = 170;
const LEAVE_HOLD = 0.4;

type Leaver<T> = { item: T; index: number; at: number };

// The rows of `list` ticked here, drawn where they were until folded. One that hasn't left the list
// within its fold (undone, refused) is not drawn when it leaves later. Off under reduced motion.
export function useLeaving<T extends { id: string }>(list: T[]) {
  const [leaving, setLeaving] = useState<Leaver<T>[]>([]);
  const leave = (item: T) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setLeaving((current) => [...current.filter((leaver) => leaver.item.id !== item.id && fresh(leaver)), { item, index: list.indexOf(item), at: performance.now() }]);
  };
  const gone = (item: T) => setLeaving((current) => current.filter((leaver) => leaver.item !== item));
  // `shown`, the rows drawn (all of `list` or its first few), with the leaving ones put back in place
  const withLeaving = (shown: T[]) => {
    const rows: Array<T | { leaving: T }> = [...shown];
    // Each index is in the list as it was when that row was ticked, so the latest goes back first
    for (const { item, index } of leaving.filter(fresh).sort((a, b) => b.at - a.at)) {
      if (!list.some((each) => each.id === item.id) && index <= rows.length) rows.splice(index, 0, { leaving: item });
    }
    return rows;
  };
  return { leave, gone, withLeaving };
}

// Within its fold, with room for the frames before the fold starts
function fresh({ at }: { at: number }) {
  return performance.now() - at < 2 * LEAVE_MS;
}

// A leaving row's box: inert, it holds its height, then folds to nothing and reports it is gone
export function Folding({ as: Box = "div", className, onGone, children }: { as?: "div" | "li"; className: string; onGone: () => void; children: ReactNode }) {
  const box = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const shown = { height: `${box.current!.offsetHeight}px`, opacity: 1 };
    const animation = box.current!.animate([{ ...shown, offset: 0 }, { ...shown, offset: LEAVE_HOLD }, { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px", marginTop: "0px" }], { duration: LEAVE_MS, easing: "ease-in", fill: "forwards" });
    animation.onfinish = onGone;
    return () => animation.cancel();
  }, []);
  return (
    <Box ref={box as never} aria-hidden inert className={`pointer-events-none overflow-hidden ${className}`}>
      {children}
    </Box>
  );
}
