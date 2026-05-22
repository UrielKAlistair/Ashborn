export {};

declare global {
  interface Window {
    ashborn?: {
      hideToTray: () => void;
      quit: () => void;
    };
  }
}
