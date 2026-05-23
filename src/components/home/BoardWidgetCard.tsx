import { QuestCard } from "../../pages/home/QuestCard";
import type { BoardWidget, BoardWidgetData } from "./types";

export function BoardWidgetCard({
  board,
  widget,
  isEditing,
  onRemove,
}: {
  board: BoardWidgetData;
  widget: BoardWidget;
  isEditing: boolean;
  onRemove: (boardId: string) => void;
}) {
  return (
    <section
      className={`relative h-full overflow-hidden rounded-[24px] border border-white/12 bg-black/14 p-4 ${
        isEditing ? "select-none" : ""
      }`}
    >     {/* Make text non selectable during resize and drag for better UX */} 

      <div
        className={`board-widget-drag-handle flex items-start justify-between gap-3 border-b border-white/10 pb-4 ${
          isEditing ? "cursor-grab active:cursor-grabbing" : ""
        }`} 
      > {/* Header div becomes a draggable entity in edit mode, so a grab cursor is shown on it*/}
        
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">Board</p>
          <h2 className="mt-2 text-lg tracking-[0.06em] text-white/88">{board.title}</h2>
        </div>

        {isEditing ? (
          <button
            type="button"
            onClick={() => onRemove(widget.boardId)}
            className="rounded-lg border border-white/12 bg-white/8 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] text-white/72 transition-colors hover:border-white/18 hover:bg-white/12"
          >
            Remove
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3">
        {board.quests.map((quest) => (
          <QuestCard key={quest.id} quest={quest} />
        ))}
      </div>
    </section>
  );
}
