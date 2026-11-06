import { useEffect, useMemo, useState, type ReactNode } from "react";
import { buildGraphModel } from "../../shared/graphModel";
import type { Snapshot } from "../../shared/types";
import { statLevel } from "../../shared/progression";
import { CharacterPanel } from "../home/CharacterPanel";
import { portraitTier, preparePortrait } from "../home/Portrait";
import type { Act } from "../home/HomePage";
import { QuestGraph } from "../home/LazyQuestGraph";
import { TodayPanel } from "../home/TodayPanel";

export type PhoneHomeScreen = "todo" | "graph" | "character";

// The phone's Home section, one screen at a time: what to do today, the graph (to look at more
// than to edit), and the character. Another section (`away`, Alarms, Kitchen or Settings) is shown
// in it in Today's place, so the graph built behind it stays built.
export function PhoneHome({ snapshot, act, screen, away }: { snapshot: Snapshot; act: Act; screen: PhoneHomeScreen; away?: ReactNode }) {
  // The model reads only nodes and edges, so a routine, deadline or Kitchen change leaves it, and
  // everything the graph derives from it, as it was
  const model = useMemo(() => buildGraphModel(snapshot), [snapshot.nodes, snapshot.edges]);

  // The graph is built ahead, hidden, once the app has been idle a moment, or when first opened,
  // and the character's portrait is read then too. The graph then stays mounted, so opening it shows it rather than building it anew. While hidden it
  // keeps the data it last showed, so a change made on another screen re-renders nothing here; it
  // catches up in the render that shows it again. (requestIdleCallback: the app runs only
  // in Chromium, the desktop's Electron and Android's WebView.)
  const [graphOpened, setGraphOpened] = useState(screen === "graph");
  useEffect(() => {
    if (screen === "graph") setGraphOpened(true);
  }, [screen]);
  useEffect(() => {
    const idle = window.requestIdleCallback(
      () => {
        setGraphOpened(true);
        preparePortrait(portraitTier(statLevel(model.totalStatXp).level));
      },
      { timeout: 3000 },
    );
    return () => window.cancelIdleCallback(idle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          className={`min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl border border-ink/8 bg-panel ${screen === "graph" ? "relative" : "absolute inset-0 opacity-0"}`}
        >
          {questGraph}
        </section>
      ) : null}
      {away ? (
        <div className="flex min-h-0 min-w-0 flex-1">{away}</div>
      ) : screen === "character" ? (
        // Centred by auto margins, which give way when the card is taller than the screen (the phone
        // on its side): centring by justify-content would push its top out of scrolling's reach
        <div className="panel-scroll flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="my-auto flex w-full justify-center">
            <CharacterPanel model={model} card />
          </div>
        </div>
      ) : screen === "todo" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TodayPanel snapshot={snapshot} model={model} act={act} />
        </div>
      ) : null}
    </div>
  );
}
