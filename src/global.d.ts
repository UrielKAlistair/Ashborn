export {};

declare global {
  interface Window {
    ashborn?: {
      hideToTray: () => void;
      toggleMaximise: () => void;
      isMaximised: () => Promise<boolean>;
      onMaximisedChange: (listener: (maximised: boolean) => void) => () => void; // returns the unsubscribe
      quit: () => void;
      newestBackup: () => Promise<number | null>; // when the newest backup was written (ms), or null
      writeBackup: (json: string) => Promise<void>;
    };
  }
}
