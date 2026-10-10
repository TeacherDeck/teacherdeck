// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { plan, type PlanInput } from "./planner.ts";
self.onmessage = (event: MessageEvent<PlanInput>) => {
  self.postMessage(plan(event.data));
};
