// The off-duty clock move (#228, Overland O2): which lights are put out, where
// the move runs, and what timeAdvanced hears; then the whole move against a
// stand-in world whose light tracker behaves like Shadowdark 4.0.6's (a cached
// list per GM tab, rebuilt only when dirty, burnt from on every tab holding
// the primaryGM flag).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HANDOFF_TIMEOUT_MS, OFF_DUTY_QUERY, advanceOffDuty, advanceOptions, burnCheck, handleOffDutyQuery, lightGMs,
  litCarried, offDutyMembers, offDutyRoute, settle, stillTracked,
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

const me = { id: "bridge", name: "Bridge", isGM: true, active: true, flags: {} };
const gm = { id: "gm", name: "Gamemaster", isGM: true, active: true, flags: { shadowdark: { primaryGM: true } } };
const flag = (u) => ({ ...u, flags: { shadowdark: { primaryGM: true } } });

test("the GMs that burn are the online ones holding the flag, not Foundry's active GM", () => {
  assert.deepEqual(lightGMs([me, gm]), [gm]);
  assert.deepEqual(lightGMs([me, { ...gm, active: false }]), [], "an offline GM burns nothing");
  assert.deepEqual(lightGMs([me, { ...gm, isGM: false }]), [], "a player never holds it");
  assert.equal(lightGMs([flag(me), gm]).length, 2, "two tabs can hold it at once");
});

test("tracking off only advances; two flags refuse; another primary gets the move; otherwise it runs here", () => {
  assert.equal(offDutyRoute({ tracking: false, flagged: [gm], selfId: me.id }), "advance");
  assert.equal(offDutyRoute({ tracking: false, flagged: [], selfId: me.id }), "advance");
  assert.equal(offDutyRoute({ tracking: true, flagged: [gm, flag(me)], selfId: me.id }), "twoPrimaries");
  assert.equal(offDutyRoute({ tracking: true, flagged: [gm], selfId: me.id }), "handoff");
  assert.equal(offDutyRoute({ tracking: true, flagged: [gm], selfId: gm.id }), "douse");
  assert.equal(offDutyRoute({ tracking: true, flagged: [], selfId: me.id }), "douse",
    "nobody holds the flag: the system would give it to the first GM that sees the clock move, and burn there");
});

test("just before advancing, this GM must be the only one holding the flag", () => {
  assert.equal(burnCheck([gm], gm.id), null);
  assert.equal(burnCheck([gm, flag(me)], gm.id), "twoPrimaries");
  assert.equal(burnCheck([flag(me)], gm.id), "notPrimary");
  assert.equal(burnCheck([], gm.id), "notPrimary");
});

test("the reason reaches timeAdvanced as offDuty", () => {
  const { calls, handlers } = hookWorld(at(1301, 6, 1));
  handlers.updateWorldTime(at(1301, 6, 4), 3 * DAY, advanceOptions("carousing"), "gm");
  assert.equal(calls[0].payload.offDuty, "carousing");
  assert.equal(calls[0].payload.crossed.days, 3);
});

test("the cache is clear when it holds no Basic light of a member; a Light spell or a stranger's torch doesn't count", () => {
  const cache = [
    { _id: "a", lightSources: [{ _id: "t1", type: "Basic" }] },
    { _id: "b", lightSources: [{ _id: "s1", type: "Effect" }] },
    { _id: "lightActor", lightSources: [{ _id: "l1", type: "Basic" }] },
  ];
  assert.equal(stillTracked(cache, new Set(["a"])), true);
  assert.equal(stillTracked(cache, new Set(["b"])), false);
  assert.equal(stillTracked({}, new Set(["a"])), false);
});

test("settle forces a rebuild, and gives up when the tracker never lets go", async () => {
  const stuck = { monitoredLightSources: [{ _id: "a", lightSources: [{ _id: "t1", type: "Basic" }] }], async _updateLightSources() {} };
  assert.equal(await settle(stuck, new Set(["a"]), { tries: 2, ms: 1 }), false);
  assert.equal(stuck.dirty, true, "marked dirty even with nothing put out");
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
 * from `monitoredLightSources`, which only `_updateLightSources` rebuilds, and
 * only once it is dirty. Its real-time clock is running.
 */
function world({ tracking = true, self = { ...gm }, users = null, query = null, noCanvas = false } = {}) {
  const torch = light("torch", "Basic", true);
  const lantern = light("lantern", "Basic", false, { name: "Lantern" });
  const spell = light("spell", "Effect", true, { name: "Light" });
  const log = { updates: [], tokenLight: [], protoLight: [], chats: [], advanced: [], warnings: [], flags: [], queries: [], clock: [] };
  const pc = {
    id: "aria", name: "Aria", type: "Player", hasPlayerOwner: true, items: [torch, lantern],
    async updateEmbeddedDocuments(_type, updates) {
      for (const u of updates) {
        log.updates.push(u);
        this.items.find((i) => i.id === u._id).system.light.active = u["system.light.active"];
      }
    },
    async toggleLight(active, id) { log.tokenLight.push({ active, id }); },
    async update(data) { log.protoLight.push(data); },
  };
  const caster = { id: "bram", name: "Bram", type: "Player", hasPlayerOwner: true, items: [spell], async updateEmbeddedDocuments() {} };
  const actors = [pc, caster];
  const gather = () => actors.map((a) => ({
    _id: a.id, lightSources: a.items.filter((i) => i.system.light.active).map((i) => ({ _id: i.id, type: i.type })),
  }));
  const tracker = {
    dirty: false, performingTick: false, monitoredLightSources: gather(),
    realTime: {
      updateIntervalId: 7,
      stop() { log.clock.push("stop"); this.updateIntervalId = undefined; },
      start() { log.clock.push("start"); this.updateIntervalId = 8; },
    },
    toggleLightSource() { this.dirty = true; },
    async _updateLightSources() { if (this.dirty) { this.dirty = false; this.monitoredLightSources = gather(); } },
  };
  self.setFlag = async (scope, key, value) => { log.flags.push([scope, key, value]); self.flags = { [scope]: { [key]: value } }; };
  self.hasPermission = () => true;
  const allUsers = users ?? [self];
  const start = at(1301, 6, 1, 20);
  globalThis.canvas = noCanvas ? {} : { tokens: {} };
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
        log.advanced.push({ s, options, burns: stillTracked(tracker.monitoredLightSources, new Set(["aria"])), clock: [...log.clock] });
        this.worldTime += s;
      },
    },
  };
  globalThis.ChatMessage = { create: async (data) => log.chats.push(data) };
  globalThis.ui = { notifications: { warn: (m) => log.warnings.push(m) } };
  for (const u of allUsers) {
    u.query ??= async (name, data, opts) => { log.queries.push({ to: u.id, name, data, opts }); return query ? query(name, data) : { ok: true }; };
  }
  return { log, torch, spell, start, pc, tracker };
}

test("on the primary GM: the torch goes out with its 40 minutes, the cache lets go, 3 days pass, one line names it", async () => {
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
  assert.deepEqual(log.advanced, [{ s: 3 * DAY, options: { "shadowdark-enhancer": { offDuty: "downtime" } }, burns: false, clock: ["stop"] }],
    "advanced once, exactly 3 days, with the real-time clock stopped and the cache clear of the torch");
  assert.deepEqual(log.clock, ["stop", "start"], "the real-time clock runs again afterwards");
  assert.equal(reply.worldTime, start + 3 * DAY);
  assert.deepEqual(log.flags, [], "already the primary GM");
});

test("nothing lit: no chat line, and the clock still moves", async () => {
  const { log, pc, tracker } = world();
  pc.items[0].system.light.active = false;
  tracker.monitoredLightSources = [];
  const reply = await advanceOffDuty(3600, { reason: "rest" });
  assert.equal(reply.ok, true);
  assert.deepEqual(log.chats, []);
  assert.deepEqual(log.advanced.map((a) => a.options), [{ "shadowdark-enhancer": { offDuty: "rest" } }]);
});

test("a torch put out elsewhere but still in a stale cache is cleared before the jump, though nothing was put out here", async () => {
  const { log, pc } = world();
  pc.items[0].system.light.active = false;   // put out by a path that didn't mark the tracker dirty
  const reply = await advanceOffDuty(3 * DAY);
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.doused, []);
  assert.equal(log.advanced[0].burns, false, "rebuilt before advancing");
});

test("light tracking off: it only advances", async () => {
  const { log, torch } = world({ tracking: false });
  const reply = await advanceOffDuty(3 * DAY, { reason: "downtime" });
  assert.equal(reply.ok, true);
  assert.equal(torch.system.light.active, true);
  assert.deepEqual([log.updates, log.chats, log.queries, log.clock], [[], [], [], []]);
  assert.equal(log.advanced.length, 1);
});

test("from a GM that isn't the primary: the move is handed to the primary GM, and nothing happens here", async () => {
  const bridge = { ...me };
  const { log, torch } = world({ self: bridge, users: [bridge, { ...gm }], query: () => ({ ok: true, worldTime: 1, doused: [] }) });
  const reply = await advanceOffDuty(3 * DAY, { reason: "downtime" });
  assert.equal(reply.ok, true);
  assert.equal(log.queries.length, 1);
  assert.equal(log.queries[0].to, "gm", "the primary light GM, not whoever is Foundry's active GM");
  assert.equal(log.queries[0].name, OFF_DUTY_QUERY);
  assert.deepEqual(log.queries[0].data, { seconds: 3 * DAY, reason: "downtime" });
  assert.equal(log.queries[0].opts.timeout, HANDOFF_TIMEOUT_MS, "longer than the relay's 20 s");
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

test("a primary GM that never answers: the outcome is unknown, not refused", async () => {
  const bridge = { ...me };
  const { log } = world({ self: bridge, users: [bridge, { ...gm }], query: () => { throw new Error("operation has timed out"); } });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const reply = await advanceOffDuty(DAY);
    assert.equal(reply.ok, false);
    assert.deepEqual(log.warnings, ["SDE.time.offDuty.unknown(Gamemaster)"]);
  } finally { console.warn = warn; }
});

test("two GMs holding the flag: refused before anything is put out, naming both", async () => {
  const bridge = flag(me);
  const { log, torch } = world({ self: bridge, users: [bridge, { ...gm }] });
  const reply = await advanceOffDuty(3 * DAY);
  assert.equal(reply.ok, false);
  assert.deepEqual(log.warnings, ["SDE.time.offDuty.twoPrimaries(Bridge, Gamemaster)"]);
  assert.equal(torch.system.light.active, true);
  assert.deepEqual([log.updates, log.advanced, log.queries, log.chats], [[], [], [], []]);
});

test("a second GM takes the flag while the lights go out: no jump, the reply names what was put out, the line says so", async () => {
  const other = { ...me };
  const { log, torch, tracker } = world({ users: null });
  globalThis.game.users.push(other);
  const rebuild = tracker._updateLightSources.bind(tracker);
  tracker._updateLightSources = async () => { other.flags = { shadowdark: { primaryGM: true } }; await rebuild(); };
  const reply = await advanceOffDuty(3 * DAY);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /twoPrimaries/);
  assert.deepEqual(reply.doused, [{ actorId: "aria", itemId: "torch" }]);
  assert.equal(torch.system.light.remainingSecs, 2400);
  assert.deepEqual(log.advanced, [], "the other tab would burn its stale list by the whole jump");
  assert.equal(log.chats.length, 1);
  assert.match(log.chats[0].content, /chatRefused/);
  assert.deepEqual(log.clock, ["stop", "start"]);
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

test("the cache never lets go: the clock is not moved, and the reply and the line say what was put out", async () => {
  const { log, tracker } = world();
  tracker._updateLightSources = undefined;   // and nothing else rebuilds it
  tracker.performingTick = true;
  const reply = await advanceOffDuty(3 * DAY);
  assert.equal(reply.ok, false);
  assert.deepEqual(reply.doused, [{ actorId: "aria", itemId: "torch" }]);
  assert.deepEqual(log.warnings, ["SDE.time.offDuty.unsettled"]);
  assert.deepEqual(log.advanced, []);
  assert.match(log.chats[0].content, /chatRefused/);
});

test("a throw part-way: no jump, a refusal instead of a rejection, and what was put out is reported", async () => {
  const { log, pc } = world();
  const second = light("lantern2", "Basic", true, { name: "Lantern" });
  const broken = { id: "cora", name: "Cora", type: "Player", hasPlayerOwner: true, items: [second],
    async updateEmbeddedDocuments() { throw new Error("server said no"); } };
  globalThis.game.actors.push(broken);
  const error = console.error;
  console.error = () => {};
  try {
    const reply = await advanceOffDuty(3 * DAY);
    assert.equal(reply.ok, false);
    assert.equal(reply.error, "SDE.time.offDuty.failed");
    assert.deepEqual(reply.doused, [{ actorId: "aria", itemId: "torch" }]);
    assert.equal(pc.items[0].system.light.active, false);
    assert.deepEqual(log.advanced, []);
    assert.deepEqual(log.clock, ["stop", "start"], "the real-time clock is restarted after a throw too");
    assert.match(log.chats[0].content, /chatRefused/);
  } finally { console.error = error; }
});

test("a tab without a canvas: the prototype token goes dark instead of reading the canvas's tokens", async () => {
  const { log } = world({ noCanvas: true });
  const reply = await advanceOffDuty(DAY);
  assert.equal(reply.ok, true);
  assert.deepEqual(log.tokenLight, []);
  assert.deepEqual(log.protoLight, [{ "prototypeToken.light": { dim: 0, bright: 0 } }]);
});

test("refused for players, and for a move that goes nowhere", async () => {
  const player = world({ self: { id: "p", isGM: false, flags: {} } });
  assert.equal((await advanceOffDuty(DAY)).ok, false);
  assert.deepEqual(player.log.warnings, ["SDE.time.offDuty.gmOnly"]);
  assert.deepEqual(player.log.advanced, []);
  const { log, pc } = world();
  for (const s of [0, -60, NaN, "soon"]) assert.equal((await advanceOffDuty(s)).ok, false, String(s));
  assert.deepEqual(log.advanced, []);
  assert.equal(pc.items[0].system.light.active, true, "and no torch was touched");
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
