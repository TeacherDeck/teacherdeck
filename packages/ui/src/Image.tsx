// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// WinUI Image counterpart; modules use this wrapper for local previews (UI-006).
import { Image as FluentImage, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { deckTokens } from "./tokens/index.ts";
export interface ImageProps {
  src: string;
  /** Describe the preview content; an empty alt is reserved for decorative images. */
  alt: string;
  /** Intrinsic display box dimensions, rather than spacing or theme values. */
  width?: number;
  height?: number;
  objectFit?: "contain" | "cover" | "none" | "scale-down" | "fill";
  className?: string;
}
const useStyles = makeStyles({
  image: { maxWidth: "100%", backgroundColor: tokens.colorNeutralBackground2, borderRadius: deckTokens.cardRadius },
  contain: { objectFit: "contain" },
  cover: { objectFit: "cover" },
  none: { objectFit: "none" },
  "scale-down": { objectFit: "scale-down" },
  fill: { objectFit: "fill" },
});
export function Image({ src, alt, width, height, objectFit = "contain", className }: ImageProps) {
  const styles = useStyles();
  // Fluent filters decoding out of native props, so set the standard img attribute via its ref.
  return (
    <FluentImage
      src={src}
      alt={alt}
      loading="lazy"
      ref={(element: HTMLImageElement | null) => {
        element?.setAttribute("decoding", "async");
      }}
      {...(width === undefined ? {} : { width })}
      {...(height === undefined ? {} : { height })}
      className={mergeClasses(styles.image, styles[objectFit], className)}
    />
  );
}
