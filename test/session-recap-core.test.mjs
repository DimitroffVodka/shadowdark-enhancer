import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCurrency, sumCoins, formatDuration, generateSessionName,
} from "../scripts/encounter/session-recap-core.mjs";

test("formatCurrency", () => {
  assert.equal(formatCurrency(0), "0cp");
  assert.equal(formatCurrency(123), "1gp 2sp 3cp");
  assert.equal(formatCurrency(50), "5sp");
  assert.equal(formatCurrency(-10), "0cp"); // clamped
});

test("sumCoins", () => {
  assert.equal(sumCoins([{ gp: 1 }, { sp: 5 }, { cp: 3 }]), "1gp 5sp 3cp");
  assert.equal(sumCoins([]), "0cp");
});

test("formatDuration", () => {
  assert.equal(formatDuration(0), "0m");
  assert.equal(formatDuration(-5), "0m");
  assert.equal(formatDuration(12_000), "12s");
  assert.equal(formatDuration(200_000), "3m 20s");
  assert.equal(formatDuration(3_900_000), "1h 5m");
});

test("generateSessionName disambiguates same-day duplicates", () => {
  const ts = new Date(2026, 6, 3).getTime(); // 2026-07-03 local
  assert.equal(generateSessionName(ts), "2026.07.03 Session");
  assert.equal(generateSessionName(ts, ["2026.07.03 Session"]), "2026.07.03 Session 2");
  assert.equal(
    generateSessionName(ts, ["2026.07.03 Session", "2026.07.03 Session 2"]),
    "2026.07.03 Session 3",
  );
});
