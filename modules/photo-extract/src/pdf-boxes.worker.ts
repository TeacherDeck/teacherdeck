// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { cropBox, detectBoxes, wordLines, wordsIn, type Insets, type Word } from "./pdf-boxes.ts";
self.onmessage = (
  event: MessageEvent<{ pixels: Uint8ClampedArray; width: number; height: number; words: Word[]; insets: Insets }>,
) => {
  try {
    const { pixels, width, height, words, insets } = event.data;
    const items = detectBoxes(pixels, width, height).map((box) => {
      const inside = wordsIn(box, words);
      const lower = inside.filter((word) => word.y > box.y + box.height * 0.45);
      try {
        return {
          box,
          crop: cropBox(box, inside, pixels, width, height, insets),
          text: wordLines(lower.length ? lower : inside).join("\n"),
        };
      } catch {
        return { box, crop: null, text: "" };
      }
    });
    self.postMessage({ items });
  } catch {
    self.postMessage({ error: "INVALID_PAGE" });
  }
};
