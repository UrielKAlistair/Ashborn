import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The connector's consent page (consent.html), built on its own into dist-consent/ for a static
// host: Supabase's OAuth server sends the user there to approve an agent's access.
//   npx vite build -c vite.consent.config.ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  build: {
    outDir: "dist-consent",
    rollupOptions: { input: "consent.html" },
  },
});
