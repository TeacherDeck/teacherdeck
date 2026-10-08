// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Synthetic test data generator (PRV-004). Produces obviously fictional values only:
// folk-tale names, "○○" school names and 010-0000-XXXX phone numbers.
// Usage: node fixtures/synthetic/generate.ts [count] [seed]  → prints a roster as JSON.

/** Characters from Korean folk tales; nobody mistakes these for real students. */
export const FICTIONAL_NAMES = [
  "홍길동", "임꺽정", "성춘향", "이몽룡", "심청", "흥부", "놀부", "콩쥐", "팥쥐", "전우치",
  "장화", "홍련", "견우", "직녀", "해님", "달님", "선녀", "나무꾼", "토끼", "자라",
] as const;

export const FICTIONAL_SCHOOLS = ["○○초등학교", "○○중학교", "○○고등학교", "가상초등학교", "가상중학교"] as const;

export interface SyntheticStudent {
  number: number;
  name: string;
  phone: string;
}

export interface SyntheticRoster {
  school: string;
  grade: number;
  classNo: number;
  students: SyntheticStudent[];
}

/** Deterministic PRNG (mulberry32) so fixtures are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], next: () => number): T {
  const item = items[Math.floor(next() * items.length)];
  if (item === undefined) throw new Error("empty list");
  return item;
}

/** Phone numbers in the reserved-looking 010-0000-XXXX range. */
export function fictionalPhone(n: number): string {
  return `010-0000-${String(n % 10000).padStart(4, "0")}`;
}

export function syntheticRoster(count: number, seed = 1): SyntheticRoster {
  const next = rng(seed);
  const students = Array.from({ length: count }, (_, i) => {
    // Repeat names get a numeric suffix (홍길동2) so every entry stays visibly fictional and unique.
    const base = FICTIONAL_NAMES[i % FICTIONAL_NAMES.length] ?? "홍길동";
    const round = Math.floor(i / FICTIONAL_NAMES.length);
    return { number: i + 1, name: round === 0 ? base : `${base}${round + 1}`, phone: fictionalPhone(i + 1) };
  });
  return { school: pick(FICTIONAL_SCHOOLS, next), grade: 1 + Math.floor(next() * 6), classNo: 1 + Math.floor(next() * 10), students };
}

if (import.meta.main === true) {
  const count = Number(process.argv[2] ?? "25");
  const seed = Number(process.argv[3] ?? "1");
  process.stdout.write(`${JSON.stringify(syntheticRoster(count, seed), null, 2)}\n`);
}
