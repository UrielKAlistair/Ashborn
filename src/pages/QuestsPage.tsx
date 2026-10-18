import { useEffect, useMemo, useState } from "react";
import { EditIcon } from "../components/icons";
import { QuestTaskButton } from "./quests/QuestTaskButton";
import {
  buildInstanceState,
  countCompletedOneOffTasks,
  getOneOffTasks,
  getQuestWeekProgress,
  getRecurringScheduleLabel,
  getRecurringTasks,
  getSingleTaskInstance,
  getTodayTasks,
} from "./quests/questSelectors";
import type {
  QuestCategory,
  Questline,
  Task,
  TaskInstance,
} from "../shared/types";

type QuestsPageProps = {
  initialInstances: TaskInstance[];
  initialQuestCategories: QuestCategory[];
  initialQuestlines: Questline[];
  onToggleTaskInstance: (instanceId: string) => void;
  tasks: Task[];
};

export function QuestsPage({
  initialInstances,
  initialQuestCategories,
  initialQuestlines,
  onToggleTaskInstance,
  tasks,
}: QuestsPageProps) {
  const [selectedQuestlineId, setSelectedQuestlineId] = useState(initialQuestlines[0]?.id ?? "");
  const instanceState = useMemo(() => buildInstanceState(initialInstances), [initialInstances]);
  const [questlines, setQuestlines] = useState(initialQuestlines);
  const [questCategories, setQuestCategories] = useState(initialQuestCategories);
  const [isEditingBoards, setIsEditingBoards] = useState(false);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setQuestlines(initialQuestlines);
  }, [initialQuestlines]);

  useEffect(() => {
    setQuestCategories(initialQuestCategories);
  }, [initialQuestCategories]);

  useEffect(() => {
    if (!questlines.some((questline) => questline.id === selectedQuestlineId) && questlines[0]) {
      setSelectedQuestlineId(questlines[0].id);
    }
  }, [questlines, selectedQuestlineId]);

  const questlineById = useMemo(
    () => new Map(questlines.map((questline) => [questline.id, questline])),
    [questlines],
  );
  const categoryQuestlinesById = useMemo(
    () =>
      new Map(
        questCategories.map((category) => [
          category.id,
          category.questlineIds
            .map((questlineId) => questlineById.get(questlineId))
            .filter((questline): questline is Questline => Boolean(questline)),
        ]),
      ),
    [questCategories, questlineById],
  );
  const weeklyProgressByQuestlineId = useMemo(
    () =>
      new Map(
        questlines.map((questline) => [
          questline.id,
          getQuestWeekProgress(tasks, questline.id, instanceState),
        ]),
      ),
    [instanceState, questlines, tasks],
  );
  const selectedQuestline = questlineById.get(selectedQuestlineId) ?? questlines[0] ?? null;
  const recurringTasks = useMemo(
    () => (selectedQuestline ? getRecurringTasks(tasks, selectedQuestline.id) : []),
    [selectedQuestline, tasks],
  );
  const oneOffTasks = useMemo(
    () => (selectedQuestline ? getOneOffTasks(tasks, selectedQuestline.id) : []),
    [selectedQuestline, tasks],
  );
  const todayTasks = useMemo(
    () => (selectedQuestline ? getTodayTasks(tasks, selectedQuestline.id, instanceState) : []),
    [instanceState, selectedQuestline, tasks],
  );
  const weeklyProgress = selectedQuestline
    ? weeklyProgressByQuestlineId.get(selectedQuestline.id) ?? {
        activeDays: [],
        done: 0,
        total: 7,
        percent: 0,
      }
    : { activeDays: [], done: 0, total: 7, percent: 0 };
  const completedOneOffTaskCount = selectedQuestline
    ? countCompletedOneOffTasks(tasks, selectedQuestline.id, instanceState)
    : 0;

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategoryIds((current) => ({
      ...current,
      [categoryId]: !current[categoryId],
    }));
  };

  const addCategory = () => {
    const nextIndex = questCategories.length + 1;
    const categoryId = `custom-category-${nextIndex}`;

    setQuestCategories((current) => [
      ...current,
      {
        id: categoryId,
        title: `New Category ${nextIndex}`,
        questlineIds: [],
      },
    ]);
    setCollapsedCategoryIds((current) => ({
      ...current,
      [categoryId]: false,
    }));
  };

  const addQuestline = (categoryId: string) => {
    const nextIndex = questlines.length + 1;
    const questlineId = `custom-questline-${nextIndex}`;
    const questline: Questline = {
      id: questlineId,
      title: `New Questline ${nextIndex}`,
      summary: "Placeholder questline for shaping category structure before the database layer exists.",
    };

    setQuestlines((current) => [...current, questline]);
    setQuestCategories((current) =>
      current.map((category) =>
        category.id === categoryId
          ? { ...category, questlineIds: [...category.questlineIds, questlineId] }
          : category,
      ),
    );
    setCollapsedCategoryIds((current) => ({
      ...current,
      [categoryId]: false,
    }));
    setSelectedQuestlineId(questlineId);
  };

  const renameCategory = (categoryId: string) => {
    const currentCategory = questCategories.find((category) => category.id === categoryId);

    if (!currentCategory) {
      return;
    }

    const nextTitle = window.prompt("Rename category", currentCategory.title)?.trim();

    if (!nextTitle) {
      return;
    }

    setQuestCategories((current) =>
      current.map((category) =>
        category.id === categoryId ? { ...category, title: nextTitle } : category,
      ),
    );
  };

  const renameQuestline = (questlineId: string) => {
    const currentQuestline = questlines.find((questline) => questline.id === questlineId);

    if (!currentQuestline) {
      return;
    }

    const nextTitle = window.prompt("Rename questline", currentQuestline.title)?.trim();

    if (!nextTitle) {
      return;
    }

    setQuestlines((current) =>
      current.map((questline) =>
        questline.id === questlineId ? { ...questline, title: nextTitle } : questline,
      ),
    );
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 gap-6 overflow-hidden">
      <aside className="flex min-h-0 w-full max-w-sm shrink-0 self-stretch flex-col overflow-hidden rounded-[28px] border border-white/12 bg-white/6 p-4 backdrop-blur-xl">
        <div className="shrink-0 border-b border-white/10 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.26em] text-white/45">
                Quests
              </p>
              <h1 className="mt-2 text-xl tracking-[0.08em] text-white/88">
                Boards
              </h1>
            </div>

            <button
              type="button"
              onClick={() => setIsEditingBoards((current) => !current)}
              aria-label={isEditingBoards ? "Exit board edit mode" : "Edit boards"}
              title={isEditingBoards ? "Done" : "Edit"}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                isEditingBoards
                  ? "border-white/18 bg-white/12 text-white/82 hover:border-white/24 hover:bg-white/16"
                  : "border-emerald-300/22 bg-emerald-400/12 text-emerald-100 hover:border-emerald-200/34 hover:bg-emerald-400/20"
              }`}
            >
              {isEditingBoards ? <span className="text-sm leading-none">×</span> : <EditIcon />}
            </button>
          </div>
        </div>

        {isEditingBoards ? (
          <div className="mt-4 shrink-0">
            <button
              type="button"
              onClick={addCategory}
              className="flex w-full items-center justify-center gap-2 rounded-[18px] border border-emerald-300/22 bg-emerald-400/12 px-3 py-3 text-[11px] uppercase tracking-[0.18em] text-emerald-100 transition-colors hover:border-emerald-200/34 hover:bg-emerald-400/20"
            >
              <span className="text-sm leading-none">+</span>
              Board
            </button>
          </div>
        ) : null}

        <div className="panel-scroll mt-4 min-h-0 w-full max-w-full flex-1 space-y-4 overflow-y-auto pr-1">
          {questCategories.map((category) => {
            const isCollapsed = Boolean(collapsedCategoryIds[category.id]);
            const categoryQuestlines = categoryQuestlinesById.get(category.id) ?? [];

            return (
              <section
                key={category.id}
                className="w-full min-w-0 max-w-full overflow-hidden rounded-[28px] border border-white/12 bg-black/10 p-4 backdrop-blur-md"
              >
                <div className="grid w-full grid-cols-[minmax(0,1fr)_8rem] items-start gap-3">
                  <button
                    type="button"
                    onClick={() => toggleCategory(category.id)}
                    className="min-w-0 overflow-hidden bg-transparent text-left"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border border-white/10 bg-white/6 text-sm text-white/56">
                        {isCollapsed ? "+" : "-"}
                      </span>
                      <div className="min-w-0 max-w-[20rem]">
                        <p className="block w-full truncate whitespace-nowrap text-[11px] uppercase tracking-[0.24em] text-white/42">
                          {category.title}
                        </p>
                      </div>
                    </div>
                  </button>

                  <div className="flex h-8 w-[8rem] shrink-0 items-center justify-end gap-2">
                    {isEditingBoards ? (
                      <>
                        <button
                          type="button"
                          onClick={() => renameCategory(category.id)}
                          aria-label={`Rename ${category.title}`}
                          title="Rename board"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/12 bg-white/8 text-white/72 transition-colors hover:border-white/18 hover:bg-white/12"
                        >
                          <EditIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => addQuestline(category.id)}
                          className="shrink-0 rounded-xl border border-white/12 bg-white/8 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-white/72 transition-colors hover:border-white/18 hover:bg-white/12"
                        >
                          + Quest
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {!isCollapsed ? (
                  <div className="mt-4 space-y-3">
                    {categoryQuestlines.length > 0 ? (
                      categoryQuestlines.map((questline) => {
                        const progress = weeklyProgressByQuestlineId.get(questline.id) ?? {
                          activeDays: [],
                          done: 0,
                          total: 7,
                          percent: 0,
                        };
                        const isActive = questline.id === selectedQuestline?.id;

                        return (
                          <button
                            key={questline.id}
                            type="button"
                            onClick={() => setSelectedQuestlineId(questline.id)}
                            className={`block w-full max-w-full overflow-hidden rounded-[22px] border p-4 text-left transition-colors ${
                              isActive
                                ? "border-emerald-200/30 bg-emerald-300/10 shadow-[0_0_0_1px_rgba(110,231,183,0.08)]"
                                : "border-white/10 bg-black/15 hover:border-white/16 hover:bg-white/8"
                            }`}
                          >
                            <div className="grid w-full grid-cols-[minmax(0,1fr)_5.5rem] items-start gap-3">
                              <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                                <p className="block max-w-[19rem] min-w-0 truncate whitespace-nowrap text-sm tracking-[0.08em] text-white/84">
                                  {questline.title}
                                </p>
                              </div>
                              <div className="flex w-[5.5rem] shrink-0 items-center justify-end gap-2">
                                {isEditingBoards ? (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      renameQuestline(questline.id);
                                    }}
                                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/12 bg-white/8 text-white/72 transition-colors hover:border-white/18 hover:bg-white/12"
                                    aria-label={`Rename ${questline.title}`}
                                    title="Rename questline"
                                  >
                                    <EditIcon className="h-3.5 w-3.5" />
                                  </button>
                                ) : null}
                                <span className="shrink-0 text-xs tracking-[0.16em] text-white/48">
                                  {progress.done}/{progress.total}
                                </span>
                              </div>
                            </div>
                            <div className="mt-3 h-2 overflow-hidden rounded-full border border-white/8 bg-black/25">
                              <div
                                className="h-full rounded-full bg-white/60"
                                style={{ width: `${progress.percent}%` }}
                              />
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-dashed border-white/12 bg-white/4 px-4 py-5 text-center">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                          Empty Board
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </aside>

      <section className="panel-scroll min-h-0 min-w-0 flex-1 self-stretch overflow-y-auto rounded-[28px] border border-white/12 bg-white/6 p-6 pr-4 backdrop-blur-xl">
        <div className="border-b border-white/10 pb-5">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h2 className="text-2xl tracking-[0.06em] text-white/90">
                {selectedQuestline?.title ?? "No Questlines"}
              </h2>
              <p className="mt-3 max-w-2xl text-sm tracking-[0.1em] text-white/56">
                {selectedQuestline?.summary ??
                  "This database is blank. Create boards, questlines, tasks, and character data before using the quest view."}
              </p>
            </div>

            <div className="rounded-[22px] border border-white/10 bg-black/15 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">
                  This Week
                </p>
                <p className="text-xs tracking-[0.16em] text-white/45">
                  {weeklyProgress.done}/{weeklyProgress.total}
                </p>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full border border-white/8 bg-black/25">
                <div
                  className="h-full rounded-full bg-white/60"
                  style={{ width: `${weeklyProgress.percent}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {selectedQuestline && todayTasks.length > 0 ? (
          <section className="mt-6 rounded-[24px] border border-white/10 bg-black/15 p-5">
            <p className="text-[11px] uppercase tracking-[0.24em] text-white/40">Today</p>

            <div className="mt-4 space-y-3">
              {todayTasks.map((task) => (
                <QuestTaskButton
                  key={task.instanceId}
                  instance={{ id: task.instanceId, status: task.status }}
                  onToggleTaskInstance={onToggleTaskInstance}
                  task={task}
                />
              ))}
            </div>
          </section>
        ) : null}

        {selectedQuestline && recurringTasks.length > 0 ? (
          <section className="mt-5 rounded-[24px] border border-white/10 bg-black/15 p-5">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-white/40">
                Recurring Tasks
              </p>
              <p className="text-xs tracking-[0.16em] text-white/45">{recurringTasks.length}</p>
            </div>

            <div className="mt-4 space-y-3">
              {recurringTasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-xl border border-white/8 bg-black/20 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm tracking-[0.08em] text-white/84">{task.title}</p>
                      {task.note ? (
                        <p className="mt-1 text-xs tracking-[0.12em] text-white/42">
                          {task.note}
                        </p>
                      ) : null}
                    </div>
                    <p className="shrink-0 text-[11px] uppercase tracking-[0.16em] text-white/45">
                      {getRecurringScheduleLabel(task)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {selectedQuestline && oneOffTasks.length > 0 ? (
          <section className="mt-5 rounded-[24px] border border-white/10 bg-black/15 p-5">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-white/40">
                Quest Tasks
              </p>
              <p className="text-xs tracking-[0.16em] text-white/45">
                {completedOneOffTaskCount}/{oneOffTasks.length}
              </p>
            </div>

            <div className="mt-4 space-y-3">
              {oneOffTasks.map((task) => {
                const instance = getSingleTaskInstance(task.id, instanceState);

                return (
                  <QuestTaskButton
                    key={task.id}
                    instance={instance}
                    onToggleTaskInstance={onToggleTaskInstance}
                    task={task}
                  />
                );
              })}
            </div>
          </section>
        ) : null}
      </section>
    </section>
  );
}
