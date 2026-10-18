import type { BoardWidget, GameSnapshot, HomeSnapshot } from "./shared/types";

export {};

declare global {
  interface Window {
    ashborn?: {
      hideToTray: () => void;
      quit: () => void;
      getGameSnapshot: () => Promise<GameSnapshot>;
      getHomeSnapshot: () => Promise<HomeSnapshot>;
      toggleTaskInstance: (instanceId: string) => Promise<GameSnapshot>;
      toggleHomeTaskInstance: (instanceId: string) => Promise<HomeSnapshot>;
      saveDashboardWidgets: (widgets: BoardWidget[]) => Promise<HomeSnapshot>;
    };
  }
}
