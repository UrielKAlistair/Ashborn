export {};

declare global {
  interface Window {
    ashborn?: {
      hideToTray: () => void;
      quit: () => void;
      call: (name: string, ...args: unknown[]) => Promise<unknown>;
    };
  }
}
