// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Generates the v1 registry table in docs/spec/capabilities.md from schema/capabilities.json (CAP-010).
import { read } from "../../checks/lib/files.ts";
import type { GenOutput } from "./index.ts";

export const CAP_DOC = "docs/spec/capabilities.md";
const START = "<!-- cap-registry:start -->";
const END = "<!-- cap-registry:end -->";

interface Registry {
  capabilities: { name: string; version: string; summary: string; methods: { name: string; long: boolean; summary: string }[] }[];
}

export function generateCapTable(root: string, capabilitiesJson: string): GenOutput {
  const reg = JSON.parse(capabilitiesJson) as Registry;
  const esc = (s: string): string => s.replace(/\|/g, "\\|");
  const rows = reg.capabilities.flatMap((c) =>
    c.methods.map((m, i) =>
      `| ${i === 0 ? `\`${c.name}\`` : ""} | ${i === 0 ? c.version : ""} | \`${m.name}\`${m.long ? " (long)" : ""} | ${esc(m.summary)} |`,
    ),
  );
  const table = [
    "<!-- 생성물: `pnpm gen`(deck-core caps::REGISTRY). 손으로 고치지 마세요(GEN-006). -->",
    "| 캡 | 버전 | 메서드 | 설명 |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
  const src = read(root, CAP_DOC);
  const start = src.indexOf(START);
  const end = src.indexOf(END);
  if (start < 0 || end < start) throw new Error(`${CAP_DOC}: cap-registry markers not found`);
  return { path: CAP_DOC, content: `${src.slice(0, start)}${START}\n${table}\n${src.slice(end)}` };
}
