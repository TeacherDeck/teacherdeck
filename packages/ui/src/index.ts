// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @deck/ui public entry (packages/ui/AGENTS.md). Modules import UI only from here (MOD-010); icons
// come from @fluentui/react-icons. Every component export must appear in the shell UI gallery
// (apps/desktop/src/pages/Gallery.tsx); components.test.tsx enforces it.
export { ColorPicker } from "./ColorPicker.tsx";
export type { ColorPickerProps } from "./ColorPicker.tsx";
export { Slider } from "./Slider.tsx";
export type { SliderProps } from "./Slider.tsx";
export { CanvasSurface } from "./CanvasSurface.tsx";
export type { CanvasSurfaceProps, CanvasPoint, CanvasGesture } from "./CanvasSurface.tsx";
export { CurveEditor } from "./CurveEditor.tsx";
export type { CurveEditorProps, CurvePoint } from "./CurveEditor.tsx";
export { ImageCropPreview } from "./ImageCropPreview.tsx";
export type { ImageCropPreviewProps, CropRect } from "./ImageCropPreview.tsx";
export { Image } from "./Image.tsx";
export type { ImageProps } from "./Image.tsx";
export { DeckProvider } from "./DeckProvider.tsx";
export type { DeckProviderProps } from "./DeckProvider.tsx";
export { PresentationControls } from "./PresentationControls.tsx";
export type { PresentationControlsProps } from "./PresentationControls.tsx";
export {
  CapabilityGate,
  DropZone,
  EmptyState,
  PageHeader,
  SettingsCard,
  SettingsExpander,
  SettingsGroup,
  ToolLayout,
} from "./components.tsx";
export type {
  CapabilityGateProps,
  DropZoneProps,
  EmptyStateProps,
  PageHeaderProps,
  SettingsCardProps,
  SettingsExpanderProps,
  SettingsGroupProps,
  ToolLayoutProps,
  ToolSectionProps,
  ToolStep,
} from "./components.tsx";
export {
  CheckBox,
  ComboBox,
  ContentDialog,
  HyperlinkButton,
  InfoBar,
  ListView,
  NumberBox,
  ProgressBar,
  ProgressRing,
  RadioButtons,
  TextBox,
  ToggleSwitch,
} from "./controls.tsx";
export type {
  CheckBoxProps,
  ChoiceOption,
  ComboBoxProps,
  ContentDialogProps,
  ContentDialogResult,
  HeaderedProps,
  HyperlinkButtonProps,
  InfoBarProps,
  InfoBarSeverity,
  ListViewProps,
  NumberBoxProps,
  ProgressBarProps,
  ProgressRingProps,
  RadioButtonsProps,
  TextBoxProps,
  ToggleSwitchProps,
} from "./controls.tsx";
export { Body, BodyStrong, Caption, Display, Subtitle, Title, TitleLarge } from "./typography.tsx";
export type { TypographyProps } from "./typography.tsx";
export {
  FONT_STACK,
  FONT_STACK_DISPLAY,
  createDeckTheme,
  deckTokens,
  payloadToTheme,
  themeToPayload,
} from "./tokens/index.ts";
export type { DeckTheme } from "./tokens/index.ts";

// Fluent pieces used as-is: they already match WinUI (Button appearance="primary" = AccentButton).
export { Button, ToggleButton, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
export type { ButtonProps, ToggleButtonProps, TooltipProps } from "@fluentui/react-components";

/** Component names the gallery must show. */
export const COMPONENTS = [
  "DeckProvider",
  "PresentationControls",
  "PageHeader",
  "ToolLayout",
  "SettingsGroup",
  "SettingsCard",
  "SettingsExpander",
  "CapabilityGate",
  "EmptyState",
  "DropZone",
  "Caption",
  "Body",
  "BodyStrong",
  "Subtitle",
  "Title",
  "TitleLarge",
  "Display",
  "Button",
  "ToggleButton",
  "HyperlinkButton",
  "Tooltip",
  "InfoBar",
  "ProgressBar",
  "ProgressRing",
  "ContentDialog",
  "TextBox",
  "NumberBox",
  "ComboBox",
  "RadioButtons",
  "ToggleSwitch",
  "CheckBox",
  "ListView",
  "Image",
  "ImageCropPreview",
  "ColorPicker",
  "Slider",
  "CanvasSurface",
  "CurveEditor",
] as const;
