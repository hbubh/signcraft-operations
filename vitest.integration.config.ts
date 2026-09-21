import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.integration.test.ts"],
    hookTimeout: 180000,
    testTimeout: 30000,
    fileParallelism: false,
  },
});
