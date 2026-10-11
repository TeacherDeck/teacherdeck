// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { planDetailed, type DetailedState } from "./detailed.ts";
import type { PlanInput } from "./planner.ts";
self.onmessage = (event: MessageEvent<{ input: PlanInput; detailed: DetailedState }>) => {
  self.postMessage(planDetailed(event.data.input, event.data.detailed));
};
