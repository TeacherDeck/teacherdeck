// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Time-up chime synthesized with Web Audio: no sound files, nothing leaves the PC (MOD-008).
// The note schedule is pure so it can be unit-tested (MOD-015); playChime only wires it up.

export interface Note {
  /** Hz. */
  freq: number;
  /** Seconds from the start of the chime. */
  at: number;
  /** Seconds until the note has faded out. */
  length: number;
}

/** C6 – E6 – G6 arpeggio, rung `rings` times with a pause in between. */
export function chimeNotes(rings = 3): Note[] {
  const ARPEGGIO = [1046.5, 1318.5, 1568];
  const NOTE_GAP = 0.16;
  const RING_GAP = 1.2;
  const notes: Note[] = [];
  for (let r = 0; r < rings; r++) {
    ARPEGGIO.forEach((freq, i) => notes.push({ freq, at: r * RING_GAP + i * NOTE_GAP, length: 0.9 }));
  }
  return notes;
}

export interface Chime {
  stop: () => void;
}

export const SILENT: Chime = { stop: () => undefined };

/**
 * Plays the chime on `ctx`. Browsers only let audio start after a user gesture, so the caller
 * creates (or resumes) the context when the timer is started and reuses it here.
 */
export function playChime(ctx: AudioContext, notes: Note[] = chimeNotes()): Chime {
  const out = ctx.createGain();
  out.gain.value = 0.25;
  out.connect(ctx.destination);
  const start = ctx.currentTime + 0.02;
  for (const n of notes) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = n.freq;
    // Quick attack, bell-like exponential decay.
    env.gain.setValueAtTime(0.0001, start + n.at);
    env.gain.exponentialRampToValueAtTime(1, start + n.at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, start + n.at + n.length);
    osc.connect(env).connect(out);
    osc.start(start + n.at);
    osc.stop(start + n.at + n.length + 0.05);
  }
  return {
    stop: () => {
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setValueAtTime(0, ctx.currentTime);
      out.disconnect();
    },
  };
}

/** An AudioContext, or null where Web Audio is unavailable (tests, locked-down browsers). */
export function createAudio(): AudioContext | null {
  return typeof AudioContext === "undefined" ? null : new AudioContext();
}
