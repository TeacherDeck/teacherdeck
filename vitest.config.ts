// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.{ts,tsx}"],
    // Violation samples are inputs for checker self-tests, never test suites themselves.
    exclude: ["**/node_modules/**", "**/dist/**", "**/target/**", "tools/checks/__tests__/violations/**"],
  },
});
