// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// deck/no-web-storage: modules persist data only through the storage capability (MOD-009).

const GLOBALS = new Set(["localStorage", "indexedDB", "caches"]);
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self"]);
const MESSAGE = "[MOD-009] {{name}}를 쓰지 마세요. 영속 데이터는 storage 캡(@deck/sdk)으로만 저장해요.";

/**
 * @param {import("estree").Node} node
 * @returns {string | null}
 */
function propertyName(node) {
  if (node.type !== "MemberExpression") return null;
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string") return node.property.value;
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "Disallow web storage APIs in modules (MOD-009)" },
    messages: { banned: MESSAGE },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        const scope = context.sourceCode.getScope(node);
        for (const ref of scope.through) {
          if (GLOBALS.has(ref.identifier.name)) {
            context.report({ node: ref.identifier, messageId: "banned", data: { name: ref.identifier.name } });
          }
        }
      },
      MemberExpression(node) {
        const name = propertyName(node);
        if (name === null || node.object.type !== "Identifier") {
          // window.document.cookie
          if (name === "cookie" && node.object.type === "MemberExpression" && propertyName(node.object) === "document") {
            context.report({ node, messageId: "banned", data: { name: "document.cookie" } });
          }
          return;
        }
        const obj = node.object.name;
        if (obj === "document" && name === "cookie") {
          context.report({ node, messageId: "banned", data: { name: "document.cookie" } });
        } else if (GLOBAL_OBJECTS.has(obj) && GLOBALS.has(name)) {
          context.report({ node, messageId: "banned", data: { name: `${obj}.${name}` } });
        }
      },
    };
  },
};
