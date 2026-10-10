// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { Field, makeStyles, tokens } from "@fluentui/react-components";
import { useId } from "react";
import { deckTokens } from "./tokens/index.ts";
import type { HeaderedProps } from "./controls.tsx";

const useStyles = makeStyles({
  input: {
    width: deckTokens.listItemHeight,
    height: tokens.lineHeightBase500,
    padding: tokens.spacingHorizontalXXS,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    borderRadius: deckTokens.cardRadius,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: "pointer",
    ":focus-visible": { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
});
export interface ColorPickerProps extends HeaderedProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}
/** Opaque RGB color swatch using the platform picker; no raw color-code typing required. */
export function ColorPicker({
  header,
  showHeader = true,
  value,
  onChange,
  description,
  disabled = false,
}: ColorPickerProps) {
  const id = useId();
  const s = useStyles();
  return (
    <Field
      {...(description === undefined ? {} : { hint: description })}
      {...(showHeader ? { label: { children: header, htmlFor: id } } : {})}
    >
      <input
        id={id}
        aria-label={header}
        type="color"
        className={s.input}
        value={value}
        disabled={disabled}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
    </Field>
  );
}
