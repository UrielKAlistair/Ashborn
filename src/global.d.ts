export {};

declare global {
  interface Window {
    ashborn?: {
      hideToTray: () => void;
      quit: () => void;
      newestBackup: () => Promise<number | null>; // when the newest backup was written (ms), or null
      writeBackup: (json: string) => Promise<void>;
    };
  }
}
