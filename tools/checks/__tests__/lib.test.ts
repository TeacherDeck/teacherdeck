// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { renderTable } from "../../scripts/gen/rule-index.ts";
import { checkCommitMessage } from "../check-commit-msg.ts";
import { denyTomlAllow, isAllowedExpression } from "../check-licenses.ts";
import { format } from "../lib/report.ts";
import { anchorsOf, parseRuleDefs, parseRuleRefs, slug } from "../lib/spec.ts";
import { cargoWorkspaceVersion, setCargoWorkspaceVersion } from "../lib/versions.ts";

describe("report", () => {
  it("formats as [RULE-ID] location: message (정의: spec)", () => {
    expect(format({ rule: "MOD-005", file: "a.ts", line: 3, message: "금지" })).toBe(
      "[MOD-005] a.ts:3: 금지 (정의: docs/spec/modules.md)",
    );
  });
});

describe("spec parser", () => {
  const md = [
    "# 문서",
    "## 5. 규칙",
    "- **GEN-005** [MUST] 정지 조건. 다음 경우 멈춘다.",
    "  - 하위 항목",
    "",
    "  — 강제: 훅, [manual]",
    "- **DOC-002** [MUST] 절차를 지킨다([3절](#3-절)). 상세. — 강제: [manual]",
    "```",
    "- **MOD-005** [MUST NOT] 코드 블록 안 예시. — 강제: x",
    "```",
  ].join("\n");

  it("parses definitions, multi-line enforcement and skips code fences", () => {
    const defs = parseRuleDefs("docs/spec/process.md", md);
    expect(defs.map((d) => d.id)).toEqual(["GEN-005", "DOC-002"]);
    expect(defs[0]?.enforcement).toBe("훅, [manual]");
    expect(defs[1]?.summary).toBe("절차를 지킨다(3절).");
  });

  it("expands reference ranges", () => {
    expect(parseRuleRefs("UI-001~003, CAP-008").map((r) => r.id)).toEqual(["UI-001", "UI-002", "UI-003", "CAP-008"]);
  });

  it("computes GitHub-style anchors", () => {
    expect(slug("6. `@deck/ui` 컴포넌트")).toBe("6-deckui-컴포넌트");
    expect(slug("3. 캡 추가·변경 절차")).toBe("3-캡-추가변경-절차");
    expect([...anchorsOf("## A\n## A\n")]).toEqual(["a", "a-1"]);
  });

  it("renders the rule index in prefix order", () => {
    const table = renderTable(parseRuleDefs("docs/spec/process.md", md));
    expect(table.indexOf("GEN-005")).toBeLessThan(table.indexOf("DOC-002"));
  });
});

describe("licenses", () => {
  const allowed = new Set(["MIT", "Apache-2.0"]);
  it("evaluates OR / AND expressions", () => {
    expect(isAllowedExpression("(MIT OR GPL-3.0)", allowed)).toBe(true);
    expect(isAllowedExpression("MIT AND GPL-3.0", allowed)).toBe(false);
    expect(isAllowedExpression("MIT AND Apache-2.0", allowed)).toBe(true);
  });
  it("reads deny.toml [licenses].allow", () => {
    expect(denyTomlAllow('[licenses]\nallow = [\n  "MIT",\n  "ISC",\n]\n[bans]\n')).toEqual(["MIT", "ISC"]);
  });
});

describe("versions", () => {
  const toml = '[workspace]\nmembers = []\n\n[workspace.package]\nversion = "0.1.0"\nedition = "2024"\n';
  it("reads and writes the workspace version", () => {
    expect(cargoWorkspaceVersion(toml)).toBe("0.1.0");
    expect(cargoWorkspaceVersion(setCargoWorkspaceVersion(toml, "1.0.0"))).toBe("1.0.0");
  });
});

describe("commit-msg", () => {
  it("exempts merge commits and ignores comment lines", () => {
    expect(checkCommitMessage("Merge branch 'x'\n")).toEqual([]);
    expect(checkCommitMessage("fix: a\n\nSigned-off-by: A <a@example.com>\n# comment\n")).toEqual([]);
  });
});
