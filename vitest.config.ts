import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Standalone on purpose: vite.config.ts loads the TanStack Start / Nitro
// plugin chain, which spins up a router build the adapter tests have no use for
// and cannot run under. These tests are pure functions over saved fixtures.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Fixtures are on disk and fetch is stubbed, so nothing here should ever be
    // slow. A test that hangs is a test that leaked a real network call.
    testTimeout: 10_000,
  },
});
