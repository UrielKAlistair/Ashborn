import { useEffect, useState } from "react";
import { discardAndLeave, saveAndLeave, stay, useQuestion } from "../lib/unsaved";

// Asked before leaving work not yet saved (lib/unsaved.ts): Save, Discard, or Keep editing
export function LeaveDialog() {
  const question = useQuestion();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!question) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      stay();
    };
    window.addEventListener("keydown", escape, { capture: true });
    return () => window.removeEventListener("keydown", escape, { capture: true });
  }, [question]);
  if (!question) return null;

  const button = "rounded-lg px-3 py-1.5 text-[12.5px] font-medium phone:min-h-11";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-canvas/60 p-4">
      <div role="alertdialog" aria-label="Discard changes?" className="panel-lift w-full max-w-sm space-y-4 rounded-2xl border border-ink/10 bg-panel p-5">
        <p className="text-[13.5px] leading-relaxed text-ink/90">You have unsaved {question.what}. Save them before leaving?</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" autoFocus onClick={stay} className={`${button} text-muted hover:text-ink/85`}>
            Keep editing
          </button>
          <button type="button" onClick={discardAndLeave} className={`${button} bg-ink/10 text-ink/90 hover:bg-ink/15`}>
            Discard
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void saveAndLeave().finally(() => setSaving(false));
            }}
            className={`${button} bg-ember text-canvas hover:brightness-110 disabled:opacity-50`}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
