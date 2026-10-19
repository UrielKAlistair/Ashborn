import type { CapacitorConfig } from "@capacitor/cli";

// The Android app: the same web app (built into dist/) packaged with Capacitor
const config: CapacitorConfig = {
  appId: "dev.ashborn.app",
  appName: "Ashborn",
  webDir: "dist",
};

export default config;
