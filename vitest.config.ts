// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.{ts,tsx}"],
    // Run one worker so parallel Fluent DOM memory costs do not affect the existing 5-second test limit.
    // Keep every suite and its existing timeout/assertions unchanged.
    maxWorkers: 1,
    // Keep file progress visible in local, CI, and agent runs.
    reporters: ["default"],
    // Violation samples are inputs for checker self-tests, never test suites themselves.
    exclude: ["**/node_modules/**", "**/dist/**", "**/target/**", "tools/checks/__tests__/violations/**"],
  },
});
