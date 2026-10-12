// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.{ts,tsx}"],
    // Bound concurrent DOM suites so Fluent rendering does not oversubscribe school-PC/CI memory and CPUs.
    // Keep every suite and its existing timeout/assertions unchanged.
    maxWorkers: 2,
    // Violation samples are inputs for checker self-tests, never test suites themselves.
    exclude: ["**/node_modules/**", "**/dist/**", "**/target/**", "tools/checks/__tests__/violations/**"],
  },
});
