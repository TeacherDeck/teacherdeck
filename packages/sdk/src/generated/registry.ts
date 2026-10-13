// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// 생성물: `pnpm gen`(crates/deck-codegen). 손으로 고치지 마세요(GEN-006).
export const CAPABILITIES = {
  "media-download": {
    version: "1.0.0",
    methods: {
      start: { long: false },
      status: { long: false },
      cancel: { long: false },
    },
  },
  "messaging": {
    version: "1.0.0",
    methods: {
      connect: { long: true },
      recipients: { long: true },
      plan: { long: true },
      start: { long: true },
      status: { long: false },
      cancel: { long: false },
    },
  },
  "office": {
    version: "1.0.0",
    methods: {
      availability: { long: false },
      convert: { long: true },
      cancel: { long: false },
    },
  },
  "network": {
    version: "1.0.0",
    methods: {
      adapters: { long: false },
      inspect: { long: false },
      saveProfile: { long: false },
      configureRoutine: { long: true },
      status: { long: false },
      evaluate: { long: true },
      apply: { long: true },
      stopRoutine: { long: true },
    },
  },
  "file-ops": {
    version: "1.0.0",
    methods: {
      planRename: { long: true },
      executeRename: { long: true },
      listHistory: { long: true },
      undoRename: { long: true },
    },
  },
  "school-data": {
    version: "1.1.0",
    methods: {
      status: { long: false },
      requestAccess: { long: true },
      listContexts: { long: false },
      readRoster: { long: false },
      readTimetable: { long: false },
      openPhoto: { long: true },
      closePhoto: { long: false },
      revokeAccess: { long: false },
    },
  },
  "global-shortcut": {
    version: "1.0.0",
    methods: {
      status: { long: false },
      register: { long: false },
      replace: { long: false },
      unregister: { long: false },
    },
  },
  "overlay": {
    version: "1.0.0",
    methods: {
      status: { long: false },
      create: { long: false },
      update: { long: false },
      show: { long: false },
      hide: { long: false },
      close: { long: false },
    },
  },
  "capture": {
    version: "1.0.0",
    methods: {
      displays: { long: false },
      capture: { long: true },
      arm: { long: false },
      status: { long: false },
      update: { long: false },
      trigger: { long: true },
      resetSequence: { long: false },
      stop: { long: false },
    },
  },
  "clipboard": {
    version: "1.0.0",
    methods: {
      writeText: { long: false },
      writeRichText: { long: false },
    },
  },
  "system": {
    version: "1.0.0",
    methods: {
      info: { long: false },
    },
  },
  "storage": {
    version: "1.0.0",
    methods: {
      get: { long: false },
      set: { long: false },
      delete: { long: false },
      keys: { long: false },
    },
  },
  "fs": {
    version: "1.4.0",
    methods: {
      listFiles: { long: true },
      pickDestination: { long: true },
      destinationStatus: { long: false },
      revealDestination: { long: false },
      revokeDestination: { long: false },
      pickFiles: { long: true },
      pickFolder: { long: true },
      stat: { long: false },
      reveal: { long: false },
      openRead: { long: true },
      closeRead: { long: false },
      createOutputFolder: { long: true },
      openOutputFolder: { long: true },
      beginWrite: { long: true },
      writeChunk: { long: false },
      commitWrite: { long: true },
      abortWrite: { long: false },
      closeOutputFolder: { long: false },
    },
  },
  "window": {
    version: "1.2.0",
    methods: {
      registerDocument: { long: false },
      setDocumentState: { long: false },
      completeDocumentSave: { long: false },
      listDisplays: { long: false },
      openPresentation: { long: false },
      updatePresentation: { long: false },
      closePresentation: { long: false },
      setAlwaysOnTop: { long: false },
      setFullscreen: { long: false },
    },
  },
} as const;

export type CapName = keyof typeof CAPABILITIES;
