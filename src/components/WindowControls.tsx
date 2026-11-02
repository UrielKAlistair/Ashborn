import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, MaximiseIcon, MinimiseIcon, RestoreIcon } from "./icons";

const buttonClass =
  "flex h-6 w-9 items-center justify-center rounded-md bg-transparent text-white/45 transition-colors [-webkit-app-region:no-drag]";

// The desktop window's own title bar, as the window has no frame: a strip along the top edge
// that drags the window, over the page's top padding, with minimise (to the tray), maximise and
// close (quit, after asking) at its right
export function WindowControls() {
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [maximised, setMaximised] = useState(false);

  useEffect(() => {
    void window.ashborn?.isMaximised().then(setMaximised);
    return window.ashborn?.onMaximisedChange(setMaximised);
  }, []);

  // Escape closes the dialog. The capture phase runs before the sidebar's listener, which then
  // sees the event handled and does not hide the window.
  useEffect(() => {
    if (!showQuitConfirm) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setShowQuitConfirm(false);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [showQuitConfirm]);

  return (
    <>
      <div className="absolute inset-x-0 top-0 z-40 flex h-6 justify-end [-webkit-app-region:drag]">
        <button type="button" title="Hide to the tray (Esc)" onClick={() => window.ashborn?.hideToTray()} className={`${buttonClass} hover:bg-white/8 hover:text-white/85`}>
          <MinimiseIcon className="h-4 w-4" />
        </button>
        <button type="button" title={maximised ? "Restore" : "Maximise"} onClick={() => window.ashborn?.toggleMaximise()} className={`${buttonClass} hover:bg-white/8 hover:text-white/85`}>
          {maximised ? <RestoreIcon className="h-3.5 w-3.5" /> : <MaximiseIcon className="h-3.5 w-3.5" />}
        </button>
        <button type="button" title="Quit Ashborn" onClick={() => setShowQuitConfirm(true)} className={`${buttonClass} hover:bg-red-400/20 hover:text-red-300`}>
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      {showQuitConfirm
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-night/80 px-4"
              onClick={() => setShowQuitConfirm(false)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="quit-dialog-title"
                className="w-full max-w-[17rem] rounded-xl border border-white/10 bg-night-card p-4 text-center shadow-[var(--card-shadow)]"
                onClick={(event) => event.stopPropagation()}
              >
                <h2
                  id="quit-dialog-title"
                  className="font-display text-base font-semibold text-white/90"
                >
                  Quit Ashborn?
                </h2>
                <p className="mt-2 text-[13px] text-white/50">
                  This will close the application.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowQuitConfirm(false)}
                    className="flex-1 rounded-lg border border-white/12 px-3 py-1.5 text-[13px] text-white/75 hover:bg-white/6"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => window.ashborn?.quit()}
                    className="flex-1 rounded-lg border border-red-400/30 px-3 py-1.5 text-[13px] text-red-300 hover:bg-red-400/10"
                  >
                    Quit
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
