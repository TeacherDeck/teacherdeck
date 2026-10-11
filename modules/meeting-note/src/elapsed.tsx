// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { Caption } from "@deck/ui";
import { useEffect, useState } from "react";

export function elapsedLabel(startedAt: string | undefined, now: number): string {
  const start = Date.parse(startedAt ?? "");
  if (!Number.isFinite(start)) return "";
  const minutes = Math.floor(Math.max(0, now - start) / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분`;
}
/** The clock refreshes independently of the input and record list. */
export function Elapsed({ startedAt }: { startedAt: string | undefined }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    const refresh = () => setNow(Date.now());
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const label = elapsedLabel(startedAt, now);
  return label ? <Caption secondary>경과 {label}</Caption> : null;
}
