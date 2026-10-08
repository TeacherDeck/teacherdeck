// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// eslint-plugin-deck: custom rules whose messages carry spec rule IDs.
import noRawStyleValues from "./rules/no-raw-style-values.js";
import noWebStorage from "./rules/no-web-storage.js";

export default {
  meta: { name: "eslint-plugin-deck", version: "0.0.0" },
  rules: {
    "no-raw-style-values": noRawStyleValues,
    "no-web-storage": noWebStorage,
  },
};
