import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      // Some modules under test import @/db, whose client requires a URL at
      // module init. The driver never connects unless a query runs — and unit
      // tests never query — so a placeholder satisfies it.
      // Placeholder only when nothing real is set. It used to be
      // unconditional, which silently overrode a genuine DATABASE_URL and made
      // it impossible to point a test at an actual database.
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test",
    },
  },
  resolve: {
    alias: {
      // Modules import "server-only" as an RSC guard; stub it under vitest.
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
});
