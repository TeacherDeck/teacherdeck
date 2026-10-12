// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Shape of generated/module-notices.json (ADR-0030). The generator in tools/scripts/gen uses the same types.

export interface NoticeComponent {
  name: string;
  version: string;
  license: string;
  kind: "library" | "asset" | "runtime";
  /** Keys into `texts`: original notice texts, kept byte for byte. */
  texts: string[];
  note?: string;
}

export interface NoticeGroup {
  id: string;
  name: string;
  /** Tool version the notices were collected for; null for host features. */
  version: string | null;
  note?: string;
  /** Runtime libraries already listed under the app-wide notices with the same version. */
  shared: number;
  components: NoticeComponent[];
}

export interface ModuleNotices {
  $comment: string;
  groups: NoticeGroup[];
  texts: Record<string, { title: string; text: string }>;
}
