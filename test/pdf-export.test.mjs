/**
 * PDF character-sheet export mapping (AI-Council correction #6 + #9).
 *
 * Covers actor→field mapping with mocked Shadowdark data-model getters:
 * abilities (with active effects), attacks (incl. the att.item fallback and
 * custom attack buckets), slots / free-carry, spells (tier/name order, lost
 * state, populated notes), overflow, XSS-inert notes, and template
 * field-contract consistency against the shipped field manifest.
 *
 * buildFieldValues sources everything from the model's own getters and the
 * derived document — deliberately NOT actor.sheet.getData() — so the mocks
 * mirror that contract. No pdf-lib / Foundry runtime is loaded.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFieldValues, exportActorToPdf, _internals } from "../scripts/pdf-export/pdf-sheet-export.mjs";

const MANIFEST = JSON.parse(fs.readFileSync(
  fileURLToPath(new URL("../assets/pdf/shadowdark-character-sheet-fields.json", import.meta.url)), "utf8"));
const MANIFEST_IDS = new Set(MANIFEST.fields.map((f) => f.id));

// ── shared Foundry-global stubs (buildFieldValues reads these at call time) ──
function installGlobals(uuidMap = {}) {
  const prev = {
    fromUuid: globalThis.fromUuid, fromUuidSync: globalThis.fromUuidSync, CONFIG: globalThis.CONFIG,
  };
  globalThis.fromUuid = async (u) => uuidMap[u] ?? null;
  globalThis.fromUuidSync = (u) => uuidMap[u] ?? null;
  globalThis.CONFIG = {
    SHADOWDARK: {
      RANGES: { near: "Near", close: "Close", self: "Self", far: "Far" },
      DURATION_TYPES: { focus: "Focus", instant: "Instant", days: "Days", rounds: "Rounds" },
    },
  };
  return () => Object.assign(globalThis, prev);
}

function ability(value, mod) { return { value, mod }; }

function makeActor(over = {}) {
  const classUuid = "Compendium.shadowdark.classes.Item.fighter";
  const uuidMap = {
    [classUuid]: { name: "Fighter", system: { spellcasting: { ability: "wis" }, hitPoints: "d8" } },
    ...(over.uuidMap ?? {}),
  };
  const sys = {
    level: { value: 3, xp: 12 },
    luck: over.luck ?? { available: false },
    class: classUuid,
    ancestry: "Dwarf",
    alignment: "lawful",
    background: "Soldier",
    deity: "Saint Terragnis",
    abilities: {
      str: ability(17, 3), dex: ability(12, 1), con: ability(13, 1),
      int: ability(8, -1), wis: ability(10, 0), cha: ability(9, -1),
    },
    attributes: { hp: { value: 20, max: 24 }, ac: { value: 15, tooltips: "10 + 3 leather + 2 shield" } },
    coins: { gp: 100, sp: 5, cp: 9 },
    slots: 17,
    notes: over.notes ?? "",
    getAttacks: async () => over.attacks ?? { melee: [], ranged: [] },
    getSlotUsage: async () => over.slotUsage ?? { total: 6 },
    getTitle: async () => over.title ?? "Warrior",
    getLanguageItems: async () => over.langItems ?? [{ name: "Common" }, { name: "Dwarvish" }],
    ...(over.sys ?? {}),
  };
  return { name: over.name ?? "Naugrim", system: sys, items: over.items ?? [], uuidMap };
}

test("core identity + abilities come from the derived model (active-effect values)", async () => {
  const actor = makeActor();
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text, checks } = await buildFieldValues(actor);
    assert.equal(text.name, "Naugrim");
    assert.equal(text.level, "3");
    assert.equal(text.xp, "12");
    assert.equal(text.xp_next, "30");
    assert.equal(text.class, "Fighter");         // from resolved class doc
    assert.equal(text.ancestry, "Dwarf");
    assert.equal(text.alignment, "Lawful");
    assert.equal(text.background, "Soldier");
    assert.equal(text.deity, "Saint Terragnis");
    assert.equal(text.title, "Warrior");
    assert.equal(text.str, "17");
    assert.equal(text.str_mod, "+3");            // ASI'd value + signed mod
    assert.equal(text.int_mod, "-1");
    assert.equal(text.hp, "20");
    assert.equal(text.hp_max, "24");
    assert.equal(text.ac, "15");
    assert.equal(text.gp, "100");
    assert.equal(text.luck, "");                 // no luck ⇒ blank numeric field
    assert.equal("luck" in checks, false);       // luck is a number field now, not a checkbox
    assert.equal(text.renown, "");               // no renown ⇒ blank numeric field
    assert.equal(text.languages, "Common, Dwarvish");
  } finally { restore(); }
});

test("luck renders as a number: base token ⇒ 1, pulp remaining ⇒ count, none ⇒ blank", async () => {
  const cases = [
    { luck: { available: true, remaining: 0 }, expected: "1" },   // base rule, has token
    { luck: { available: false, remaining: 0 }, expected: "" },   // base rule, spent ⇒ blank
    { luck: { available: true, remaining: 3 }, expected: "3" },   // pulp mode, 3 remaining
    { luck: { available: false, remaining: 0 }, expected: "" },   // pulp mode, none ⇒ blank
  ];
  for (const { luck, expected } of cases) {
    const actor = makeActor({ luck });
    const restore = installGlobals(actor.uuidMap);
    try {
      const { text, checks } = await buildFieldValues(actor);
      assert.equal(text.luck, expected);
      assert.equal("luck" in checks, false);
    } finally { restore(); }
  }
});

test("renown renders as a number: a value ⇒ the count, 0/unset ⇒ blank", async () => {
  const cases = [
    { renown: 4, expected: "4" },
    { renown: 0, expected: "" },     // 0 renown ⇒ blank, matching luck
    { renown: undefined, expected: "" },
  ];
  for (const { renown, expected } of cases) {
    const actor = makeActor({ sys: { renown } });
    const restore = installGlobals(actor.uuidMap);
    try {
      const { text } = await buildFieldValues(actor);
      assert.equal(text.renown, expected);
    } finally { restore(); }
  }
});

test("attacks: att.item fallback, UUID lookup, and custom buckets are all mapped", async () => {
  const weaponUuid = "Compendium.world.items.Item.longsword";
  const actor = makeActor({
    uuidMap: { [weaponUuid]: { name: "Longsword" } },
    attacks: {
      // 1) already-resolved item on the entry (no itemUuid) — the #9 fallback
      melee: [{ item: { name: "Razor Chain" }, mainRoll: { bonus: "4" }, damageRoll: { formula: "1d6 + 1" }, attack: { range: "near" } }],
      // 2) resolved via itemUuid
      ranged: [{ itemUuid: weaponUuid, mainRoll: { bonus: " + 2" }, damageRoll: { formula: "d8" }, range: "far" }],
      // 3) a CUSTOM bucket that must not be silently dropped
      unarmed: [{ name: "Fist", mainRoll: { bonus: "0" }, damageRoll: { formula: "1d1" } }],
    },
  });
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text } = await buildFieldValues(actor);
    assert.equal(text.attack_1_name, "Razor Chain");
    assert.equal(text.attack_1_bonus, "+4");
    assert.equal(text.attack_1_damage, "1d6+1");
    assert.equal(text.attack_1_range, "Near");
    assert.equal(text.attack_2_name, "Longsword");   // via fromUuidSync
    assert.equal(text.attack_2_bonus, "+2");
    assert.equal(text.attack_2_damage, "d8");
    assert.equal(text.attack_2_range, "Far");
    assert.equal(text.attack_3_name, "Fist");        // custom bucket kept
  } finally { restore(); }
});

test("slots + free-carry: getSlotUsage total, trinkets/0-slot to free box", async () => {
  const items = [
    { type: "Basic", name: "Rope", system: { quantity: 1, slots: { per_slot: 1, free_carry: 0, slots_used: 1 } } },
    { type: "Basic", name: "Torches", system: { quantity: 4, slots: { per_slot: 1, free_carry: 0, slots_used: 2 } } },
    { type: "Basic", name: "Lucky Trinket", system: { quantity: 1, slots: { per_slot: 1, free_carry: 0, slots_used: 1 } } },
    { type: "Basic", name: "Feather", system: { quantity: 1, slots: { per_slot: 1, free_carry: 0, slots_used: 0 } } },
    { type: "Basic", name: "Stashed Loot", system: { stashed: true, slots: { slots_used: 1 } } },
  ];
  const actor = makeActor({ items, slotUsage: { total: 9 } });
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text } = await buildFieldValues(actor);
    assert.equal(text.gear_slots_used, "9");     // model total wins over local sum
    assert.equal(text.gear_slots_max, "17");
    assert.equal(text.gear_1, "Rope");
    assert.equal(text.gear_2, "Torches (x4) — 8 slots");
    assert.equal(text.gear_3, undefined, "trinket/0-slot/stashed do not take gear lines");
    assert.match(text.free_carry, /Lucky Trinket/);
    assert.match(text.free_carry, /Feather/);
    assert.doesNotMatch(text.free_carry, /Stashed Loot/, "stashed excluded entirely");
  } finally { restore(); }
});

test("spells: tier-then-name order, lost state, populated safe-text notes", async () => {
  const items = [
    { type: "Spell", name: "Zephyr", system: { tier: 2, range: "far", duration: { type: "rounds", value: 5 }, lost: false, description: "<p>You conjure a strong wind.</p><p>It knocks foes prone.</p>" } },
    { type: "Spell", name: "Alarm", system: { tier: 1, range: "close", duration: { type: "focus", value: 1 }, lost: true, description: "<p>A ward that rings when crossed. Second sentence ignored.</p>" } },
    { type: "Spell", name: "Burn", system: { tier: 1, range: "near", duration: { type: "instant" }, lost: false, description: "" } },
  ];
  const actor = makeActor({ items });
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text, checks } = await buildFieldValues(actor);
    // sorted: tier 1 Alarm, tier 1 Burn, tier 2 Zephyr
    assert.equal(text.spell_1_name, "Alarm");
    assert.equal(text.spell_2_name, "Burn");
    assert.equal(text.spell_3_name, "Zephyr");
    assert.equal(text.spell_1_tier, "1");
    assert.equal(text.spell_1_range, "Close");
    assert.equal(text.spell_1_duration, "Focus");         // non-numeric duration = bare label
    assert.equal(text.spell_3_duration, "5 Rounds");
    assert.equal(checks.spell_1_lost, true);
    assert.equal(checks.spell_2_lost, false);
    // notes are safe plain text — first sentence, no HTML
    assert.equal(text.spell_1_notes, "A ward that rings when crossed.");
    assert.equal(text.spell_3_notes, "You conjure a strong wind.");
    assert.doesNotMatch(text.spell_1_notes, /[<>]/);
  } finally { restore(); }
});

test("overflow: extra attacks/spells summarised in notes, capped fields not exceeded", async () => {
  const melee = Array.from({ length: 7 }, (_, i) => ({ name: `Atk${i}`, mainRoll: { bonus: "0" }, damageRoll: { formula: "1d4" } }));
  const spells = Array.from({ length: 18 }, (_, i) => ({ type: "Spell", name: `Spell${String(i).padStart(2, "0")}`, system: { tier: 1, range: "self", duration: { type: "instant" }, lost: false, description: "desc." } }));
  const gear = Array.from({ length: 22 }, (_, i) => ({ type: "Basic", name: `Item${i}`, system: { quantity: 1, slots: { per_slot: 1, free_carry: 0, slots_used: 1 } } }));
  const actor = makeActor({ attacks: { melee, ranged: [] }, items: [...spells, ...gear] });
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text } = await buildFieldValues(actor);
    assert.equal(text.attack_5_name, "Atk4");
    assert.equal(text.attack_6_name, undefined, "only 5 attack rows on the sheet");
    assert.equal(text.spell_16_name !== undefined, true);
    assert.equal(text.spell_17_name, undefined, "only 16 spell rows on the sheet");
    assert.equal(text.gear_20 !== undefined, true);
    assert.equal(text.gear_21, undefined, "only 20 gear lines");
    assert.match(text.notes, /2 more attack/);
    assert.match(text.notes, /2 more spell/);
    assert.match(text.notes, /Gear overflow/);
  } finally { restore(); }
});

test("talents vs features split by talentClass: acquired on page 1, class/ancestry (with text) on page 2, no overlap", async () => {
  const items = [
    { type: "Talent", name: "Ambitious", system: { talentClass: "ancestry", description: "<p>One extra talent roll at 1st level.</p>" } },
    { type: "Talent", name: "Grit", system: { talentClass: "class", description: "<p>Reroll a failed check once per day.</p>" } },
    { type: "Talent", name: "+1 to Melee Attacks", system: { talentClass: "level", description: "" } },
    { type: "Talent", name: "Force Morale Check", system: { talentClass: "patronBoon", description: "<p>1/day, force a morale check.</p>" } },
    { type: "Talent", name: "Legacy Talent", system: { description: "<p>Old data, no talentClass.</p>" } },
  ];
  const actor = makeActor({ items });        // default ancestry Dwarf, class Fighter (hit die d8)
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text } = await buildFieldValues(actor);
    // page 1 — acquired talents only (level roll, patron boon, untagged legacy)
    assert.match(text.talents, /\+1 to Melee Attacks/);
    assert.match(text.talents, /Force Morale Check/);
    assert.match(text.talents, /Legacy Talent/);          // untagged ⇒ acquired bucket
    assert.doesNotMatch(text.talents, /Ambitious/);        // ancestry feature not here
    assert.doesNotMatch(text.talents, /Grit/);             // class feature not here
    // page 2 — class/ancestry features, grouped, WITH their descriptions
    assert.match(text.features, /ANCESTRY: Dwarf/);
    assert.match(text.features, /Ambitious — One extra talent roll at 1st level\./);
    assert.match(text.features, /CLASS: Fighter \(hit die d8\)/);
    assert.match(text.features, /Grit — Reroll a failed check once per day\./);
    assert.doesNotMatch(text.features, /Melee Attacks/);   // acquired talent not here
    assert.doesNotMatch(text.features, /Force Morale/);
  } finally { restore(); }
});

test("notes are XSS-inert: hostile bio HTML is reduced to plain text (no tags/handlers)", async () => {
  const actor = makeActor({ notes: `<img src=x onerror="alert(document.cookie)">hello<script>steal()</script>` });
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text } = await buildFieldValues(actor);
    assert.match(text.notes, /hello/);
    assert.doesNotMatch(text.notes, /<img/i);
    assert.doesNotMatch(text.notes, /onerror/i);
    assert.doesNotMatch(text.notes, /<script/i);
  } finally { restore(); }
});

test("htmlToText prefers an inert DOMParser when present (never innerHTML)", () => {
  let usedParser = false;
  const prev = globalThis.DOMParser;
  globalThis.DOMParser = class {
    parseFromString(html) {
      usedParser = true;
      // minimal inert stand-in: expose body.textContent as the de-tagged string
      const stripped = String(html).replace(/<[^>]*>/g, "");
      const nodeList = { forEach() {} };
      return { querySelectorAll: () => nodeList, body: { textContent: stripped } };
    }
  };
  try {
    const out = _internals.htmlToText(`<p>Hi <b>there</b></p>`);
    assert.equal(usedParser, true, "DOMParser.parseFromString was used");
    assert.equal(out, "Hi there");
  } finally { globalThis.DOMParser = prev; }
});

test("template field-contract: every produced id exists in the manifest; all 16 spell_notes fill", async () => {
  const spells = Array.from({ length: 16 }, (_, i) => ({ type: "Spell", name: `S${String(i).padStart(2, "0")}`, system: { tier: 1, range: "self", duration: { type: "instant" }, lost: false, description: "A short spell effect." } }));
  const actor = makeActor({
    attacks: { melee: [{ name: "Sword", mainRoll: { bonus: "1" }, damageRoll: { formula: "1d6" }, attack: { range: "near" } }], ranged: [] },
    items: [
      ...spells,
      { type: "Talent", name: "Grit", system: { talentClass: "class" } },
      { type: "Language", name: "Common" },
      { type: "Basic", name: "Rope", system: { quantity: 1, slots: { per_slot: 1, free_carry: 0, slots_used: 1 } } },
    ],
  });
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text, checks } = await buildFieldValues(actor);
    for (const id of [...Object.keys(text), ...Object.keys(checks)])
      assert.ok(MANIFEST_IDS.has(id), `produced field "${id}" is declared in the template manifest`);
    for (let r = 1; r <= 16; r++)
      assert.ok(text[`spell_${r}_notes`] && text[`spell_${r}_notes`].length > 0, `spell_${r}_notes populated`);
  } finally { restore(); }
});

/* --------------------------------------------------------------------- *
 * Insecure-origin fallback download lifecycle (issue #17).
 *
 * On an insecure HTTP origin showSaveFilePicker is unavailable, so
 * exportActorToPdf falls back first to a server upload (FilePicker.upload)
 * and then to an <a download href="blob:…"> click. The click hands the
 * download to the browser asynchronously: with "Ask where to save each
 * file" the save dialog can stay open for minutes and the blob is only read
 * once the user confirms. These tests pin the BLOB tier's bounded-lifetime
 * contract (the server tier has its own block below):
 *   - the blob URL is NOT revoked on a short timer (regression guard for
 *     the old 1s revokeObjectURL that killed the download mid-dialog), and
 *   - it IS eventually revoked — on pagehide, or by the generous fallback
 *     timer — so a GM exporting a party cannot accumulate every PDF in
 *     memory for the document's lifetime (the leak PR #18 introduced), and
 *   - the anchor keeps the correct `download` filename and stays in the DOM
 *     until release (browsers that re-consult the initiating element when
 *     the save dialog opens still find it).
 * --------------------------------------------------------------------- */

/** Stub everything the fallback path touches and capture the download
 * lifecycle: server-upload attempts, blob URLs created/revoked, the anchor,
 * window listeners, chat cards, and every timer scheduled while the stub is
 * active. By default FilePicker.upload is DENIED (returns false, exactly
 * what Foundry v14 does for a user without FILES_UPLOAD) so the blob tier
 * runs; pass `upload` to make the server tier succeed. */
function installExportHarness({ upload = async () => false, exportFolder = null, saveFilePicker = false, createDir = async () => {} } = {}) {
  const templateBytes = fs.readFileSync(fileURLToPath(
    new URL("../assets/pdf/shadowdark-character-sheet.pdf", import.meta.url)));
  const pdfLibUrl = new URL(
    "../scripts/pdf-export/lib/pdf-lib.esm.min.js", import.meta.url).href;
  const restoreActorGlobals = installGlobals(makeActor().uuidMap);

  const capture = {
    timers: [],          // { cb, delay, cleared } in scheduling order
    revokeCalls: [],     // blob URLs passed to URL.revokeObjectURL
    createdUrls: [],     // blob URLs returned by URL.createObjectURL
    listeners: {},       // window event name -> [handlers]
    anchor: null,        // the <a> handed to document.createElement
    appendedToBody: false,
    uploads: [],         // { source, dir, file } server-upload attempts
    createdDirs: [],     // FilePicker.createDirectory targets, in order
    chatMessages: [],    // ChatMessage.create payloads
    pickerOptions: null, // showSaveFilePicker options, when exercised
    warns: [],           // console.warn payloads while the harness is active
  };

  const prev = {
    foundry: globalThis.foundry,
    fetch: globalThis.fetch,
    window: globalThis.window,
    ui: globalThis.ui,
    document: globalThis.document,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    game: globalThis.game,
    FilePicker: globalThis.FilePicker,
    ChatMessage: globalThis.ChatMessage,
    consoleWarn: console.warn,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };

  globalThis.foundry = { utils: { getRoute: (path) => (
    path.endsWith("pdf-lib.esm.min.js") ? pdfLibUrl : "sde-template://character-sheet"
  ) } };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => templateBytes.buffer.slice(
      templateBytes.byteOffset,
      templateBytes.byteOffset + templateBytes.byteLength,
    ),
  });
  globalThis.window = {}; // insecure HTTP origin: no showSaveFilePicker
  if (saveFilePicker) {
    globalThis.window.showSaveFilePicker = async (options) => {
      capture.pickerOptions = options;
      return {
        createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      };
    };
  }
  globalThis.window.addEventListener = (type, fn) => {
    (capture.listeners[type] ??= []).push(fn);
  };
  globalThis.window.removeEventListener = (type, fn) => {
    capture.listeners[type] = (capture.listeners[type] ?? []).filter((f) => f !== fn);
  };
  globalThis.ui = { notifications: { info() {}, error(message) { throw new Error(message); } } };
  globalThis.game = {
    user: { id: "tester" },
    settings: {
      get: (_moduleId, key) => (key === "pdfExportFolder" ? exportFolder : null),
    },
    i18n: {
      localize: (k) => k,
      format: (k, data) => String(k).replace(/\{(\w+)\}/g, (_, n) => data[n]),
    },
  };
  globalThis.FilePicker = {
    createDirectory: async (source, target) => {
      capture.createdDirs.push(target);
      await createDir(source, target);
    },
    upload: async (source, dir, file) => {
      capture.uploads.push({ source, dir, file });
      return upload(source, dir, file);
    },
  };
  globalThis.ChatMessage = {
    getSpeaker: () => ({ id: "speaker" }),
    create: async (data) => { capture.chatMessages.push(data); return data; },
  };
  console.warn = (...args) => { capture.warns.push(args.map(String).join(" ")); };
  globalThis.document = {
    body: {
      appendChild(el) { el.isConnected = true; capture.appendedToBody = true; },
    },
    createElement(tag) {
      assert.equal(tag, "a", "the fallback downloads through an anchor");
      const anchor = {
        href: "", download: "", isConnected: false, removed: false,
        click() {}, // the real click is browser-side; nothing to observe here
        remove() { this.isConnected = false; this.removed = true; },
      };
      capture.anchor = anchor;
      return anchor;
    },
  };
  globalThis.setTimeout = (cb, delay) => {
    const t = { cb, delay, cleared: false };
    capture.timers.push(t);
    // pdf-lib's internals schedule 0-delay macrotasks while parsing the
    // template's fonts; run those on the real timer so loading completes.
    // Everything else (the release fallback, and any regressive short
    // revoke timer) is recorded but never executed — the tests drive it.
    if (delay === 0) prev.setTimeout(cb, 0);
    return t;
  };
  globalThis.clearTimeout = (t) => { t.cleared = true; };
  URL.createObjectURL = () => {
    const url = "blob:http://192.168.0.106:30000/generated-character-sheet";
    capture.createdUrls.push(url);
    return url;
  };
  URL.revokeObjectURL = (url) => capture.revokeCalls.push(url);

  return {
    capture,
    restore() {
      restoreActorGlobals();
      globalThis.foundry = prev.foundry;
      globalThis.fetch = prev.fetch;
      globalThis.window = prev.window;
      globalThis.ui = prev.ui;
      globalThis.document = prev.document;
      globalThis.setTimeout = prev.setTimeout;
      globalThis.clearTimeout = prev.clearTimeout;
      globalThis.game = prev.game;
      globalThis.FilePicker = prev.FilePicker;
      globalThis.ChatMessage = prev.ChatMessage;
      console.warn = prev.consoleWarn;
      URL.createObjectURL = prev.createObjectURL;
      URL.revokeObjectURL = prev.revokeObjectURL;
    },
  };
}

test("insecure-origin fallback: no short revoke timer; the blob is untouched right after export", async () => {
  const h = installExportHarness();
  try {
    await exportActorToPdf(makeActor());
    assert.equal(h.capture.revokeCalls.length, 0,
      "blob URL must not be revoked within a short window of the click");
    // Exactly one long-lived release path is scheduled: the generous
    // fallback. (pdf-lib's internal 0-delay macrotasks are recorded too, so
    // filter them out.)
    const release = h.capture.timers.filter((t) => t.delay >= 60 * 1000);
    assert.equal(release.length, 1, "exactly one release timer scheduled");
    assert.ok(release[0].delay >= 5 * 60 * 1000,
      `fallback is generous, not a 1s timer (got ${release[0].delay}ms)`);
    assert.equal(release[0].cleared, false);
    const short = h.capture.timers.filter((t) => t.delay > 0 && t.delay < 60 * 1000);
    assert.deepEqual(short.map((t) => t.delay), [],
      "no short revoke timer scheduled — the old 1s revokeObjectURL would show up here");
  } finally { h.restore(); }
});

test("pagehide releases the blob URL and removes the anchor", async () => {
  const h = installExportHarness();
  try {
    await exportActorToPdf(makeActor());
    const [url] = h.capture.createdUrls;
    assert.ok(url.startsWith("blob:"));
    assert.equal(h.capture.revokeCalls.length, 0, "blob is live while the dialog may be open");
    assert.equal(h.capture.listeners.pagehide.length, 1, "pagehide release registered");

    h.capture.listeners.pagehide[0](); // the document is going away

    assert.deepEqual(h.capture.revokeCalls, [url], "blob URL revoked on pagehide");
    assert.equal(h.capture.anchor.isConnected, false, "anchor removed once released");
    assert.equal(h.capture.anchor.removed, true);
    const release = h.capture.timers.find((t) => t.delay >= 60 * 1000);
    assert.equal(release.cleared, true, "fallback timer cancelled by pagehide");
    assert.equal(h.capture.listeners.pagehide.length, 0, "release unregistered itself");
  } finally { h.restore(); }
});

test("generous fallback timer releases the blob when pagehide never fires", async () => {
  const h = installExportHarness();
  try {
    await exportActorToPdf(makeActor());
    const [url] = h.capture.createdUrls;
    assert.equal(h.capture.revokeCalls.length, 0);
    const release = h.capture.timers.find((t) => t.delay >= 60 * 1000);

    release.cb(); // frozen tab: no pagehide, fallback fires

    assert.deepEqual(h.capture.revokeCalls, [url], "fallback timer revokes the blob");
    assert.equal(h.capture.anchor.isConnected, false, "anchor removed by the fallback too");
    assert.equal(h.capture.listeners.pagehide.length, 0, "release unregistered itself");

    release.cb(); // release is idempotent
    assert.equal(h.capture.revokeCalls.length, 1);
  } finally { h.restore(); }
});

test("anchor carries the correct download filename and stays in the DOM until release", async () => {
  const h = installExportHarness();
  try {
    await exportActorToPdf(makeActor()); // default actor name: Naugrim
    assert.equal(h.capture.anchor.download, "Naugrim - Shadowdark.pdf");
    assert.equal(h.capture.anchor.href, h.capture.createdUrls[0]);
    assert.equal(h.capture.appendedToBody, true, "anchor is in the document when clicked");
    assert.equal(h.capture.anchor.isConnected, true,
      "anchor stays in the DOM after the click — the save dialog can re-consult it");
    assert.equal(h.capture.anchor.removed, false);
    assert.equal(h.capture.revokeCalls.length, 0);
  } finally { h.restore(); }
});

/* --------------------------------------------------------------------- *
 * Server-upload tier (issue #17 follow-up).
 *
 * The blob anchor is the LAST resort. Before it, exportActorToPdf tries
 * Foundry's own server upload (FilePicker.upload — an ordinary HTTP POST
 * that needs no secure context, so it works on plain-HTTP origins):
 *   - tier 2 runs when showSaveFilePicker is absent, and its success means
 *     NO blob URL is ever created,
 *   - the upload carries a TIMESTAMPED filename (v14 cannot overwrite a
 *     non-media file, so a stable name would fail on the second export)
 *     into the configured folder,
 *   - when the upload is denied (FilePicker.upload returns false for a user
 *     without FILES_UPLOAD — verified v14 behaviour), tier 3 takes over,
 *   - tiers 1 and 3 keep the clean undated `<Name> - Shadowdark.pdf`.
 * --------------------------------------------------------------------- */

const STAMPED_NAME = /^Naugrim - \d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}\.pdf$/;

test("server-upload tier is used when showSaveFilePicker is absent, with a download card", async () => {
  const h = installExportHarness({
    // Echo the real uploaded name back as the served path, like Foundry does.
    upload: async (_s, _d, file) => ({ path: `assets/shadowdark-enhancer/exports/${encodeURIComponent(file.name)}` }),
  });
  try {
    await exportActorToPdf(makeActor());
    assert.equal(h.capture.uploads.length, 1, "server upload attempted");
    assert.deepEqual(h.capture.createdDirs,
      ["assets", "assets/shadowdark-enhancer", "assets/shadowdark-enhancer/exports"],
      "export folder ensured one segment at a time before uploading");
    assert.equal(h.capture.createdUrls.length, 0,
      "no blob URL created — the server tier succeeded");
    assert.equal(h.capture.chatMessages.length, 1, "save card posted");
    const card = h.capture.chatMessages[0];
    assert.match(card.content,
      /href="assets\/shadowdark-enhancer\/exports\/Naugrim%20-%20\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}\.pdf"/,
      "card links the same-origin file (timestamped upload name)");
    assert.match(card.content, /download="Naugrim - \d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}\.pdf"/,
      "link downloads with the timestamped filename");
    assert.deepEqual(card.whisper, ["tester"], "card whispered to the exporter");
  } finally { h.restore(); }
});

test("server upload receives a timestamped filename in the configured folder", async () => {
  const h = installExportHarness({
    exportFolder: "assets/custom-exports",
    upload: async (_s, _d, file) => ({ path: `assets/custom-exports/${encodeURIComponent(file.name)}` }),
  });
  try {
    await exportActorToPdf(makeActor()); // default actor name: Naugrim
    assert.equal(h.capture.uploads.length, 1);
    const { source, dir, file } = h.capture.uploads[0];
    assert.equal(source, "data");
    assert.equal(dir, "assets/custom-exports", "folder comes from the world setting");
    assert.match(file.name, STAMPED_NAME, `upload name is timestamped, got "${file.name}"`);
    assert.equal(file.type, "application/pdf");
    assert.ok(file.size > 1000, "carries the generated PDF bytes");
  } finally { h.restore(); }
});

test("tier 2 uploads are unique across two exports of the same actor", async () => {
  const h = installExportHarness({
    upload: async (_s, _d, file) => ({ path: `assets/shadowdark-enhancer/exports/${encodeURIComponent(file.name)}` }),
  });
  try {
    await exportActorToPdf(makeActor());
    await exportActorToPdf(makeActor());
    assert.equal(h.capture.uploads.length, 2);
    const names = h.capture.uploads.map((u) => u.file.name);
    for (const n of names)
      assert.match(n, STAMPED_NAME, `upload name is timestamped, got "${n}"`);
    assert.notEqual(names[0], names[1],
      "two exports of the same actor never collide on the server");
  } finally { h.restore(); }
});

test("stampFilename: sortable, colon-free, millisecond precision, deterministic on the date", () => {
  const { stampFilename } = _internals;
  const d = new Date(2026, 7, 4, 14, 37, 12, 123); // 2026-08-04 14:37:12.123
  assert.equal(stampFilename("Naugrim", d), "Naugrim - 2026-08-04_14-37-12-123.pdf");
  // single-digit components are zero-padded
  const early = new Date(2026, 0, 5, 9, 7, 3, 9);
  assert.equal(stampFilename("Bazogo", early), "Bazogo - 2026-01-05_09-07-03-009.pdf");
  // same date -> same name; 1 ms apart -> different (uniqueness, no wall clock)
  assert.equal(stampFilename("Naugrim", d), stampFilename("Naugrim", new Date(d.getTime())));
  assert.notEqual(stampFilename("Naugrim", d), stampFilename("Naugrim", new Date(d.getTime() + 1)));
  assert.match(stampFilename("Naugrim", d), /^Naugrim - \d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}\.pdf$/);
  assert.doesNotMatch(stampFilename("Naugrim", d), /:/, "colon-free for Windows filenames");
});

test("tier 1 save picker keeps the clean, undated filename", async () => {
  const h = installExportHarness({ saveFilePicker: true });
  try {
    await exportActorToPdf(makeActor());
    assert.equal(h.capture.pickerOptions.suggestedName, "Naugrim - Shadowdark.pdf",
      "native save dialog proposes the clean name, not a timestamped one");
    assert.equal(h.capture.uploads.length, 0, "picker path returns without uploading");
    assert.equal(h.capture.createdUrls.length, 0, "picker path returns without a blob");
  } finally { h.restore(); }
});

/* --------------------------------------------------------------------- *
 * Export-folder directory walk (issue #17, third round).
 *
 * v14's FilePicker.createDirectory is NON-RECURSIVE and rejects when the
 * parent is missing — a single call for "assets/shadowdark-enhancer/exports"
 * dies with ENOENT unless "assets/shadowdark-enhancer" already exists. That
 * is why tier 2 silently fell through to the browser download on every
 * fresh install. These tests pin the per-segment walk and the narrowed
 * swallow.
 * --------------------------------------------------------------------- */

test("multi-segment export folder is ensured one segment at a time, in order", async () => {
  const h = installExportHarness({
    exportFolder: "assets/shadowdark-enhancer/exports",
    upload: async (_s, _d, file) => ({ path: `assets/shadowdark-enhancer/exports/${encodeURIComponent(file.name)}` }),
  });
  try {
    await exportActorToPdf(makeActor());
    assert.deepEqual(h.capture.createdDirs,
      ["assets", "assets/shadowdark-enhancer", "assets/shadowdark-enhancer/exports"],
      "every path segment is created in order — a single leaf-only call fails on a bare Data/");
    assert.equal(h.capture.uploads.length, 1, "upload still attempted after the dirs are ensured");
  } finally { h.restore(); }
});

test("createDirectory failures: EEXIST and permission denials stay silent, unexpected ones are logged", async () => {
  const h = installExportHarness({
    exportFolder: "assets/deep/nested/exports",
    createDir: async (_s, target) => {
      // EEXIST = already exists — the common case, must stay silent.
      if (target === "assets/deep/nested") throw new Error("EEXIST: file already exists, mkdir '...'");
      // A non-admin denial — the designed fall-to-tier-3 path, also silent.
      if (target === "assets/deep/nested/exports") throw new Error("You may not create directories in this location");
      // A missing parent mid-walk is a real problem — must be logged.
      if (target === "assets/deep") throw new Error("ENOENT: no such file or directory, mkdir '...'");
    },
    upload: async (_s, _d, file) => ({ path: `assets/deep/nested/exports/${encodeURIComponent(file.name)}` }),
  });
  try {
    await exportActorToPdf(makeActor());
    assert.deepEqual(h.capture.createdDirs,
      ["assets", "assets/deep", "assets/deep/nested", "assets/deep/nested/exports"],
      "every segment is still attempted even when earlier ones fail");
    assert.equal(h.capture.warns.length, 1, "only the genuinely unexpected ENOENT is logged");
    assert.match(h.capture.warns[0], /assets\/deep/, "the warning names the failing segment");
    assert.doesNotMatch(h.capture.warns[0], /EEXIST|may not create directories/);
    assert.equal(h.capture.uploads.length, 1, "the upload still runs — its result, not the dir walk, decides success");
  } finally { h.restore(); }
});

test("blob tier is the last resort when the server upload is denied (no FILES_UPLOAD)", async () => {
  const h = installExportHarness(); // default: FilePicker.upload → false
  try {
    await exportActorToPdf(makeActor());
    assert.equal(h.capture.uploads.length, 1, "server upload attempted first");
    assert.equal(h.capture.createdUrls.length, 1, "fell through to the blob download");
    assert.equal(h.capture.anchor.download, "Naugrim - Shadowdark.pdf");
    assert.equal(h.capture.anchor.isConnected, true, "blob anchor kept in the DOM");
    assert.equal(h.capture.chatMessages.length, 0, "no save card when the upload failed");
  } finally { h.restore(); }
});
