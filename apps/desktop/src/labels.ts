// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// User-facing wording in one place (UI-007: 해요체, same action = same word).
import type { Category } from "./generated/Category.ts";
import type { ResolveState } from "./generated/ResolveState.ts";

export const CATEGORY_LABELS: Record<Category, string> = {
  classroom: "수업",
  file: "파일",
  image: "이미지",
  document: "문서",
  utility: "도구",
};

/** Badge text per resolver state (versioning.md §3 UI 배지). Ready has no badge. */
export const STATE_BADGES: Record<ResolveState, string | null> = {
  ready: null,
  newerNeedsAppUpdate: "새 버전은 앱 업데이트 필요",
  needsAppUpdate: "앱 업데이트 후 사용 가능",
  revoked: "사용 중지된 도구",
  invalid: "잘못된 모듈",
};
