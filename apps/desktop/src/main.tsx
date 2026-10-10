// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Fonts are Windows system fonts only; no bundled or CDN fonts (design-system.md §4, PRV-001).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { CaptureOverlay } from "./CaptureOverlay.tsx";
import { overlayControls } from "./host.ts";

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      {window.location.pathname === "/overlay" ? <CaptureOverlay controls={overlayControls} /> : <App />}
    </StrictMode>,
  );
}
