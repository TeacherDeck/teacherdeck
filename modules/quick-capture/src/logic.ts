// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type {
  CaptureSettings,
  Deck,
  DisplayInfo,
  OverlayInfo,
  OverlayStyle,
  PhysicalRect,
  ShortcutRegisterArgs,
} from "@deck/sdk";

import { createDeckTheme } from "@deck/ui";

export interface Preferences {
  version: 1;
  settings: CaptureSettings;
  shortcut: ShortcutRegisterArgs;
  style: OverlayStyle;
  rect?: PhysicalRect;
  alwaysOnTop: boolean;
  destinationGrant?: string;
}
export const PREFERENCES_KEY = "capture-preferences-v1";
export function defaults(borderColor: string): Preferences {
  return {
    version: 1,
    settings: { format: "png", quality: 95, naming: { mode: "numbered" }, cursor: false },
    shortcut: { modifiers: ["control", "shift"], key: "C" },
    style: { borderColor, borderWidth: Number.parseFloat(createDeckTheme("light").strokeWidthThick) },
    alwaysOnTop: true,
  };
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
export function restorePreferences(value: unknown, borderColor: string): Preferences {
  const base = defaults(borderColor);
  const v = record(value);
  if (v["version"] !== 1) return base;
  const settings = record(v["settings"]),
    naming = record(settings["naming"]),
    style = record(v["style"]),
    shortcut = record(v["shortcut"]),
    rect = record(v["rect"]);
  const mode = naming["mode"];
  const key = shortcut["key"];
  const modifiers = shortcut["modifiers"];
  const grant = v["destinationGrant"];
  return {
    ...base,
    settings: {
      format: settings["format"] === "jpeg" ? "jpeg" : "png",
      quality:
        typeof settings["quality"] === "number" && Number.isFinite(settings["quality"])
          ? Math.min(100, Math.max(1, Math.round(settings["quality"])))
          : 95,
      naming: {
        mode: mode === "custom" || mode === "datetime" ? mode : "numbered",
        ...(typeof naming["prefix"] === "string" ? { prefix: [...naming["prefix"]].slice(0, 80).join("") } : {}),
      },
      cursor: false,
    },
    shortcut:
      typeof key === "string" &&
      /^(?:[A-Z0-9]|F(?:[1-9]|1[01]))$/.test(key) &&
      Array.isArray(modifiers) &&
      modifiers.length > 0 &&
      modifiers.every((m) => ["control", "shift", "alt", "meta"].includes(String(m)))
        ? { key, modifiers: [...new Set(modifiers)] as ShortcutRegisterArgs["modifiers"] }
        : base.shortcut,
    style: {
      borderColor:
        typeof style["borderColor"] === "string" && /^#[\da-f]{6}$/i.test(style["borderColor"])
          ? style["borderColor"]
          : borderColor,
      borderWidth:
        typeof style["borderWidth"] === "number" && Number.isFinite(style["borderWidth"])
          ? Math.min(12, Math.max(1, Math.round(style["borderWidth"])))
          : base.style.borderWidth,
    },
    alwaysOnTop: v["alwaysOnTop"] !== false,
    ...(["x", "y", "width", "height"].every((k) => Number.isSafeInteger(rect[k])) &&
    Number(rect["x"]) >= -2147483648 &&
    Number(rect["y"]) >= -2147483648 &&
    Number(rect["x"]) + Number(rect["width"]) <= 2147483647 &&
    Number(rect["y"]) + Number(rect["height"]) <= 2147483647 &&
    Number(rect["width"]) >= 5 &&
    Number(rect["height"]) >= 5 &&
    Number(rect["width"]) <= 16384 &&
    Number(rect["height"]) <= 16384 &&
    Number(rect["width"]) * Number(rect["height"]) <= 32 * 1024 * 1024
      ? {
          rect: {
            x: Number(rect["x"]),
            y: Number(rect["y"]),
            width: Number(rect["width"]),
            height: Number(rect["height"]),
          },
        }
      : {}),
    ...(typeof grant === "string" && grant.length < 256 ? { destinationGrant: grant } : {}),
  };
}
/** Retain crossing-monitor coordinates when any real screen remains; host revalidates bounds. */
export function initialRect(displays: DisplayInfo[], preferred?: PhysicalRect): PhysicalRect {
  if (
    preferred &&
    displays.some(
      ({ bounds: b }) =>
        preferred.x < b.x + b.width &&
        preferred.x + preferred.width > b.x &&
        preferred.y < b.y + b.height &&
        preferred.y + preferred.height > b.y,
    )
  )
    return preferred;
  const display = displays.find((d) => d.primary) ?? displays[0];
  if (!display) throw new Error("NO_DISPLAY");
  const b = display.bounds;
  const width = Math.min(600, b.width),
    height = Math.min(400, b.height);
  return { x: b.x + Math.floor((b.width - width) / 2), y: b.y + Math.floor((b.height - height) / 2), width, height };
}
export function shortcutLabel(shortcut: ShortcutRegisterArgs): string {
  const names = { control: "Ctrl", shift: "Shift", alt: "Alt", meta: "Win" };
  return [...shortcut.modifiers.map((m) => names[m]), shortcut.key].join(" + ");
}
/** Roll back only resources created by this attempt. Existing host sessions remain independent. */
export async function startCapture(deck: Deck, prefs: Preferences, destinationGrant: string) {
  validatePreferences(prefs);
  const rect = initialRect(await deck.capture.displays(), prefs.rect);
  let overlay: OverlayInfo | undefined;
  let shortcutHandle: string | undefined;
  try {
    overlay = await deck.overlay.create({ rect, style: prefs.style, alwaysOnTop: prefs.alwaysOnTop });
    shortcutHandle = (await deck.globalShortcut.register(prefs.shortcut)).shortcutHandle;
    const session = await deck.capture.arm({
      overlayHandle: overlay.overlayHandle,
      shortcutHandle,
      destinationGrant,
      settings: prefs.settings,
    });
    return { overlay, session };
  } catch (error) {
    if (shortcutHandle) await deck.globalShortcut.unregister({ shortcutHandle }).catch(() => undefined);
    if (overlay) await deck.overlay.close({ overlayHandle: overlay.overlayHandle }).catch(() => undefined);
    throw error;
  }
}
/** Reject invalid edits before acquiring native resources or replacing a working shortcut. */
export function validatePreferences(prefs: Preferences): void {
  const fail = () => {
    throw new Error("INVALID_PREFERENCES");
  };
  if (
    !Number.isInteger(prefs.settings.quality) ||
    prefs.settings.quality < 1 ||
    prefs.settings.quality > 100 ||
    prefs.settings.cursor
  )
    fail();
  if (
    !/^#[\da-f]{6}$/i.test(prefs.style.borderColor) ||
    !Number.isInteger(prefs.style.borderWidth) ||
    prefs.style.borderWidth < 1 ||
    prefs.style.borderWidth > 12
  )
    fail();
  if (!prefs.shortcut.modifiers.length || new Set(prefs.shortcut.modifiers).size !== prefs.shortcut.modifiers.length)
    fail();
  if (prefs.settings.naming.mode === "custom") {
    const prefix = prefs.settings.naming.prefix ?? "";
    if (
      !prefix ||
      [...prefix].length > 80 ||
      /[<>:"/\\|?*]/.test(prefix) ||
      [...prefix].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      /[. ]$/.test(prefix) ||
      /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(prefix)
    )
      fail();
  }
  if (prefs.rect) {
    const r = prefs.rect;
    if (
      ![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) ||
      r.width < 5 ||
      r.height < 5 ||
      r.width > 16384 ||
      r.height > 16384 ||
      r.width * r.height > 32 * 1024 * 1024 ||
      r.x < -2147483648 ||
      r.y < -2147483648 ||
      r.x + r.width > 2147483647 ||
      r.y + r.height > 2147483647
    )
      fail();
  }
}
