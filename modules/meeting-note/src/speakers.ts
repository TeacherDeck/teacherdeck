// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Meeting } from "./meeting.ts";
/** Stable ids keep identically named people separate; older backups retain their known names. */
export function identifySpeakers(meeting: Meeting): Meeting {
  const speakers = [...meeting.speakers];
  const speakerIds = meeting.speakerIds ? [...meeting.speakerIds] : speakers.map(() => crypto.randomUUID());
  for (const entry of meeting.entries) {
    if (entry.speaker && !speakers.includes(entry.speaker)) {
      if (speakers.length >= 24) throw new Error("SPEAKER_LIMIT");
      speakers.push(entry.speaker);
      speakerIds.push(crypto.randomUUID());
    }
  }
  const entries = meeting.entries.map((entry) => ({
    ...entry,
    speakerId:
      entry.speakerId && speakerIds.includes(entry.speakerId)
        ? entry.speakerId
        : (speakerIds[speakers.indexOf(entry.speaker)] ?? ""),
  }));
  return {
    ...meeting,
    speakers,
    speakerIds,
    activeSpeakerCount: meeting.activeSpeakerCount ?? Math.min(12, meeting.speakers.length),
    entries,
    selectedId:
      meeting.selectedId === "" || speakerIds.includes(meeting.selectedId ?? "")
        ? (meeting.selectedId ?? "")
        : (speakerIds[speakers.indexOf(meeting.selected)] ?? ""),
  };
}
export function reviseSpeakers(meeting: Meeting, names: string[]): Meeting {
  if (!names.length || names.length > 12 || names.some((name) => !name.trim())) throw new Error("SPEAKER_LIMIT");
  const old = identifySpeakers(meeting);
  const used = new Set<string>();
  const speakers = [...names];
  const speakerIds = names.map((name) => {
    const index = old.speakers.findIndex(
      (candidate, at) => candidate === name && !used.has(old.speakerIds?.[at] ?? ""),
    );
    const id = old.speakerIds?.[index] ?? crypto.randomUUID();
    used.add(id);
    return id;
  });
  old.speakers.forEach((name, index) => {
    const id = old.speakerIds?.[index] ?? "";
    if (!used.has(id) && old.entries.some((entry) => entry.speakerId === id)) {
      speakers.push(name);
      speakerIds.push(id);
    }
  });
  if (speakers.length > 24) throw new Error("SPEAKER_LIMIT");
  const selectedId =
    old.speakers.length === 0
      ? (speakerIds[0] ?? "")
      : old.selectedId === ""
        ? ""
        : speakerIds.slice(0, names.length).includes(old.selectedId ?? "")
          ? (old.selectedId ?? "")
          : (speakerIds[0] ?? "");
  return {
    ...old,
    speakers,
    speakerIds,
    activeSpeakerCount: names.length,
    selectedId,
    selected: speakers[speakerIds.indexOf(selectedId)] ?? "",
  };
}
export function speakerLabel(meeting: Meeting, index: number): string {
  const name = meeting.speakers[index] ?? "";
  return meeting.speakers.filter((candidate) => candidate === name).length > 1 ? `${name} (${index + 1}번)` : name;
}

/** Recorded former participants stay in the archive but do not reclaim active shortcut slots. */
export function activeSpeakers(meeting: Meeting): string[] {
  return meeting.speakers.slice(0, meeting.activeSpeakerCount ?? Math.min(12, meeting.speakers.length));
}
