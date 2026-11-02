import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, MaximiseIcon, MinimiseIcon, RestoreIcon } from "./icons";

const buttonClass =
  "flex h-6 w-9 items-center justify-center rounded-md bg-transparent text-white/40 transition-colors [-webkit-app-region:no-drag]";

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
        <button type="button" title="Hide to the tray (Esc)" onClick={() => window.ashborn?.hideToTray()} className={`${buttonClass} hover:bg-white/8 hover:text-white/75`}>
          <MinimiseIcon className="h-4 w-4" />
        </button>
        <button type="button" title={maximised ? "Restore" : "Maximise"} onClick={() => window.ashborn?.toggleMaximise()} className={`${buttonClass} hover:bg-white/8 hover:text-white/75`}>
          {maximised ? <RestoreIcon className="h-3.5 w-3.5" /> : <MaximiseIcon className="h-3.5 w-3.5" />}
        </button>
        <button type="button" title="Quit Ashborn" onClick={() => setShowQuitConfirm(true)} className={`${buttonClass} hover:bg-red-500/30 hover:text-red-100`}>
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
                className="w-full max-w-[16rem] rounded-2xl border border-white/12 bg-night-card/95 p-4 text-center shadow-xl shadow-black/25"
                onClick={(event) => event.stopPropagation()}
              >
                <h2
                  id="quit-dialog-title"
                  className="text-sm uppercase tracking-[0.2em] text-white/82"
                >
                  Quit Ashborn?
                </h2>
                <p className="mt-3 text-xs tracking-[0.14em] text-white/48">
                  This will close the application.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowQuitConfirm(false)}
                    className="flex-1 rounded-lg border border-white/10 bg-white/6 px-3 py-2 text-xs uppercase tracking-[0.18em] text-white/68 transition-colors hover:border-white/18 hover:bg-white/10 hover:text-white/82"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => window.ashborn?.quit()}
                    className="flex-1 rounded-lg border border-red-400/30 bg-red-500/18 px-3 py-2 text-xs uppercase tracking-[0.18em] text-red-200 transition-colors hover:border-red-300/45 hover:bg-red-500/28 hover:text-red-100"
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
