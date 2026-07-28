/**
 * Contract: every PDF grab that can split columns must surface the split's
 * warnings.
 *
 * `extractPdfText` reports a column cut it isn't sure about (see gutterRisks),
 * but a warning nobody displays is the same silence the detection exists to
 * break — a bled word still reaches the preview looking clean. PR review found
 * three paths keeping only `.text`, and a per-FILE check would have missed the
 * spell one, because that file already notified from a different method. So
 * this checks the enclosing FUNCTION of each call.
 *
 * Exempt, deliberately:
 *  - calls pinned to "1" or "layout" — those never detect a gutter, so they
 *    can never warn;
 *  - `{ pages: [1] }` probes that only read `numPages` and discard the text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const FILES = execFileSync("git", ["ls-files", "scripts/**/*.mjs"], { encoding: "utf8" })
  .split("\n").filter(Boolean);

/** Brace-matched span starting at the `{` at or after `from`, else null. */
function braceSpan(src, from) {
  const start = src.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return { start, end: i + 1 };
  }
  return null;
}

/** Control-flow headers look like calls but are not functions. */
const NOT_A_FUNCTION = /^(if|for|while|switch|catch|do|return|typeof|await)$/;

/**
 * Source of the innermost FUNCTION containing `idx`.
 *
 * Must be the innermost *function* — taking the nearest preceding header
 * instead lands on an inner `if (…) {` or `catch (…) {`, whose span ends
 * before the notify call and reports every correct site as broken.
 */
function enclosingFunction(src, idx) {
  const head = /(?:^|\n)\s*(?:(?:async|static)\s+)*(?:function\s+)?([_a-zA-Z$][\w$]*)\s*\([^()]*\)\s*\{/g;
  let best = null;
  for (let m; (m = head.exec(src)) !== null;) {
    if (m.index > idx) break;
    if (NOT_A_FUNCTION.test(m[1])) continue;
    const span = braceSpan(src, m.index + m[0].length - 1);
    if (!span || span.start > idx || span.end < idx) continue;
    if (!best || span.end - span.start < best.end - best.start) best = span;
  }
  return best ? src.slice(best.start, best.end) : src;
}

/** Every extractPdfText call that could produce a column-split warning. */
function splittingCalls(src) {
  const out = [];
  const re = /extractPdfText\(/g;
  for (let m; (m = re.exec(src)) !== null;) {
    // The call's own argument text, up to the end of that line.
    const line = src.slice(m.index, src.indexOf("\n", m.index));
    if (/columns:\s*"(1|layout)"/.test(line)) continue;          // never splits
    if (/pages:\s*\[1\]\s*\}/.test(line) && !/columns/.test(line)) continue;  // page-count probe
    out.push(m.index);
  }
  return out;
}

test("every column-splitting PDF grab surfaces its gutter warnings", () => {
  const offenders = [];
  for (const file of FILES) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("extractPdfText(")) continue;
    if (file.endsWith("pdf-text-extract.mjs")) continue;         // the source of truth itself
    for (const idx of splittingCalls(src)) {
      const fn = enclosingFunction(src, idx);
      if (!fn.includes("notifyGutterWarnings")) {
        offenders.push(`${file}:${src.slice(0, idx).split("\n").length}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `these grabs can split columns but never show the warning:\n  ${offenders.join("\n  ")}`);
});

test("the contract test actually detects a dropped warning", () => {
  // Guards the checker itself: a call whose function keeps only .text must be
  // reported. Without this, a broken matcher would pass everything silently —
  // the same failure mode the test exists to prevent.
  const bad = `
    async _grab(file) {
      const { text } = await extractPdfText(file, { pages: p, columns: "auto" });
      return text;
    }
  `;
  assert.equal(splittingCalls(bad).length, 1);
  assert.ok(!enclosingFunction(bad, bad.indexOf("extractPdfText(")).includes("notifyGutterWarnings"));

  const good = bad.replace("return text;", "notifyGutterWarnings(r); return text;");
  assert.ok(enclosingFunction(good, good.indexOf("extractPdfText(")).includes("notifyGutterWarnings"));
});

test("pinned and probe calls are exempt", () => {
  assert.equal(splittingCalls(`extractPdfText(f, { pages: p, columns: "layout" });`).length, 0);
  assert.equal(splittingCalls(`extractPdfText(f, { pages: p, columns: "1" });`).length, 0);
  assert.equal(splittingCalls(`extractPdfText(f, { pages: [1] });`).length, 0);
  // ...but "auto", "2" and "2mid" are not exempt.
  assert.equal(splittingCalls(`extractPdfText(f, { pages: p, columns: "auto" });`).length, 1);
  assert.equal(splittingCalls(`extractPdfText(f, { pages: p, columns: "2mid" });`).length, 1);
  assert.equal(splittingCalls(`extractPdfText(f, { pages: p, columns: c });`).length, 1);
});
