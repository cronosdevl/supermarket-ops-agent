import { defineConfig } from "vitest/config";

export default defineConfig({
  // The source uses NodeNext-style ".js" import specifiers that actually point
  // at ".ts" files. Vite resolves the ".js" literally, so map it to try ".ts"
  // first — this is what lets the suite import the app modules unchanged.
  resolve: {
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    // Injected into process.env BEFORE any app module loads. Two effects:
    //  - dummy secrets so src/util/config.ts doesn't process.exit(1), and
    //  - DB_PATH=:memory: so tests NEVER touch the real data/store.db. The DB is
    //    a per-worker singleton, so each test file gets its own clean in-memory
    //    database; resetDb() (see test/helpers/db.ts) wipes it between tests.
    env: {
      NODE_ENV: "test",
      ANTHROPIC_API_KEY: "test-anthropic-key",
      TELEGRAM_BOT_TOKEN: "test-telegram-token",
      DB_PATH: ":memory:",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Business logic we actually assert on; exclude wiring we can't unit-test
      // without a live Telegram/Anthropic connection.
      include: ["src/db/**", "src/domain/**", "src/util/**"],
      exclude: ["src/**/*.d.ts"],
    },
  },
});
