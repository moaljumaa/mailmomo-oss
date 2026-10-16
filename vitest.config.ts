import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      DEV_IMAP_PORT: "12143",
      DEV_SMTP_PORT: "12025",
      DISABLE_SYNC: "true",
      DB_PATH: ":memory:",
      DATA_DIR: path.resolve(__dirname, ".test-data"),
      MASTER_KEY: "test-master-key",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
    },
  },
});
