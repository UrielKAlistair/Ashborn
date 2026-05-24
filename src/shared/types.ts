export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type ISODateString = string;
export type TaskKind = "recurring" | "one_off";
export type TaskStatus = "open" | "done";
export type RecurrenceFrequency = "weekly" | "monthly";
export type AttributeKey = "STR" | "DEX" | "INT" | "WIS" | "CHR" | "MND";
export type ResourceKey = "HP" | "FP";

export type Questline = {
  id: string;
  title: string;
  summary: string;
};

export type QuestCategory = {
  id: string;
  title: string;
  questlineIds: string[];
};

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  weekdays?: Weekday[];
  monthDays?: number[];
};

export type TaskEffect =
  | {
      kind: "attribute_xp";
      target: AttributeKey;
      amount: number;
    }
  | {
      kind: "resource";
      target: ResourceKey;
      amount: number;
    };

export type Task = {
  id: string;
  questlineId: string;
  title: string;
  note?: string;
  kind: TaskKind;
  recurrence?: RecurrenceRule | null;
  scheduledFor?: ISODateString | null;
  keepUntilComplete?: boolean;
  effects?: TaskEffect[];
};

export type TaskInstance = {
  id: string;
  taskId: string;
  date: ISODateString;
  status: TaskStatus;
  completedAt?: ISODateString | null;
};

export type TaskInstanceState = Record<string, TaskInstance>;

export type TodayTask = Task & {
  instanceId: string;
  date: ISODateString;
  status: TaskStatus;
  completedAt?: ISODateString | null;
};

export type QuestWeekProgress = {
  activeDays: Weekday[];
  done: number;
  total: number;
  percent: number;
};

export type GridRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BoardWidget = GridRect & {
  boardId: string;
};

export type CharacterAttributeState = {
  key: AttributeKey;
  xp: number;
};

export type CharacterResourceState = {
  key: ResourceKey;
  current: number;
  max: number;
};

export type CharacterSnapshot = {
  attributes: CharacterAttributeState[];
  resources: CharacterResourceState[];
};

export type GameSnapshot = {
  questlines: Questline[];
  questCategories: QuestCategory[];
  tasks: Task[];
  instances: TaskInstance[];
  dashboardWidgets: BoardWidget[];
  character: CharacterSnapshot;
};

export type HomeTaskSnapshot = {
  id: string;
  instanceId: string;
  title: string;
};

export type QuestCardData = {
  id: string;
  title: string;
  activeDays: Weekday[];
  todayTasks: HomeTaskSnapshot[];
};

export type BoardWidgetData = {
  id: string;
  title: string;
  quests: QuestCardData[];
};

export type HomeSnapshot = {
  boards: BoardWidgetData[];
  dashboardWidgets: BoardWidget[];
  character: CharacterSnapshot;
};
