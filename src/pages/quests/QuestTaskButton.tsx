import type { Task, TaskStatus } from "../../shared/types";

type QuestTaskButtonInstance = {
  id: string;
  status: TaskStatus;
};

type QuestTaskButtonProps = {
  instance: QuestTaskButtonInstance | null;
  onToggleTaskInstance: (instanceId: string) => void;
  task: Task;
};

export function QuestTaskButton({
  instance,
  onToggleTaskInstance,
  task,
}: QuestTaskButtonProps) {
  const completed = instance ? instance.status === "done" : false;

  return (
    <button
      type="button"
      onClick={() => {
        if (instance) {
          onToggleTaskInstance(instance.id);
        }
      }}
      className={`flex w-full items-start gap-4 rounded-xl border px-4 py-3 text-left transition-colors ${
        completed
          ? "border-white/14 bg-white/10"
          : "border-white/8 bg-black/20 hover:border-white/12 hover:bg-white/8"
      }`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
          completed
            ? "border-white/40 bg-white/75 text-black"
            : "border-white/18 text-transparent"
        }`}
      >
        ✓
      </span>

      <span className="block min-w-0">
        <span
          className={`block text-sm tracking-[0.08em] ${
            completed ? "text-white/88" : "text-white/72"
          }`}
        >
          {task.title}
        </span>
        {task.note ? (
          <span className="mt-1 block text-xs tracking-[0.12em] text-white/42">
            {task.note}
          </span>
        ) : null}
      </span>
    </button>
  );
}
