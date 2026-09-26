// The off-duty clock move (#228, Overland O2): which lights are put out, where
// the move runs, and what timeAdvanced hears; then the whole move against a
// stand-in world whose light tracker behaves like Shadowdark 4.0.6's (a cached
// list, rebuilt only when dirty, burnt from on the primary GM).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OFF_DUTY_QUERY, advanceOffDuty, advanceOptions, handleOffDutyQuery, litCarried, offDutyMembers,
  offDutyRoute, primaryLightGM, settle, stillTracked,
} from "../scripts/time/off-duty.mjs";
import { registerTimeHooks } from "../scripts/time/time.mjs";
import { at, clockAt } from "./gregorian-calendar.mjs";

const DAY = 86400;
const light = (id, type, active, { remainingSecs = 2400, isSource = true, name = "Torch" } = {}) => ({
  id, _id: id, name, type, system: { light: { isSource, active, remainingSecs, longevityMins: 60 } },
});

// ── Which lights ─────────────────────────────────────────────────────────────

test("the members are the player-owned PCs, the set the system's tracker burns", () => {
  const pc = { id: "a", type: "Player", hasPlayerOwner: true };
  const unowned = { id: "b", type: "Player", hasPlayerOwner: false };
  const party = { id: "c", type: "NPC", hasPlayerOwner: true };   // an Extras party actor, with its campfire
  const lightActor = { id: "d", type: "Light", hasPlayerOwner: true };
  assert.deepEqual(offDutyMembers([pc, unowned, party, lightActor]), [pc]);
});

test("only lit Basic lights are put out: not an unlit torch, a Light spell, or gear that is no light", () => {
  const lit = light("t1", "Basic", true);
  const actor = { id: "a", items: [lit, light("t2", "Basic", false), light("s1", "Effect", true, { name: "Light" }),
    light("r1", "Basic", true, { isSource: false, name: "Rope" })] };
  const other = { id: "b", items: [light("l1", "Basic", true, { name: "Lantern" })] };
  const got = litCarried([actor, other, { id: "c" }]);
  assert.deepEqual(got.map(({ actor: a, item }) => `${a.id}/${item.id}`), ["a/t1", "b/l1"]);
});

// ── Where it runs ────────────────────────────────────────────────────────────

const me = { id: "bridge", isGM: true, active: true, flags: {} };
const gm = { id: "gm", isGM: true, active: true, flags: { shadowdark: { primaryGM: true } } };

test("the primary light GM is the user flag, not Foundry's active GM", () => {
  const flaggedMe = { ...me, flags: { shadowdark: { primaryGM: true } } };
  assert.equal(primaryLightGM(flaggedMe, [flaggedMe, gm]), flaggedMe, "this user's own flag wins, as isPrimaryGM reads it");
  assert.equal(primaryLightGM(me, [me, gm]), gm);
  assert.equal(primaryLightGM(me, [me, { ...gm, active: false }]), null, "an offline GM burns nothing");
  assert.equal(primaryLightGM(me, [me, { ...gm, isGM: false }]), null, "a player never holds it");
});

test("tracking off only advances; another primary GM gets the move; otherwise it runs here", () => {
  assert.equal(offDutyRoute({ tracking: false, primary: gm, self: me }), "advance");
  assert.equal(offDutyRoute({ tracking: false, primary: null, self: me }), "advance");
  assert.equal(offDutyRoute({ tracking: true, primary: gm, self: me }), "handoff");
  assert.equal(offDutyRoute({ tracking: true, primary: gm, self: gm }), "douse");
  assert.equal(offDutyRoute({ tracking: true, primary: null, self: me }), "douse",
    "nobody holds the flag: the system would give it to the first GM that sees the clock move, and burn there");
});

test("the reason reaches timeAdvanced as offDuty", () => {
  const { calls, handlers } = hookWorld(at(1301, 6, 1));
  handlers.updateWorldTime(at(1301, 6, 4), 3 * DAY, advanceOptions("carousing"), "gm");
  assert.equal(calls[0].payload.offDuty, "carousing");
  assert.equal(calls[0].payload.crossed.days, 3);
});

test("a cached light is found by its id, and a list that isn't one holds nothing", () => {
  const cache = [{ _id: "a", lightSources: [{ _id: "t1" }] }, { _id: "b", lightSources: [] }];
  assert.equal(stillTracked(cache, new Set(["t1"])), true);
  assert.equal(stillTracked(cache, new Set(["t2"])), false);
  assert.equal(stillTracked({}, new Set(["t1"])), false);
});

test("settle gives up when the tracker never lets go, so the clock is not moved", async () => {
  const stuck = { monitoredLightSources: [{ _id: "a", lightSources: [{ _id: "t1" }] }], async _updateLightSources() {} };
  assert.equal(await settle(stuck, new Set(["t1"]), { tries: 2, ms: 1 }), false);
  const busy = { monitoredLightSources: [], performingTick: true, async _updateLightSources() {} };
  assert.equal(await settle(busy, new Set(), { tries: 2, ms: 1 }), false, "a burn in progress is waited out");
});

// ── The whole move, on a stand-in world ──────────────────────────────────────

/** Hooks and a clock, for the timeAdvanced round trip. */
function hookWorld(t) {
  const calls = [], handlers = {};
  globalThis.CONFIG = { queries: {} };
  globalThis.Hooks = { on: (name, fn) => { handlers[name] = fn; }, callAll: (name, payload) => calls.push({ name, payload }) };
  const user = { id: "gm", isGM: true };
  globalThis.game = { time: clockAt(t), user, users: { activeGM: user }, settings: { get: () => 0 } };
  registerTimeHooks();
  return { calls, handlers };
}

/**
 * A world with one PC carrying a lit torch (40 minutes left) and an unlit
 * lantern, a PC's Light spell, and a light tracker like 4.0.6's: it burns
 * from `monitoredLightSources`, which only `_updateLightSources` rebuilds and
 * only once `toggleLightSource` has made it dirty.
 */
function world({ tracking = true, self = { ...gm }, users = null, query = null } = {}) {
  const torch = light("torch", "Basic", true);
  const lantern = light("lantern", "Basic", false, { name: "Lantern" });
  const spell = light("spell", "Effect", true, { name: "Light" });
  const log = { updates: [], tokenLight: [], chats: [], advanced: [], warnings: [], flags: [], queries: [] };
  const pc = {
    id: "aria", name: "Aria", type: "Player", hasPlayerOwner: true, items: [torch, lantern],
    async updateEmbeddedDocuments(_type, updates) {
      for (const u of updates) {
        log.updates.push(u);
        this.items.find((i) => i.id === u._id).system.light.active = u["system.light.active"];
      }
    },
    async toggleLight(active, id) { log.tokenLight.push({ active, id }); },
  };
  const caster = { id: "bram", name: "Bram", type: "Player", hasPlayerOwner: true, items: [spell], async updateEmbeddedDocuments() {} };
  const actors = [pc, caster];
  const gather = () => actors.map((a) => ({ _id: a.id, lightSources: a.items.filter((i) => i.system.light.active).map((i) => ({ _id: i.id })) }));
  const tracker = {
    dirty: false, performingTick: false, monitoredLightSources: gather(),
    toggleLightSource() { this.dirty = true; },
    async _updateLightSources() { if (this.dirty) { this.dirty = false; this.monitoredLightSources = gather(); } },
  };
  self.setFlag = async (scope, key, value) => { log.flags.push([scope, key, value]); self.flags = { [scope]: { [key]: value } }; };
  self.hasPermission = () => true;
  const allUsers = users ?? [self];
  const start = at(1301, 6, 1, 20);
  globalThis.game = {
    user: self,
    users: allUsers,
    actors,
    modules: { get: () => null },
    shadowdark: { lightSourceTracker: tracker },
    settings: { get: (ns, key) => (ns === "shadowdark" && key === "trackLightSources" ? tracking : 0) },
    i18n: { lang: "en", localize: (k) => k, format: (k, d) => `${k}(${Object.values(d).join("|")})` },
    time: {
      worldTime: start,
      async advance(s, options) {
        log.advanced.push({ s, options, burns: stillTracked(tracker.monitoredLightSources, new Set(["torch"])) });
        this.worldTime += s;
      },
    },
  };
  globalThis.ChatMessage = { create: async (data) => log.chats.push(data) };
  globalThis.ui = { notifications: { warn: (m) => log.warnings.push(m) } };
  for (const u of allUsers) {
    u.query ??= async (name, data, opts) => { log.queries.push({ to: u.id, name, data, opts }); return query?.(name, data) ?? { ok: true }; };
  }
  return { log, torch, spell, start };
}

test("on the primary GM: the torch goes out with its 40 minutes, one line names it, the cache lets go, then 3 days pass", async () => {
  const { log, torch, spell, start } = world();
  const reply = await advanceOffDuty(3 * DAY, { reason: "downtime" });

  assert.equal(reply.ok, true);
  assert.deepEqual(reply.doused, [{ actorId: "aria", itemId: "torch" }]);
  assert.deepEqual(log.updates, [{ _id: "torch", "system.light.active": false }], "only the active flag changes");
  assert.equal(torch.system.light.remainingSecs, 2400, "40 minutes kept");
  assert.equal(spell.system.light.active, true, "a Light spell is left to the clock");
  assert.deepEqual(log.tokenLight, [{ active: false, id: "torch" }], "the token's light goes out");
  assert.equal(log.chats.length, 1);
  assert.match(log.chats[0].content, /SDE\.time\.offDuty\.chat\(SDE\.time\.offDuty\.light\(Aria\|Torch\)\)/);
  assert.deepEqual(log.advanced, [{ s: 3 * DAY, options: { "shadowdark-enhancer": { offDuty: "downtime" } }, burns: false }],
    "advanced once, exactly 3 days, after the tracker's cache stopped holding the torch");
  assert.equal(reply.worldTime, start + 3 * DAY);
  assert.deepEqual(log.flags, [], "already the primary GM");
});

test("nothing lit: no chat line, and the clock still moves", async () => {
  const { log } = world();
  globalThis.game.actors[0].items[0].system.light.active = false;
  globalThis.game.shadowdark.lightSourceTracker.monitoredLightSources = [];
  const reply = await advanceOffDuty(3600, { reason: "rest" });
  assert.equal(reply.ok, true);
  assert.deepEqual(log.chats, []);
  assert.deepEqual(log.advanced.map((a) => a.options), [{ "shadowdark-enhancer": { offDuty: "rest" } }]);
});

test("light tracking off: it only advances", async () => {
  const { log, torch } = world({ tracking: false });
  const reply = await advanceOffDuty(3 * DAY, { reason: "downtime" });
  assert.equal(reply.ok, true);
  assert.equal(torch.system.light.active, true);
  assert.deepEqual([log.updates, log.chats, log.queries], [[], [], []]);
  assert.equal(log.advanced.length, 1);
});

test("from a GM that isn't the primary: the move is handed to the primary GM, and nothing happens here", async () => {
  const bridge = { ...me };
  const primary = { ...gm };
  const { log, torch } = world({ self: bridge, users: [bridge, primary], query: () => ({ ok: true, worldTime: 1, doused: [] }) });
  const reply = await advanceOffDuty(3 * DAY, { reason: "downtime" });
  assert.equal(reply.ok, true);
  assert.equal(log.queries.length, 1);
  assert.equal(log.queries[0].to, "gm", "the primary light GM, not whoever is Foundry's active GM");
  assert.equal(log.queries[0].name, OFF_DUTY_QUERY);
  assert.deepEqual(log.queries[0].data, { seconds: 3 * DAY, reason: "downtime" });
  assert.ok(Number.isFinite(log.queries[0].opts.timeout));
  assert.equal(torch.system.light.active, true);
  assert.deepEqual([log.updates, log.advanced], [[], []]);
});

test("the primary GM's refusal is shown to the GM who asked, and the clock stays", async () => {
  const bridge = { ...me };
  const { log } = world({ self: bridge, users: [bridge, { ...gm }], query: () => ({ ok: false, error: "stale" }) });
  const reply = await advanceOffDuty(DAY);
  assert.equal(reply.ok, false);
  assert.deepEqual(log.warnings, ["stale"]);
  assert.deepEqual(log.advanced, []);
});

test("no primary GM online: this GM takes the flag the way the system would, and puts the torch out first", async () => {
  const bridge = { ...me };
  const { log, torch } = world({ self: bridge, users: [bridge, { ...gm, active: false }] });
  const reply = await advanceOffDuty(3 * DAY, { reason: "carousing" });
  assert.equal(reply.ok, true);
  assert.deepEqual(log.flags, [["shadowdark", "primaryGM", true]]);
  assert.equal(torch.system.light.active, false);
  assert.equal(log.advanced[0].burns, false);
  assert.deepEqual(log.queries, []);
});

test("the cache never lets go: the clock is not moved and the GM is told", async () => {
  const { log } = world();
  globalThis.game.shadowdark.lightSourceTracker._updateLightSources = undefined;   // and nothing else rebuilds it
  globalThis.game.shadowdark.lightSourceTracker.performingTick = true;
  const reply = await advanceOffDuty(3 * DAY);
  assert.equal(reply.ok, false);
  assert.deepEqual(log.warnings, ["SDE.time.offDuty.unsettled"]);
  assert.deepEqual(log.advanced, []);
});

test("refused for players, and for a move that goes nowhere", async () => {
  const player = world({ self: { id: "p", isGM: false, flags: {} } });
  assert.equal((await advanceOffDuty(DAY)).ok, false);
  assert.deepEqual(player.log.warnings, ["SDE.time.offDuty.gmOnly"]);
  assert.deepEqual(player.log.advanced, []);
  const { log } = world();
  for (const s of [0, -60, NaN, "soon"]) assert.equal((await advanceOffDuty(s)).ok, false, String(s));
  assert.deepEqual(log.advanced, []);
  assert.equal(globalThis.game.actors[0].items[0].system.light.active, true, "and no torch was touched");
});

test("the hand-off receiver: a GM sender only, and it never passes the move on", async () => {
  const { log } = world();
  assert.deepEqual(await handleOffDutyQuery({ seconds: DAY, reason: "downtime" }, { id: "p", isGM: false }),
    { ok: false, error: "SDE.time.offDuty.gmOnly" });
  assert.deepEqual(log.advanced, []);

  const bridge = { ...me };
  const other = world({ self: bridge, users: [bridge, { ...gm }] });
  assert.deepEqual(await handleOffDutyQuery({ seconds: DAY, reason: "downtime" }, gm),
    { ok: false, error: "SDE.time.offDuty.notPrimary" }, "another GM burns the lights: refuse, don't forward");
  assert.deepEqual([other.log.queries, other.log.advanced], [[], []]);

  const here = world();
  const reply = await handleOffDutyQuery({ seconds: DAY, reason: "downtime" }, me);
  assert.equal(reply.ok, true);
  assert.equal(here.log.advanced[0].options["shadowdark-enhancer"].offDuty, "downtime");
});
