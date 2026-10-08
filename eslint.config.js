// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// ESLint flat config. Protected file (GEN-001): do not relax rules to make code pass.
// Problems print as `[RULE-ID] ...` through tools/eslint-plugin-deck/formatter.js.
import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import deck from "./tools/eslint-plugin-deck/index.js";

const MODULES_SPEC = "(정의: docs/spec/modules.md)";
const UI_SPEC = "(정의: docs/spec/design-system.md)";

/** UI-001: no component library other than Fluent UI React v9. */
const UI_001 = {
  group: [
    "@fluentui/react", "@fluentui/react/*", "@fluentui/web-components", "@fluentui/web-components/*",
    "@mui/*", "@material-ui/*", "antd", "antd/*", "@chakra-ui/*", "@mantine/*", "@radix-ui/*",
    "@headlessui/*", "react-bootstrap", "react-bootstrap/*", "@ark-ui/*", "@nextui-org/*", "@heroui/*",
    "primereact", "primereact/*", "semantic-ui-react", "@blueprintjs/*", "shadcn", "@shadcn/*",
  ],
  message: `[UI-001] Fluent UI React v9 외 컴포넌트 라이브러리는 쓰지 않아요. ${UI_SPEC}`,
};
/** UI-003: icons only from @fluentui/react-icons. */
const UI_003 = {
  group: [
    "react-icons", "react-icons/*", "@heroicons/*", "lucide-react", "lucide", "@mui/icons-material",
    "@mui/icons-material/*", "@fortawesome/*", "@tabler/icons-react", "@phosphor-icons/*", "@iconify/*",
    "@ant-design/icons", "@radix-ui/react-icons", "@fluentui/font-icons-mdl2", "@fluentui/svg-icons",
  ],
  message: `[UI-003] 아이콘은 @fluentui/react-icons만 써요. ${UI_SPEC}`,
};
/** MOD-005: modules import only @deck/sdk, @deck/ui, their own files and licensed packages. */
const MOD_005 = [
  { group: ["@tauri-apps/*"], message: `[MOD-005] 모듈은 Tauri API를 직접 쓰지 않아요. 호스트 기능은 @deck/sdk로 호출해요. ${MODULES_SPEC}` },
  { group: ["@deck-module/*"], message: `[MOD-005] 다른 모듈을 import하지 않아요. ${MODULES_SPEC}` },
  { group: ["@deck/*/*"], message: `[MOD-005] @deck 패키지의 내부 경로를 import하지 않아요. 공개 진입점만 써요. ${MODULES_SPEC}` },
  { group: ["**/apps/**", "**/packages/**", "**/modules/**", "../../*"], message: `[MOD-005] 모듈 밖의 파일을 상대 경로로 import하지 않아요. ${MODULES_SPEC}` },
];

export default defineConfig([
  globalIgnores([
    "**/node_modules/", "**/dist/", "**/target/", "**/coverage/", "schema/", "**/generated/",
    "tools/checks/__tests__/violations/",
  ]),
  {
    // GEN-003: inline lint configuration is disabled everywhere (decision F, stricter than spec).
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    rules: {
      // tsc checks undefined identifiers for TS and checkJs files.
      "no-undef": "off",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true, "ts-check": false },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx,js}", "**/__tests__/**/*.{ts,tsx,js}"],
    plugins: { "@vitest": vitest },
    rules: {
      "@vitest/no-focused-tests": "error",
      "@vitest/no-disabled-tests": "error",
    },
  },
  {
    files: ["modules/**/*.{ts,tsx,js,jsx}"],
    plugins: { deck },
    rules: {
      "no-restricted-imports": ["error", { patterns: [...MOD_005, UI_001, UI_003] }],
      "deck/no-web-storage": "error",
    },
  },
  {
    files: ["packages/**/*.{ts,tsx,js,jsx}", "apps/desktop/src/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [UI_001, UI_003] }],
    },
  },
  {
    files: ["modules/**/*.{ts,tsx,js,jsx}", "packages/ui/**/*.{ts,tsx,js,jsx}", "apps/desktop/src/**/*.{ts,tsx,js,jsx}"],
    ignores: ["packages/ui/src/tokens/**"],
    plugins: { deck },
    rules: {
      "deck/no-raw-style-values": "error",
    },
  },
]);
