import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["actors/*/test/**/*.test.ts"] },
});
