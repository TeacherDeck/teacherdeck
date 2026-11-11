// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { Button, ToggleButton, Tooltip, type ButtonProps } from "@deck/ui";
import type { MouseEventHandler } from "react";
import { EditorIcon, type EditorIconName } from "./EditorIcon.tsx";

export interface EditorActionProps extends Pick<ButtonProps, "disabled" | "className" | "appearance" | "size"> {
  icon: EditorIconName;
  /** Keep the established control name, even when its visible text becomes an icon. */
  label: string;
  shortcut?: string;
  /** A defined value selects ToggleButton and exposes aria-pressed. */
  selected?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** Show text for actions where the user needs an explicit confirmation. */
  labelVisible?: boolean;
}

/** Shared controls retain Fluent focus, keyboard behavior, and the existing accessible name. */
export function EditorAction({
  icon,
  label,
  shortcut,
  selected,
  labelVisible = false,
  ...buttonProps
}: EditorActionProps) {
  const tooltip = shortcut === undefined ? label : `${label} (${shortcut})`;
  const shared = {
    ...buttonProps,
    as: "button" as const,
    "aria-label": label,
    type: "button" as const,
    icon: <EditorIcon name={icon} />,
  };
  const contents = labelVisible ? label : undefined;
  return (
    <Tooltip content={tooltip} relationship="description" positioning="above">
      {selected === undefined ? (
        <Button {...shared}>{contents}</Button>
      ) : (
        <ToggleButton {...shared} checked={selected}>
          {contents}
        </ToggleButton>
      )}
    </Tooltip>
  );
}
