import { EditIcon } from "../../components/icons";

export function DashboardHeader({
  isEditing,
  availableBoardTitles,
  onAddBoard,
  onToggleEdit,
}: {
  isEditing: boolean;
  availableBoardTitles: Array<{ id: string; title: string }>;
  onAddBoard: (boardId: string) => void;
  onToggleEdit: () => void;
}) {
  return (
    <div className="absolute top-5 right-5 z-30 flex items-start justify-end gap-3">
      <div className="flex items-center gap-2">
        {isEditing ? (
          <div className="flex flex-wrap justify-end gap-2">
            {availableBoardTitles.length > 0 ? (
              availableBoardTitles.map((board) => (
                <button
                  key={board.id}
                  type="button"
                  onClick={() => onAddBoard(board.id)}
                  className="rounded-xl border border-white/12 bg-white/8 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-white/72 transition-colors hover:border-white/18 hover:bg-white/12"
                >
                  + {board.title}
                </button>
              ))
            ) : (
              <span className="text-xs tracking-[0.12em] text-white/38">All boards added.</span>
            )}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onToggleEdit}
        aria-label={isEditing ? "Exit dashboard edit mode" : "Edit dashboard"}
        title={isEditing ? "Done" : "Edit"}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all ${
          isEditing
            ? "border-white/18 bg-white/12 text-white/82 opacity-80 hover:border-white/24 hover:bg-white/16 hover:opacity-100"
            : "border-emerald-300/22 bg-emerald-400/12 text-emerald-100 opacity-35 hover:border-emerald-200/34 hover:bg-emerald-400/20 hover:opacity-100"
        }`}
      >
        {isEditing ? <span className="text-sm leading-none">×</span> : <EditIcon />}
      </button>
    </div>
  );
}
