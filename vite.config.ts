import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      server: { entry: "server" },
    }),
    react(),
    nitro({
      preset: "vercel",
      vercel: {
        // Nitro emits ONE catch-all function (__server.func) that serves both the
        // /api/public/jobs/* routes and every server function — including
        // runRefreshJobChunk, which runs a ~50s chunk. So the ceiling has to be
        // raised on the base config; a functionRules entry would not cover server
        // functions and would full-copy the server bundle for nothing.
        // 60s is the Vercel Hobby maximum.
        functions: { maxDuration: 60 },
      },
    }),
  ],
  css: { transformer: "lightningcss" },
});
