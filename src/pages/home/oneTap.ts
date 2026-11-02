import { useRef } from "react";

// A row that leaves when tapped brings the next one under the finger: a second tap this soon is
// taken as part of the first (a double-click), not as a tap on the next row
const SETTLE_MS = 400;

export function useOneTap() {
  const last = useRef(0);
  return (action: () => void) => () => {
    if (Date.now() - last.current < SETTLE_MS) return;
    last.current = Date.now();
    action();
  };
}
