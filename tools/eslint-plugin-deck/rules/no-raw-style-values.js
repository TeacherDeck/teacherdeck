// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// deck/no-raw-style-values: colors, spacing, radii, shadows and font families come from
// Fluent or @deck/ui tokens, never literals (UI-002).

/** Style properties whose values must be tokens (camelCase; kebab-case keys are normalized). */
const STYLE_KEY_RE =
  /^(color|fill|stroke|background(Color)?|border((Top|Right|Bottom|Left)|(Block|Inline)(Start|End)?)?(Color|Radius|Width)?|border(Top|Bottom|Start|End)(Left|Right|Start|End)Radius|outline(Color|Width)?|(box|text)Shadow|font(Family|Size)?|lineHeight|letterSpacing|(margin|padding|inset)(Top|Right|Bottom|Left|Block|Inline|BlockStart|BlockEnd|InlineStart|InlineEnd)?|gap|rowGap|columnGap)$/;
/** Literal values that are not design decisions. */
const SAFE_VALUE_RE = /^(0|0px|none|auto|inherit|initial|unset|revert|transparent|currentColor|\d+(\.\d+)?%)$/;
/** Color literals anywhere in a string. */
const COLOR_RE = /(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\()/i;
const MESSAGE = "[UI-002] 스타일 값 {{value}}를 하드코딩하지 마세요. Fluent 토큰(tokens.*)이나 @deck/ui 토큰을 쓰세요.";

/** @param {string} key */
const camel = (key) => key.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());

/**
 * @param {import("estree").Node} node
 * @returns {string | null} the literal text, or null if the value is not a plain literal
 */
function literalText(node) {
  if (node.type === "Literal" && (typeof node.value === "string" || typeof node.value === "number")) return String(node.value);
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? null;
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "Disallow hard-coded style values (UI-002)" },
    messages: { raw: MESSAGE },
    schema: [],
  },
  create(context) {
    /** @param {import("estree").Node} node @param {string} value */
    const report = (node, value) => context.report({ node, messageId: "raw", data: { value: JSON.stringify(value) } });
    /** @type {Set<import("estree").Node>} */
    const reported = new Set();

    return {
      Property(node) {
        const key =
          node.key.type === "Identifier" && !node.computed ? node.key.name
          : node.key.type === "Literal" && typeof node.key.value === "string" ? node.key.value
          : null;
        if (key === null || !STYLE_KEY_RE.test(camel(key))) return;
        const text = literalText(node.value);
        if (text === null || SAFE_VALUE_RE.test(text.trim()) || text.trim().startsWith("var(--")) return;
        reported.add(node.value);
        report(node.value, text);
      },
      Literal(node) {
        if (typeof node.value === "string" && !reported.has(node) && COLOR_RE.test(node.value)) report(node, node.value);
      },
      TemplateElement(node) {
        const cooked = node.value.cooked ?? "";
        if (COLOR_RE.test(cooked)) report(node, cooked);
      },
    };
  },
};
