import { lazy, Suspense, type ComponentProps } from "react";

// The graph's code (React Flow, the layout, the hex canvas) loads as a chunk of its
// own, so the first screen starts without parsing it
const Graph = lazy(() => import("./QuestGraph").then((module) => ({ default: module.QuestGraph })));

export function QuestGraph(props: ComponentProps<typeof Graph>) {
  return (
    <Suspense fallback={null}>
      <Graph {...props} />
    </Suspense>
  );
}
