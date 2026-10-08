// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `window` capability types (capabilities.md §2.3).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Arguments of `setAlwaysOnTop` and `setFullscreen`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct ToggleArgs {
    /// Turn the state on (`true`) or off (`false`).
    pub value: bool,
}

/// Window state a module changed, so the host can restore it when the module hides (§2.3).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WindowOverrides {
    /// Original always-on-top state before the module changed it.
    pub always_on_top: Option<bool>,
    /// Original fullscreen state before the module changed it.
    pub fullscreen: Option<bool>,
}

impl WindowOverrides {
    /// Remembers the original value the first time a module changes always-on-top.
    pub fn note_always_on_top(&mut self, original: bool) {
        self.always_on_top.get_or_insert(original);
    }

    /// Remembers the original value the first time a module changes fullscreen.
    pub fn note_fullscreen(&mut self, original: bool) {
        self.fullscreen.get_or_insert(original);
    }

    /// Takes the values to restore, leaving nothing pending.
    pub fn take(&mut self) -> Self {
        std::mem::take(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_first_original_value() {
        let mut o = WindowOverrides::default();
        o.note_always_on_top(false);
        o.note_always_on_top(true);
        o.note_fullscreen(false);
        let restore = o.take();
        assert_eq!(restore.always_on_top, Some(false));
        assert_eq!(restore.fullscreen, Some(false));
        assert_eq!(o, WindowOverrides::default());
    }
}
