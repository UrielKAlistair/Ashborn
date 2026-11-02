import { useEffect, useMemo, useState } from "react";
import { buildGraphModel } from "../../shared/graphModel";
import type { Snapshot } from "../../shared/types";
import { CharacterPanel } from "../home/CharacterPanel";
import type { Act } from "../home/HomePage";
import { QuestGraph } from "../home/QuestGraph";
import { TodayPanel } from "../home/TodayPanel";

export type PhoneHomeScreen = "todo" | "graph" | "character";

// The phone's Home section, one screen at a time: what to do today, the graph (to look at more
// than to edit), and the character
export function PhoneHome({ snapshot, act, screen }: { snapshot: Snapshot; act: Act; screen: PhoneHomeScreen }) {
  // The model reads only nodes and edges, so a routine, deadline or Kitchen change leaves it, and
  // everything the graph derives from it, as it was
  const model = useMemo(() => buildGraphModel(snapshot), [snapshot.nodes, snapshot.edges]);

  // The graph is built ahead, hidden, once the app has been idle a moment, or when first opened,
  // and then stays mounted, so opening it shows it rather than building it anew. While hidden it
  // keeps the data it last showed, so a change made on another screen re-renders nothing here; it
  // catches up in the render that shows it again. (requestIdleCallback: the app runs only
  // in Chromium, the desktop's Electron and Android's WebView.)
  const [graphOpened, setGraphOpened] = useState(screen === "graph");
  useEffect(() => {
    if (screen === "graph") setGraphOpened(true);
  }, [screen]);
  useEffect(() => {
    const idle = window.requestIdleCallback(() => setGraphOpened(true), { timeout: 3000 });
    return () => window.cancelIdleCallback(idle);
  }, []);
  const [shown, setShown] = useState({ snapshot, model });
  if (screen === "graph" && (shown.snapshot !== snapshot || shown.model !== model)) setShown({ snapshot, model });
  const questGraph = useMemo(() => <QuestGraph snapshot={shown.snapshot} model={shown.model} act={act} phone />, [shown, act]);

  // The same tree on every screen, so React keeps the graph when the screen changes. Hidden, the
  // graph lies over the other screen at the size it is shown at, so React Flow has already measured
  // and fitted it when it is opened. It is hidden by opacity and made inert: React Flow sets
  // `visibility: visible` on each node and the cards take the pointer, so visibility:hidden or
  // pointer-events:none on the section would leave cards showing and taking taps.
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {graphOpened || screen === "graph" ? (
        <section
          inert={screen !== "graph"}
          className={`min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl border border-white/8 bg-night-panel ${screen === "graph" ? "relative" : "absolute inset-0 opacity-0"}`}
        >
          {questGraph}
        </section>
      ) : null}
      {screen === "character" ? (
        <div className="panel-scroll flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-y-auto">
          <CharacterPanel model={model} card />
        </div>
      ) : screen === "todo" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TodayPanel snapshot={snapshot} model={model} act={act} />
        </div>
      ) : null}
    </div>
  );
}
