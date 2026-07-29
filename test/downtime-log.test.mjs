/**
 * Downtime log tests — the pure formatting/grouping layer.
 *
 * Covers the Session Recap headline row, the journal `<li>`, escaping, the
 * newest-first day grouping, and the Discord branch that consumes them.
 *
 * No book text, no Foundry globals. Timestamps are always supplied, so every
 * assertion is reproducible; the two date helpers are LOCAL by design, so they
 * are asserted against locally-derived expectations rather than a fixed string.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DAY_ATTR,
  buildPage,
  countRows,
  dayKey,
  daySection,
  insertRow,
  journalRow,
  normalizeEntry,
  recapRow,
  timeOfDay,
} from "../scripts/downtime/downtime-log-core.mjs";
import { DEFAULT_DATA, formatForDiscordFromData } from "../scripts/session-recap/session-recap-core.mjs";

/** A resolved attempt matching the frozen recordDowntime contract. */
function entry(over = {}) {
  return {
    actorId: "abc123",
    actorName: "Bazogo",
    player: "Dimi",
    sourceSlug: "western-reaches",
    slotKey: "d4-new-weapon",
    slotLabel: "New weapon (d6 max)",
    activityKey: "martialTraining",
    activityName: "Martial Training",
    total: 19,
    dc: 18,
    success: true,
    costGp: 50,
    effectSummary: "Bazogo is now trained with Longsword.",
    gmRolled: false,
    timestamp: "2026-07-28T19:05:00.000Z",
    ...over,
  };
}

/** Local day/time of an instant, computed the same way the helpers do. */
function localDay(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe("entry normalization", () => {
  test("a full entry round-trips its fields", () => {
    const e = normalizeEntry(entry());
    assert.equal(e.actorName, "Bazogo");
    assert.equal(e.total, 19);
    assert.equal(e.dc, 18);
    assert.equal(e.success, true);
    assert.equal(e.costGp, 50);
    assert.equal(e.gmRolled, false);
  });

  test("a hostile/empty entry degrades instead of throwing", () => {
    const e = normalizeEntry(undefined);
    assert.equal(e.actorName, "Someone");
    assert.equal(e.slotLabel, "Downtime activity");
    assert.equal(e.activityName, "Downtime");
    assert.equal(e.total, null);
    assert.equal(e.dc, null);
    assert.equal(e.costGp, 0);
    assert.equal(e.success, false);
    assert.equal(e.timestamp, null);
  });

  test("a negative or non-numeric cost never becomes a credit", () => {
    assert.equal(normalizeEntry(entry({ costGp: -50 })).costGp, 0);
    assert.equal(normalizeEntry(entry({ costGp: "nope" })).costGp, 0);
  });
});

describe("recap row", () => {
  test("matches the pinned format", () => {
    assert.equal(
      recapRow(entry()),
      "Bazogo — New weapon (d6 max): 19 vs DC 18, success, 50 gp",
    );
  });

  test("a failure with no fee drops the trailing parts", () => {
    assert.equal(
      recapRow(entry({ success: false, costGp: 0 })),
      "Bazogo — New weapon (d6 max): 19 vs DC 18, failure",
    );
  });

  test("a missing roll still reports the DC", () => {
    assert.equal(
      recapRow(entry({ total: null, costGp: 0 })),
      "Bazogo — New weapon (d6 max): DC 18, success",
    );
  });

  test("the effect summary is deliberately not folded into the headline", () => {
    assert.ok(!recapRow(entry()).includes("Longsword"));
  });
});

describe("journal row", () => {
  test("carries actor, activity, check, verdict, fee and effect", () => {
    const html = journalRow(entry());
    assert.match(html, /^<li>/);
    assert.match(html, /<\/li>$/);
    assert.ok(html.includes("Bazogo"));
    assert.ok(html.includes("Martial Training"));
    assert.ok(html.includes("19 vs DC 18"));
    assert.ok(html.includes("success"));
    assert.ok(html.includes("50 gp"));
    assert.ok(html.includes("<em>Bazogo is now trained with Longsword.</em>"));
  });

  test("a GM-rolled entry from a book is marked", () => {
    const html = journalRow(entry({ gmRolled: true }));
    assert.ok(html.includes("GM"));
    assert.ok(html.includes("western-reaches"));
  });

  test("every interpolated value is escaped", () => {
    const html = journalRow(entry({
      actorName: '<script>alert(1)</script>',
      effectSummary: 'trained with "Bastard & Sword"',
    }));
    assert.ok(!html.includes("<script>"), "actor name must not inject markup");
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("&quot;Bastard &amp; Sword&quot;"));
  });

  test("an entry with no timestamp still renders a row", () => {
    const html = journalRow(entry({ timestamp: null }));
    assert.match(html, /^<li>/);
    assert.equal(countRows(html), 1);
  });
});

describe("day helpers", () => {
  test("dayKey is a local YYYY-MM-DD", () => {
    const k = dayKey("2026-07-28T19:05:00.000Z");
    assert.match(k, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(k, localDay("2026-07-28T19:05:00.000Z"));
  });

  test("two instants a minute apart share a day", () => {
    assert.equal(dayKey("2026-07-28T19:05:00.000Z"), dayKey("2026-07-28T19:06:00.000Z"));
  });

  test("an unparseable timestamp yields null, not a crash", () => {
    assert.equal(dayKey("not-a-date"), null);
    assert.equal(dayKey(null), null);
    assert.equal(timeOfDay("not-a-date"), "");
  });

  test("timeOfDay is a local HH:MM", () => {
    assert.match(timeOfDay("2026-07-28T19:05:00.000Z"), /^\d{2}:\d{2}$/);
  });
});

describe("page assembly — newest first", () => {
  const DAY_A = "2026-07-27";
  const DAY_B = "2026-07-28";

  test("the first row creates its day section", () => {
    const html = insertRow("", DAY_B, "<li>one</li>");
    assert.ok(html.includes(`<h2 ${DAY_ATTR}="${DAY_B}">${DAY_B}</h2>`));
    assert.equal(countRows(html), 1);
  });

  test("a second row on the same day joins that section, newest first", () => {
    let html = insertRow("", DAY_B, "<li>older</li>");
    html = insertRow(html, DAY_B, "<li>newer</li>");
    assert.equal(countRows(html), 2);
    assert.equal((html.match(/<h2/g) ?? []).length, 1, "no duplicate day heading");
    assert.ok(html.indexOf("newer") < html.indexOf("older"), "newest row first");
  });

  test("a new day is prepended above the previous one", () => {
    let html = insertRow("", DAY_A, "<li>yesterday</li>");
    html = insertRow(html, DAY_B, "<li>today</li>");
    assert.ok(html.indexOf(DAY_B) < html.indexOf(DAY_A), "newest day first");
    assert.equal((html.match(/<h2/g) ?? []).length, 2);
    assert.equal(countRows(html), 2);
  });

  test("grouping keys on the data attribute, not the heading text", () => {
    // A GM re-labelled the heading by hand; the day must still be found.
    const relabelled = `<h2 ${DAY_ATTR}="${DAY_B}">Tuesday night</h2><ul><li>one</li></ul>`;
    const html = insertRow(relabelled, DAY_B, "<li>two</li>");
    assert.equal((html.match(/<h2/g) ?? []).length, 1);
    assert.equal(countRows(html), 2);
  });

  test("a hand-deleted list is rebuilt rather than losing the row", () => {
    const broken = `<h2 ${DAY_ATTR}="${DAY_B}">${DAY_B}</h2>`;
    const html = insertRow(broken, DAY_B, "<li>rescued</li>");
    assert.equal(countRows(html), 1);
    assert.ok(html.includes("<ul>"));
  });

  test("an entry with no day is dropped, leaving the page untouched", () => {
    const before = daySection(DAY_B, "<li>one</li>");
    assert.equal(insertRow(before, null, "<li>lost</li>"), before);
  });

  test("buildPage takes entries oldest-first and renders newest-first", () => {
    const html = buildPage([
      entry({ timestamp: "2026-07-26T10:00:00.000Z", actorName: "First" }),
      entry({ timestamp: "2026-07-28T10:00:00.000Z", actorName: "Last" }),
    ]);
    assert.equal(countRows(html), 2);
    assert.ok(html.indexOf("Last") < html.indexOf("First"));
  });

  test("existing hand-written prose above the log survives an append", () => {
    const withProse = insertRow("<p>Notes.</p>", DAY_B, "<li>one</li>");
    assert.ok(withProse.includes("<p>Notes.</p>"));
    assert.equal(countRows(withProse), 1);
  });
});

describe("discord export", () => {
  function dataWith(downtime) {
    return { ...structuredClone(DEFAULT_DATA), downtime };
  }

  test("a downtime section is emitted with rows, effect and a tally", () => {
    const md = formatForDiscordFromData(dataWith([
      { ...entry() },
      { ...entry({ success: false, costGp: 50, slotLabel: "Step up damage die", effectSummary: "" }) },
    ]), 0, 1000);
    assert.ok(md.includes("## Downtime"));
    assert.ok(md.includes("### Dimi"));
    assert.ok(md.includes("- Bazogo — New weapon (d6 max): 19 vs DC 18, success, 50 gp"));
    assert.ok(md.includes("  - *Bazogo is now trained with Longsword.*"));
    assert.ok(md.includes("**1/2 succeeded** · 100 gp spent"));
  });

  test("no downtime means no section", () => {
    assert.ok(!formatForDiscordFromData(dataWith([]), 0, 1000).includes("## Downtime"));
  });

  test("an archived payload with no downtime array does not crash", () => {
    const legacy = structuredClone(DEFAULT_DATA);
    delete legacy.downtime;
    assert.doesNotThrow(() => formatForDiscordFromData(legacy, 0, 1000));
  });

  test("downtime alone is enough to make a recap non-empty", () => {
    const md = formatForDiscordFromData(dataWith([entry()]), 0, 1000);
    assert.notEqual(md, "No session activity recorded.");
  });
});

describe("recap data shape", () => {
  test("DEFAULT_DATA carries a downtime array, like its siblings", () => {
    assert.ok(Array.isArray(DEFAULT_DATA.downtime));
    assert.equal(DEFAULT_DATA.downtime.length, 0);
  });
});
