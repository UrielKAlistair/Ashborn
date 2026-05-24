import type { QuestCardData } from "../../shared/types";

const week = ["M", "T", "W", "T", "F", "S", "S"] as const;
const weekdayKeys = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function QuestCard({ quest }: { quest: QuestCardData }) {
  return (
    <article className="rounded-[20px] border border-white/10 bg-black/18 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm tracking-[0.08em] text-white/84">{quest.title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {weekdayKeys.map((day, index) => {
            const isActive = quest.activeDays.includes(day);

            return (
              <div key={day} className="flex flex-col items-center gap-1">
                <span className="text-[9px] uppercase tracking-[0.08em] text-white/34">
                  {week[index]}
                </span>
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px] ${
                    isActive
                      ? "border-white/32 bg-white/80 text-black"
                      : "border-white/10 bg-white/4 text-transparent"
                  }`}
                >
                  ✓
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {quest.todayTasks.map((task) => (
          <div
            key={task.instanceId ?? task.id}
            className="rounded-xl border border-white/8 bg-white/6 px-3 py-2"
          >
            <p className="text-xs tracking-[0.12em] text-white/74">{task.title}</p>
          </div>
        ))}

        {quest.todayTasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/4 px-3 py-2">
            <p className="text-xs tracking-[0.12em] text-white/36">No tasks due today.</p>
          </div>
        ) : null}
      </div>
    </article>
  );
}
