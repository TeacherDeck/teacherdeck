// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Start here. UI only from @deck/ui and Fluent (MOD-010); batch file tools use ToolLayout (MOD-011);
// host features only through `deck` (MOD-006). See modules/timer for a complete example.
import type { Deck } from "@deck/sdk";
import { EmptyState } from "@deck/ui";
import { SparkleRegular } from "@fluentui/react-icons";
import { greeting } from "./logic.ts";

export function App({ deck }: { deck: Deck }) {
  return <EmptyState icon={<SparkleRegular />} title={greeting(deck.module.id)} description="src/App.tsx에서 도구를 만들어요." />;
}
