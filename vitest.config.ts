import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dedicated Vitest config (kept separate from vite.config.ts, which is tuned for
// Tauri dev/build). Runs the migrated hand-rolled suites plus new coverage under
// jsdom so React component/hook tests and plain TS unit tests share one runner.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    css: true,
    testTimeout: 20000,
    // Run test files sequentially rather than in parallel worker processes. This
    // machine's transform/spawn overhead under many concurrent workers was causing
    // some in-flight async DB calls in one file to still be running (unawaited, past
    // their per-test timeout) while a later test in another file started — a classic
    // timed-out-test-leaks-into-next-test race, not a product bug. Confirmed: running
    // tests/db.test.ts alone passed 11/11 every time; only the full concurrent run
    // produced flaky cross-test failures. Correctness matters more than wall-clock
    // speed for this suite, so trade parallelism for determinism.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/**/*.d.ts",
      ],
    },
  },
});
