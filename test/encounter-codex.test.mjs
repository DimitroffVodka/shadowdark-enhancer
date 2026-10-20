// The Encounters Met codex writer, driven against a stub journal: one line for a post and then its
// battle, a region page and an Elsewhere page, no tags or private rolls on the page, and one writer
// (the active GM) for two GMs showing encounters at once.
import test from "node:test";
import assert from "node:assert/strict";

const M = "shadowdark-enhancer";
let holdMs = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2);
const journal = [];
const mkPage = (d) => { const p = { id: rid(), ...d, flags: structuredClone(d.flags ?? {}) }; p.getFlag = (s, k) => p.flags?.[s]?.[k]; return p; };
const mkEntry = (d) => {
  const e = { ...d, id: rid(), flags: structuredClone(d.flags ?? {}), pages: [] };
  e.getFlag = (s, k) => e.flags?.[s]?.[k];
  e.createEmbeddedDocuments = async (_t, rows) => { await wait(holdMs); for (const r of rows) e.pages.push(mkPage(r)); return rows; };
  e.updateEmbeddedDocuments = async (_t, rows) => {
    await wait(holdMs);
    for (const r of rows) {
      const p = e.pages.find((x) => x.id === r._id);
      for (const [k, v] of Object.entries(r)) {
        if (k.startsWith("flags.")) { const [, s, f] = k.split("."); p.flags[s] ??= {}; p.flags[s][f] = structuredClone(v); }
        else if (k === "text.content") p.text = { content: v };
      }
    }
    return rows;
  };
  return e;
};
const GM = { id: "gm1", isGM: true };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 }, SORT_INTEGER_DENSITY: 100000 };
globalThis.JournalEntry = { create: async (d) => { await wait(holdMs); const e = mkEntry(d); journal.push(e); return e; } };
globalThis.CONFIG = { queries: {} };
const cal = {
  timeToComponents: (t) => ({ dayOfWeek: 0, dayOfMonth: 0, month: 0, year: 1, hour: Math.floor(t / 3600) % 24, minute: Math.floor(t / 60) % 60, second: t % 60 }),
  days: { values: [{ name: "Mon" }] }, months: { values: [{ name: "Jan" }] },
};
globalThis.game = {
  user: GM, journal, time: { worldTime: 36000, calendar: cal }, users: { activeGM: GM },
  i18n: { localize: (k) => k, format: (k, d) => `${k}${JSON.stringify(d ?? {})}` }, settings: { get: () => false },
};
const { game, CONFIG } = globalThis;
globalThis.foundry = { utils: { randomID: rid } };

const codex = await import("../scripts/encounter/encounter-codex.mjs");
codex.registerCodex();
const lines = () => journal.flatMap((e) => e.pages.flatMap((p) => (p.flags[M]?.encounterCodexPage?.entries ?? []).map((x) => ({ page: p.name, ...x }))));
const reset = () => { journal.length = 0; holdMs = 0; game.time.worldTime = 36000; game.user = GM; game.users.activeGM = GM; };
const wolf = { id: "d1", kind: "monster", uuid: "Actor.w", name: "Wolf", img: "w.webp", count: 3, distanceRoll: 2, activityRoll: 7, reactionRoll: 8 };

test("a post and then its battle, a minute of world time later, are one line", async () => {
  reset();
  await codex.recordEncounter(wolf);
  game.time.worldTime += 75;
  await codex.recordEncounter({ id: "d1", name: "Wolf", uuid: "Actor.w", count: 3 }, { facets: false });
  assert.equal(lines().length, 1);
  assert.equal(lines()[0].page, "SDE.codex.general");
  assert.ok(lines()[0].facets, "the posted card's facets stay");
  await codex.recordEncounter(wolf);
  assert.equal(lines().length, 1, "a re-post of the same id is a no-op");
});

test("a fight brought straight to the table keeps the GM's private rolls off the page", async () => {
  reset();
  await codex.recordEncounter(wolf, { facets: false });
  assert.equal(lines()[0].facets, null);
});

test("a non-GM writes nothing", async () => {
  reset();
  game.user = { id: "p1", isGM: false };
  assert.equal(await codex.recordEncounter(wolf), null);
  assert.equal(journal.length, 0);
});

test("row HTML is stripped before it is stored", async () => {
  reset();
  await codex.recordEncounter({ id: "f1", kind: "flavor", text: "<b>Collapse!</b> The roof falls." });
  assert.equal(lines()[0].text, "Collapse! The roof falls.");
  assert.ok(!journal[0].pages[0].text.content.includes("&lt;b"));
});

test("off travel, with no hex map, an encounter goes to the Elsewhere page", async () => {
  reset();
  await codex.recordEncounter({ ...wolf, id: "e1" });
  assert.equal(lines()[0].region, null);
  assert.equal(lines()[0].page, "SDE.codex.general");
});

test("a second GM's line is relayed to the active GM: one journal, no line lost", async () => {
  reset();
  holdMs = 30;
  const B = { id: "gm2", isGM: true };
  const sent = [];
  // GM B's client is not the active GM; the query runs the handler as the active GM's client would.
  game.user = B;
  game.users.activeGM = {
    id: "gm1",
    query: (name, data) => {
      sent.push(name);
      game.user = GM;   // only while the handler starts: it checks and queues synchronously
      try { return CONFIG.queries[name](data, { user: B }); } finally { game.user = B; }
    },
  };
  game.user.hasPermission = () => true;
  const a = codex.recordEncounter({ ...wolf, id: "r1", name: "Orc" });
  const b = codex.recordEncounter({ ...wolf, id: "r2", name: "Ogre" });
  await Promise.all([a, b]);
  assert.equal(sent.length, 2);
  assert.equal(journal.length, 1);
  assert.deepEqual(lines().map((l) => l.name).sort(), ["Ogre", "Orc"]);
});

test("the codex query refuses a non-GM sender", async () => {
  reset();
  const out = await codex.handleCodexQuery({ key: "x", at: 1, kind: "flavor", text: "t" }, { id: "p1", isGM: false });
  assert.equal(out.ok, false);
  assert.equal(journal.length, 0);
});
