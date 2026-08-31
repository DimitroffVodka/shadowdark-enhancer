/**
 * Shadowdark Enhancer — Forge & Loot seeded randomness (G4).
 *
 * This utility is Foundry-free and intentionally tiny. A generator receives a
 * plain `rng()` function from the preview controller; future resolvers can
 * accept that function as a parameter without importing this module or any
 * other G4 code.
 */

/** @typedef {() => number} SeededRng A deterministic function returning [0, 1). */

const DEFAULT_SEED = "forge-loot-seed";

function normalizedSeed(seed) {
  if (seed === null || seed === undefined || String(seed).trim() === "") return DEFAULT_SEED;
  return String(seed).trim();
}

function seedHash(seed) {
  let hash = 0x811c9dc5;
  for (const character of normalizedSeed(seed)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Create a deterministic mulberry32-style PRNG from a textual seed.
 *
 * A fresh function owns a private uint32 state. Calling it advances only that
 * state and returns a number in [0, 1); no wall clock, global randomness, or
 * Foundry roll is consulted.
 *
 * @param {string} seed
 * @returns {SeededRng}
 */
export function createSeededRng(seed) {
  let state = seedHash(seed);
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

/**
 * Choose an integer from [0, maxExclusive) with an injected seeded RNG.
 *
 * @param {SeededRng} rng
 * @param {number} maxExclusive
 * @returns {number}
 */
export function randomInt(rng, maxExclusive) {
  if (typeof rng !== "function") throw new TypeError("randomInt requires a seeded rng function.");
  const max = Math.floor(Number(maxExclusive));
  if (!Number.isFinite(max) || max <= 0) return 0;
  const sample = Number(rng());
  if (!Number.isFinite(sample)) return 0;
  return Math.max(0, Math.min(max - 1, Math.floor(sample * max)));
}

/**
 * Select one entry from a materialized snapshot using only the injected RNG.
 * No RollTable method is called, so preview stays silent and deterministic.
 *
 * @template T
 * @param {SeededRng} rng
 * @param {Array<T>} values
 * @returns {T|undefined}
 */
export function pickSeeded(rng, values) {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  return values[randomInt(rng, values.length)];
}

export const seededRng = createSeededRng;
export const seededPick = pickSeeded;
