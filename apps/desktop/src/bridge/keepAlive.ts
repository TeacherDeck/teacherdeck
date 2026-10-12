// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Up to MAX_KEEP_ALIVE opted-in modules total, including the active one (modules.md §3).

export const MAX_KEEP_ALIVE = 3;

export interface Mounted {
  /** Module ids to keep mounted, active first. */
  mounted: string[];
  /** Ids that were mounted before and must now be unloaded. */
  evicted: string[];
}

export class KeepAliveSet {
  /** Hidden keepAlive modules, most recently used first. */
  private hidden: string[] = [];
  private active: string | null = null;

  private readonly max: number;

  constructor(max = MAX_KEEP_ALIVE) {
    this.max = max;
  }

  /** Switches to `next` (null = no module shown). `keepAlive(id)` tells whether a module opted in. */
  activate(next: string | null, keepAlive: (id: string) => boolean): Mounted {
    const before = new Set(this.mountedIds());
    const prev = this.active;
    this.hidden = this.hidden.filter((id) => id !== next);
    if (prev !== null && prev !== next && keepAlive(prev)) this.hidden.unshift(prev);
    this.hidden = this.hidden.slice(0, Math.max(0, this.max - (next !== null && keepAlive(next) ? 1 : 0)));
    this.active = next;
    const mounted = this.mountedIds();
    const now = new Set(mounted);
    return { mounted, evicted: [...before].filter((id) => !now.has(id)) };
  }

  private mountedIds(): string[] {
    return [...(this.active === null ? [] : [this.active]), ...this.hidden];
  }
}
