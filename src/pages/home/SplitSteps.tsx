import { createContext, useContext, useState } from "react";
import { breakdownPrompt } from "../../shared/breakdown";
import type { GraphModel } from "../../shared/graphModel";
import { parseStepList } from "../../shared/splitList";
import type { Snapshot } from "../../shared/types";
import type { Act } from "./HomePage";

// Adds `titles` as steps inside `parentId`; in order, each waits for the one before it
export function addSteps(act: Act, parentId: string, titles: string[], inOrder: boolean) {
  const ids = titles.map(() => crypto.randomUUID());
  titles.forEach((title, i) => void act("createNode", title, parentId, ids[i]));
  if (inOrder) ids.slice(1).forEach((id, i) => void act("addEdge", { from: ids[i], to: id }));
}

// The graph, for the prompt that asks Claude to break a step down; the graph provides it
export const SplitContext = createContext<{ model: GraphModel; snapshot: Snapshot } | null>(null);

// A list, typed or pasted, turned into steps in one go. Ctrl+Enter adds, Escape cancels.
export function SplitSteps({
  act,
  parentId,
  initial = "",
  onDone,
  graph,
  className = "w-80 shadow-[var(--card-shadow)]",
}: {
  act: Act;
  parentId: string;
  initial?: string;
  onDone: () => void;
  graph?: { model: GraphModel; snapshot: Snapshot }; // outside the graph's context
  className?: string;
}) {
  const fromGraph = useContext(SplitContext);
  const context = graph ?? fromGraph;
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const [text, setText] = useState(initial);
  const [inOrder, setInOrder] = useState(true);
  const steps = parseStepList(text);

  const submit = () => {
    if (steps.length === 0) return;
    addSteps(act, parentId, steps, inOrder);
    onDone();
  };

  return (
    <div
      className={`nodrag nopan nowheel space-y-2.5 rounded-xl border border-ink/10 bg-card p-3 text-[13px] text-ink/85 ${className}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onDone();
        }
      }}
    >
      <p className="font-display font-semibold">Split into steps</p>
      <textarea
        autoFocus
        rows={5}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={"One step per line.\nPaste a list as it is: bullets and numbers are fine."}
        aria-label="Steps, one per line"
        className="block w-full resize-y rounded-lg border border-ink/10 bg-canvas/60 px-2.5 py-2 leading-relaxed placeholder:text-muted focus:border-ember/50 focus:outline-none"
      />
      {context ? (
        <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
          <button
            type="button"
            onClick={() =>
              navigator.clipboard.writeText(breakdownPrompt(context.model, context.snapshot, parentId)).then(
                () => setCopied("yes"),
                () => setCopied("failed"),
              )
            }
            className="rounded-md px-1 py-0.5 text-ember underline-offset-2 hover:underline"
          >
            Copy a prompt for Claude
          </button>
          {copied === "yes" ? <span>Copied. Paste Claude's answer here.</span> : copied === "failed" ? <span>Couldn't copy.</span> : <span>to break it down for you</span>}
        </p>
      ) : null}
      <label className="flex cursor-pointer items-start gap-2 text-[12.5px] text-muted">
        <input type="checkbox" checked={inOrder} onChange={(event) => setInOrder(event.target.checked)} className="mt-0.5 accent-[var(--color-ember)]" />
        In this order: each step waits for the one above it
      </label>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11.5px] text-muted tabular-nums">{steps.length === 1 ? "1 step" : `${steps.length} steps`}</span>
        <div className="flex gap-2">
          <button type="button" onClick={onDone} className="rounded-lg border border-ink/12 px-3 py-1 text-ink/70 hover:bg-ink/6">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={steps.length === 0}
            className="rounded-lg bg-ember px-3 py-1 font-medium text-canvas hover:brightness-110 disabled:opacity-40"
          >
            Add {steps.length === 1 ? "step" : "steps"}
          </button>
        </div>
      </div>
    </div>
  );
}
