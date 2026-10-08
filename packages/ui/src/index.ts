// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @deck/ui public entry (packages/ui/AGENTS.md). Every component export must appear in the shell
// UI gallery (apps/desktop/src/pages/Gallery.tsx); gallery.test.tsx enforces it.
export { DeckProvider } from "./DeckProvider.tsx";
export type { DeckProviderProps } from "./DeckProvider.tsx";
export { CapabilityGate, DropZone, EmptyState, SettingsCard, SettingsExpander, ToolLayout } from "./components.tsx";
export type {
  CapabilityGateProps,
  DropZoneProps,
  EmptyStateProps,
  SettingsCardProps,
  SettingsExpanderProps,
  ToolLayoutProps,
  ToolSectionProps,
  ToolStep,
} from "./components.tsx";
export { FONT_STACK, createDeckTheme, deckTokens, payloadToTheme, themeToPayload } from "./tokens/index.ts";

/** Component names the gallery must show. */
export const COMPONENTS = [
  "DeckProvider",
  "ToolLayout",
  "SettingsCard",
  "SettingsExpander",
  "CapabilityGate",
  "EmptyState",
  "DropZone",
] as const;
