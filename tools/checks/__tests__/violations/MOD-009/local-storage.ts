// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
export function save(v: string): void {
  localStorage.setItem("k", v);
}
