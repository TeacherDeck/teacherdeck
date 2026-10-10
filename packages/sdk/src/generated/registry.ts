// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// 생성물: `pnpm gen`(crates/deck-codegen). 손으로 고치지 마세요(GEN-006).
export const CAPABILITIES = {
  system: {
    version: "1.0.0",
    methods: {
      info: { long: false },
    },
  },
  storage: {
    version: "1.0.0",
    methods: {
      get: { long: false },
      set: { long: false },
      delete: { long: false },
      keys: { long: false },
    },
  },
  fs: {
    version: "1.1.0",
    methods: {
      pickFiles: { long: true },
      pickFolder: { long: true },
      stat: { long: false },
      reveal: { long: false },
      openRead: { long: true },
      closeRead: { long: false },
      createOutputFolder: { long: true },
      beginWrite: { long: true },
      writeChunk: { long: false },
      commitWrite: { long: true },
      abortWrite: { long: false },
      closeOutputFolder: { long: false },
    },
  },
  window: {
    version: "1.0.0",
    methods: {
      setAlwaysOnTop: { long: false },
      setFullscreen: { long: false },
    },
  },
} as const;

export type CapName = keyof typeof CAPABILITIES;
