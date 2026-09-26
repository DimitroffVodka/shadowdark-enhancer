// encounter.check's options (#232): Overland's travel checks pass their own
// chance, the travel hex, a label for the card and one for the recap. With no
// options it stays the crawl's check. Only misses are rolled here, so no
// table lookup or roller runs.
import test from "node:test";
import assert from "node:assert/strict";

const cards = [];
const renderTemplate = async (path, data) => { cards.push(data); return "<div>card</div>"; };
const deep = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "prototype" ? {} : k === "renderTemplate" ? renderTemplate : deep),
  construct: () => deep, apply: () => deep,
});
const dice = [];
Object.assign(globalThis, {
  foundry: deep, CONFIG: {}, CONST: { DICE_ROLL_MODES: { PRIVATE: "gmroll", PUBLIC: "publicroll" } },
  Hooks: { on() {}, once() {}, callAll() {} }, ui: { notifications: { warn() {} } }, canvas: null,
  ChatMessage: { getWhisperRecipients: () => [] },
  Roll: class {
    constructor(formula) { this.formula = formula; }
    async evaluate() { this.total = dice.shift(); return this; }
    async toMessage() { return null; }
  },
  game: {
    settings: { get: (ns, key) => ({ encounterThreshold: 3, encounterRollGMOnly: false })[key] ?? null, set: async () => {} },
    i18n: { localize: (k) => k, format: (k) => k },
    user: { id: "gm", isGM: true }, users: {}, socket: { on() {}, emit() {} },
  },
});
const { EncounterCheck } = await import("../scripts/encounter/encounter-check.mjs");
const { SessionRecap } = await import("../scripts/session-recap/session-recap.mjs");
const logged = [];
SessionRecap.logEncounterCheck = async (entry) => { logged.push(entry); };

test("with no options it is the crawl's check: the setting's threshold, no label", async () => {
  cards.length = logged.length = 0;
  dice.push(4);
  const res = await EncounterCheck.check();
  assert.deepEqual(res, { total: 4, hit: false });
  assert.equal(cards[0].threshold, 3);
  assert.equal(cards[0].where, "");
  assert.equal(logged[0].clockLabel, null);
});

test("a travel check rolls against its own chance, on the travel hex, with its labels", async () => {
  cards.length = logged.length = 0;
  dice.push(2);                                   // a hit at the setting's 3-in-6, a miss at 1-in-6
  const hex = { num: 3139, terrain: "mountain", region: "Bastion Mountains", features: [] };
  const res = await EncounterCheck.check({ threshold: 1, hex, label: "Night check, 21:00", clockLabel: "Night check, 21:00" });
  assert.deepEqual(res, { total: 2, hit: false });
  assert.equal(cards[0].threshold, 1);
  assert.equal(cards[0].where, "Night check, 21:00 · Hex 3139 · mountain");
  assert.equal(logged[0].clockLabel, "Night check, 21:00");
  assert.equal(logged[0].threshold, 1);
});
