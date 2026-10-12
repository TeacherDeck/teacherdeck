// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Adapted Klecks changed-tiles.ts (7b1d4744b648de6133b0d45073af4efd2f998148).
// Changes: inline area clipping and array allocation, inclusive bounds preserved.
/*
MIT License

Copyright (c) 2026 bitbof (bitbof.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
export const HISTORY_TILE_SIZE = 256;
export interface IndexBounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export function getChangedTiles(
  bounds: IndexBounds,
  width: number,
  height: number,
  tileSize = HISTORY_TILE_SIZE,
): boolean[] {
  const x1 = Math.min(bounds.x1, bounds.x2),
    y1 = Math.min(bounds.y1, bounds.y2),
    x2 = Math.max(bounds.x1, bounds.x2),
    y2 = Math.max(bounds.y1, bounds.y2);
  const tilesX = Math.ceil(width / tileSize),
    tilesY = Math.ceil(height / tileSize),
    result: boolean[] = Array<boolean>(tilesX * tilesY).fill(false);
  if (x2 < 0 || y2 < 0 || x1 >= width || y1 >= height) return result;
  const tileBounds = {
    x1: Math.max(0, Math.floor(x1 / tileSize)),
    y1: Math.max(0, Math.floor(y1 / tileSize)),
    x2: Math.min(tilesX - 1, Math.floor(x2 / tileSize)),
    y2: Math.min(tilesY - 1, Math.floor(y2 / tileSize)),
  };
  for (let i = tileBounds.x1; i <= tileBounds.x2; i++)
    for (let e = tileBounds.y1; e <= tileBounds.y2; e++) result[e * tilesX + i] = true;
  return result;
}
