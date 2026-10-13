// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
/** A guarded indexed access, including typed arrays with runtime length validation. */
export function defined<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new RangeError("이미지 데이터의 범위를 확인해주세요.");
  return value;
}
