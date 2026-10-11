// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadFavorites, saveFavorites, takeFreshModules, withFavoriteToggled } from "./deckState.ts";

beforeEach(() => window.localStorage.clear());

describe("deck home lists", () => {
  it("toggles favorites in starring order and stores only module ids", () => {
    const favorites = withFavoriteToggled(withFavoriteToggled([], "a"), "b");
    expect(favorites).toEqual(["a", "b"]);
    expect(withFavoriteToggled(favorites, "a")).toEqual(["b"]);
    saveFavorites(favorites);
    expect(loadFavorites()).toEqual(["a", "b"]);
    expect(window.localStorage.getItem("deck.shell.favorites")).toBe('["a","b"]');
  });

  it("treats nothing as new on the first launch, then reports added tools once", () => {
    expect(takeFreshModules(["a", "b"])).toEqual([]);
    expect(takeFreshModules(["a", "b", "c"])).toEqual(["c"]);
    expect(takeFreshModules(["a", "b", "c"])).toEqual([]);
  });

  it("ignores corrupt storage", () => {
    window.localStorage.setItem("deck.shell.favorites", "{not json");
    expect(loadFavorites()).toEqual([]);
  });
});
