// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// WinUI type ramp (design-system.md §4). Use these names instead of Fluent's Body1/Title3 so every
// screen uses the same sizes as Windows 11. 20px and larger switch to the display font.
import {
  Body1,
  Body1Strong,
  Caption1,
  Display as FluentDisplay,
  LargeTitle,
  Subtitle1,
  type TextProps,
  Title2,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import type { ReactNode } from "react";
import { deckTokens } from "./tokens/index.ts";

export interface TypographyProps {
  children: ReactNode;
  /** Semantic element, e.g. "h1" for the page title. */
  as?: NonNullable<TextProps["as"]>;
  /** Secondary text color (WinUI TextFillColorSecondary), e.g. descriptions. */
  secondary?: boolean;
  /** Center or end alignment. */
  align?: NonNullable<TextProps["align"]>;
  className?: string;
  id?: string;
}

const useStyles = makeStyles({
  reset: { margin: 0 },
  display: { fontFamily: deckTokens.fontFamilyDisplay },
  secondary: { color: tokens.colorNeutralForeground2 },
});

type FluentText = typeof Body1;

function useTextProps({ secondary = false, className, children, ...rest }: TypographyProps, display: boolean) {
  const s = useStyles();
  return {
    ...rest,
    children,
    className: mergeClasses(s.reset, display && s.display, secondary && s.secondary, className),
  };
}

function render(Base: FluentText, props: ReturnType<typeof useTextProps>) {
  return <Base {...props} />;
}

/** 12/16. Captions, timestamps. */
export function Caption(props: TypographyProps) {
  return render(Caption1, useTextProps(props, false));
}

/** 14/20. Default body text. */
export function Body(props: TypographyProps) {
  return render(Body1, useTextProps(props, false));
}

/** 14/20 semibold. Card headers, group headers. */
export function BodyStrong(props: TypographyProps) {
  return render(Body1Strong, useTextProps(props, false));
}

/** 20/26 semibold. Dialog and empty-state titles. */
export function Subtitle(props: TypographyProps) {
  return render(Subtitle1, useTextProps(props, true));
}

/** 28/36 semibold. Page titles (use as="h1"). */
export function Title(props: TypographyProps) {
  return render(Title2, useTextProps(props, true));
}

/** 40/52 semibold. Hero headings. */
export function TitleLarge(props: TypographyProps) {
  return render(LargeTitle, useTextProps(props, true));
}

/** 68/92 semibold. Big numbers such as a timer face. */
export function Display(props: TypographyProps) {
  return render(FluentDisplay, useTextProps(props, true));
}
