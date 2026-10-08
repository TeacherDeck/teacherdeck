// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Keep pure logic in plain functions so it can be unit-tested without the host (MOD-015).

export function greeting(moduleId: string): string {
  return `${moduleId} 준비됐어요`;
}
