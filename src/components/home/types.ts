import type { Weekday } from "../../pages/quests/questTypes.js";

export type Stat = {
  label: string;
  value: number;
};

export type StatPanelProps = {
  fp: {
    current: number;
    max: number;
  };
  hp: {
    current: number;
    max: number;
  };
  stats: Stat[];
};

export type HomePageProps = StatPanelProps;

export type GridRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BoardWidget = GridRect & {
  boardId: string;
};

export type QuestCardData = {
  id: string;
  title: string;
  activeDays: Weekday[];
  todayTasks: Array<{
    id: string;
    instanceId: string;
    title: string;
  }>;
};

export type BoardWidgetData = {
  id: string;
  title: string;
  quests: QuestCardData[];
};
