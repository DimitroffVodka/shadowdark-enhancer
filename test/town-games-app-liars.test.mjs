/**
 * The games window's Liar's Dice screens, driven through the window's own actions with Foundry's window classes stubbed and a
 * real client (liars-dice-net.mjs) behind each window, over a fake wire. The rules, the tables and the money are pinned in
 * their own tests; this is the glue: set-up, sitting down, the lobby, the table, the open tables, the roll animation, and
 * what closing the window does.
 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { addToPurse, toCopper } from "../scripts/shared/coins.mjs";

const warnings = [];
globalThis.foundry = {
  utils: { debounce: (fn) => fn },
  applications: { api: {
    ApplicationV2: class { async render() { return this; } async _prepareContext() { return {}; } },
    HandlebarsApplicationMixin: (Base) => Base,
  } },
};
globalThis.Hooks = { on: () => 1, off() {} };
globalThis.ui = { notifications: { warn: (m) => warnings.push(m) } };
const characters = ["c1", "c2", "c3"].map((id) => ({ id, name: `Char ${id}`, type: "Player", isOwner: true, system: { coins: { gp: 5, sp: 0, cp: 0 } } }));
globalThis.game = { actors: characters, user: { isGM: false, character: characters[0] } };
const { TownGamesApp } = await import("../scripts/town/town-games-app.mjs");
const { LiarsClient } = await import("../scripts/town/liars-dice-net.mjs");
const { decide } = await import("../scripts/town/liars-dice-core.mjs");
const { refundAnte, settleSeat, takeAnte } = await import("../scripts/town/town-liars-dice.mjs");

const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const NAMES = ["Brannoch", "Old Mags", "Quill", "Tolliver", "Sedge"];

/** Windows for the given users over one fake wire; `flush` carries every message and waits for every client to finish. */
function windows(users, { seed = 3 } = {}) {
  characters.forEach((c) => { c.system.coins = { gp: 5, sp: 0, cp: 0 }; });
  const apps = new Map(), clients = new Map(), queue = [], chat = {};
  users.forEach(([uid, charId], n) => {
    chat[uid] = [];
    const io = {
      t: (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key),
      async charge(actor, purse) { const was = actor.system.coins; actor.system.coins = purse; return was; },
      async pay(actor, coins) { actor.system.coins = addToPurse(actor.system.coins, coins); return true; },
      chat: async (m) => { chat[uid].push(m); },
    };
    const send = (msg, to) => { for (const target of to ? [to] : users.map((u) => u[0]).filter((x) => x !== uid)) queue.push({ to: target, from: uid, msg: JSON.parse(JSON.stringify(msg)) }); };
    const client = new LiarsClient({
      userId: uid, send, delay: async () => {}, rng: seeded(seed * 10 + n), aiNames: NAMES, newId: () => "T1",
      money: { take: (p, a, town) => takeAnte({ player: p, ante: a, town }, io), refund: (p, a) => refundAnte({ player: p, ante: a }, io), settle: (a) => settleSeat(a, io) },
    });
    clients.set(uid, client);
    const app = new TownGamesApp();
    Object.assign(app, { client, buyerId: charId, scene: { id: "s1", name: "Hollowmere", flags: { "shadowdark-enhancer": { landing: { title: "Hollowmere", games: { on: true, maxBet: 10, edge: 5 } } } } }, element: { querySelector: () => null, querySelectorAll: () => [] } });
    app.render = async function () { this.renders = (this.renders ?? 0) + 1; return this; };
    app._onFirstRender({}, {});
    apps.set(uid, app);
  });
  async function flush() {
    for (let i = 0; i < 500; i++) {
      while (queue.length) { const m = queue.shift(); clients.get(m.to).handle(m.msg, m.from); }
      await Promise.all([...clients.values()].map((c) => c.idle()));
      await new Promise((resolve) => setImmediate(resolve));
      if (!queue.length) return;
    }
    throw new Error("the wire never went quiet");
  }
  const purse = (charId) => toCopper(characters.find((c) => c.id === charId).system.coins);
  const ctx = (uid) => apps.get(uid)._prepareContext({});
  return { apps, clients, flush, chat, purse, ctx };
}
const play = (app) => app._onPlay(null, { dataset: { game: "liars" } });
const step = (app, what, by) => app._onSetupStep(null, { dataset: { what, by: String(by) } });

/** Every window whose turn it is plays (a bid or a call, as the house would decide), until the match is over. */
async function playOut(w, uids, seed = 1) {
  for (let i = 0; i < 1500; i++) {
    await w.flush();
    const uid = uids.find((u) => { const v = w.clients.get(u).view; return v?.phase === "playing" && v.turn === u; });
    if (!uid) return;
    const app = w.apps.get(uid), v = w.clients.get(uid).view, me = v.seats.find((x) => x.you);
    const d = decide({ hand: v.hand, unseen: v.seats.reduce((n, x) => n + x.dice, 0) - me.dice, bid: v.bid }, seeded(i + seed));
    if (d.call) app._onCall(); else { app.pick = { qty: d.qty, face: d.face }; app._onBid(); }
  }
  throw new Error("the match never ended");
}

test("Play on Liar's dice opens the set-up screen, and the steppers keep the table to two to six seats", async () => {
  const w = windows([["u1", "c1"]]);
  const app = w.apps.get("u1");
  assert.equal(app.screen, null);
  await play(app);
  assert.deepEqual([app.screen, app.setup], ["setup", { ai: 1, humans: 0 }]);
  const ctx = await w.ctx("u1");
  assert.deepEqual([ctx.isScreen, ctx.setup.seats, ctx.games.length, ctx.games.at(-1).id], [{ setup: true }, 2, 10, "liars"]);
  step(app, "ai", -1);
  assert.equal(app.setup.ai, 1, "a table of one is not a table");
  step(app, "humans", 1);
  step(app, "ai", 1);
  step(app, "ai", 1);
  step(app, "ai", 1);
  assert.deepEqual(app.setup, { ai: 4, humans: 1 }, "you, four of the house's players and one other: six at the table");
  step(app, "humans", 1);
  assert.equal(app.setup.humans, 1, "no seventh seat");
  step(app, "ai", -1);
  step(app, "humans", -1);
  step(app, "humans", -1);
  assert.deepEqual(app.setup, { ai: 3, humans: 0 });
  app._onCancelSetup();
  assert.equal(app.screen, null);
});

test("sitting down alone against the house takes the wager, turns the window into the table, and plays out to a result that stays on the list", async () => {
  for (const seed of [1, 2, 3]) {
    const w = windows([["u1", "c1"]], { seed });
    const app = w.apps.get("u1");
    await play(app);
    step(app, "ai", 1);
    step(app, "ai", 1);
    await app._onSit();
    await w.flush();
    assert.equal(w.purse("c1"), 400, "the wager is on the table");
    const ctx = await w.ctx("u1");
    assert.equal(ctx.screen, "table");
    assert.equal(ctx.match.others.length, 3, "three of the house's players");
    assert.deepEqual([ctx.match.you.dice.length, ctx.match.potText, ctx.atTable], [5, "4 gp", true]);
    await playOut(w, ["u1"], seed);
    const done = await w.ctx("u1");
    assert.equal(done.match.over, true);
    assert.equal(done.last.game, "SDE.town.games.liars.name");
    const won = w.clients.get("u1").view.winner === "u1";
    assert.equal(w.purse("c1"), 400 + (won ? 100 + Math.floor(100 * 3 * 0.95) : 0));
    assert.equal(done.last.tone, won ? "good" : "bad");
    assert.equal(w.chat.u1.length, 1);
    await app._onDone();
    const list = await w.ctx("u1");
    assert.deepEqual([list.screen, list.last?.game, list.atTable, app.client.part], [null, "SDE.town.games.liars.name", false, null]);
  }
});

test("a wager that cannot be taken is told to the player and starts no table", async () => {
  const w = windows([["u1", "c1"]]);
  const app = w.apps.get("u1");
  characters[0].system.coins = { gp: 0, sp: 5, cp: 0 };
  await play(app);
  await app._onSit();
  assert.equal(app.client.part, null);
  assert.match(warnings.at(-1), /wagerPoor/);
  assert.equal(app.setup !== null, true, "the set-up stays for another try");
});

test("walking away or closing the window leaves the table: a match is forfeited, and a hosted lobby is called off with the wager back", async () => {
  const w = windows([["u1", "c1"]]);
  const app = w.apps.get("u1");
  await play(app);
  await app._onSit();
  await w.flush();
  await app.leaveTable();
  assert.equal(w.purse("c1"), 400, "a match left is lost");
  assert.equal(w.chat.u1.length, 1);
  assert.match(w.chat.u1[0].content, /ui-cc bad/);
  // a table waiting for people, called off by closing the window
  const lobby = windows([["u1", "c1"]]);
  const host = lobby.apps.get("u1");
  await play(host);
  step(host, "humans", 1);
  await host._onSit();
  assert.equal(host.screen, "lobby");
  assert.equal(lobby.purse("c1"), 400);
  host._onClose({});
  await lobby.flush();
  await host.client.idle();
  assert.equal(lobby.purse("c1"), 500, "the table was called off");
  assert.equal(host.client.part, null);
  assert.equal(host.client.onChange, null, "the window no longer listens");
});

test("two windows at one table: the host opens it, the other sees it listed, sits down, both are in the lobby, and both play the match", async () => {
  for (const seed of [1, 2]) {
    const w = windows([["u1", "c1"], ["u2", "c2"]], { seed });
    const [host, guest] = [w.apps.get("u1"), w.apps.get("u2")];
    await play(host);
    step(host, "humans", 1);
    await host._onSit();
    await w.flush();
    assert.equal(host.screen, "lobby");
    const listed = await w.ctx("u2");
    assert.deepEqual(listed.tables.map((t) => [t.hostName, t.price, t.free]), [["Char c1", "1 gp", 1]]);
    await guest._onJoinTable(null, { dataset: { table: "T1" } });
    await w.flush();
    assert.equal(w.purse("c2"), 400);
    assert.equal(guest.screen, "lobby");
    const hostLobby = (await w.ctx("u1")).lobby;
    assert.deepEqual([hostLobby.host, hostLobby.slots.filter((s) => s.isHuman).map((s) => s.name), hostLobby.free], [true, ["Char c1", "Char c2"], 0]);
    const guestLobby = (await w.ctx("u2")).lobby;
    assert.deepEqual([guestLobby.host, guestLobby.hostName], [false, "Char c1"]);
    host._onStartTable();
    await playOut(w, ["u1", "u2"], seed);
    for (const [uid, charId] of [["u1", "c1"], ["u2", "c2"]]) {
      const ctx = await w.ctx(uid);
      assert.equal(ctx.match.over, true);
      const won = w.clients.get(uid).view.winner === uid;
      assert.equal(w.purse(charId), 400 + (won ? 100 + Math.floor(100 * 2 * 0.95) : 0), `${seed} ${uid}`);
      assert.equal(w.chat[uid].length, 1);
    }
  }
});

test("a seat that is refused is told why, and the wager comes back", async () => {
  const w = windows([["u1", "c1"], ["u2", "c2"], ["u3", "c3"]]);
  const [host, g2, g3] = ["u1", "u2", "u3"].map((u) => w.apps.get(u));
  await play(host);
  step(host, "humans", 1);
  await host._onSit();
  await w.flush();
  const stale = { ...w.clients.get("u3").tables.get("T1") };
  await g2._onJoinTable(null, { dataset: { table: "T1" } });
  await w.flush();
  w.clients.get("u3").tables.set("T1", stale);
  await g3._onJoinTable(null, { dataset: { table: "T1" } });
  await w.flush();
  assert.equal(w.purse("c3"), 500);
  assert.ok(warnings.some((m) => m === "SDE.town.games.liars.deniedFull" || m === "SDE.town.games.liars.deniedClosed"));
  assert.equal(g3.client.part, null);
  await g3._onJoinTable(null, { dataset: { table: "nope" } });
  assert.equal(warnings.at(-1), "SDE.town.games.liars.gone");
});

test("the stepper and the face buttons dial the bid at the table, and Bid places it", async () => {
  const w = windows([["u1", "c1"]], { seed: 5 });
  const app = w.apps.get("u1");
  await play(app);
  await app._onSit();
  await w.flush();
  const v = w.clients.get("u1").view;
  if (v.turn !== "u1") return;   // the house opened and it is still to move: nothing to dial
  app._onStep(null, { dataset: { by: "1" } });
  assert.deepEqual(app.pick, { qty: 2, face: 2 }, "from the smallest raise of 1 x 2s");
  app._onFace(null, { dataset: { face: "4" } });
  assert.deepEqual(app.pick, { qty: 2, face: 4 });
  app._onStep(null, { dataset: { by: "-1" } });
  app._onStep(null, { dataset: { by: "-1" } });
  assert.equal(app.pick.qty, 1, "never below one");
  app._onStep(null, { dataset: { by: "1" } });
  app._onBid();
  assert.equal(app.pick, null, "the dial resets for the next bid");
  await w.flush();
  assert.ok(w.clients.get("u1").view.log.some((e) => e.t === "bid" && e.who === "u1" && e.qty === 2 && e.face === 4));
});

test("a new round's dice tumble once, however often the window is drawn again, and a fresh table tumbles from round 1", async () => {
  const w = windows([["u1", "c1"]], { seed: 4 });
  const app = w.apps.get("u1");
  await play(app);
  await app._onSit();
  await w.flush();
  const rolled = [];
  app._tumble = () => rolled.push(app.client.view.round);
  app._onRender({}, {});
  app._onRender({}, {});
  assert.deepEqual(rolled, [app.client.view.round]);
  const view = app.client.view;
  app.client.part.view = { ...view, round: view.round + 1 };
  app._onRender({}, {});
  assert.deepEqual(rolled, [view.round, view.round + 1]);
  app.client.part.view = { ...view, round: view.round + 2, phase: "over", winner: "ai1" };
  app._onRender({}, {});
  assert.equal(rolled.length, 2, "a finished match has no new dice");
});

test("the tumble flickers each of the person's dice through other faces, settles it on its real one, and takes the class off again", () => {
  mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
  try {
    const classes = new Set();
    const dice = ["3", "1", "6"].map((face) => ({ dataset: { face }, isConnected: true }));
    const app = new TownGamesApp();
    app.element = { querySelector: () => ({ classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } }), querySelectorAll: (sel) => (sel === ".ld-you .ld-die.pips" ? dice : []) };
    app._tumble();
    assert.equal(classes.has("ld-rolling"), true);
    mock.timers.tick(100);
    assert.ok(dice.every((d) => /^[1-6]$/.test(d.dataset.face)), "only real faces are ever shown");
    mock.timers.tick(2000);
    assert.deepEqual(dice.map((d) => d.dataset.face), ["3", "1", "6"], "settled on the real faces");
    assert.equal(classes.has("ld-rolling"), false);
    const gone = { dataset: { face: "2" }, isConnected: true };
    app.element = { querySelector: () => ({ classList: { add() {}, remove() {} } }), querySelectorAll: () => [gone] };
    app._tumble();
    gone.isConnected = false;
    const shown = gone.dataset.face;
    mock.timers.tick(2000);
    assert.equal(gone.dataset.face, shown, "a die the window has drawn away is left alone");
  } finally { mock.timers.reset(); }
});

test("a player who asks the system for less motion gets no tumble", () => {
  const classes = new Set(), app = new TownGamesApp();
  globalThis.matchMedia = () => ({ matches: true });
  try {
    app.element = { querySelector: () => ({ classList: { add: (c) => classes.add(c), remove() {} } }), querySelectorAll: () => [] };
    app._tumble();
    assert.equal(classes.size, 0);
  } finally { delete globalThis.matchMedia; }
});

test("the how-to-play screen opens from the list, the set-up and the table, covers them while it is up, and gives the screen back", async () => {
  const w = windows([["u1", "c1"]], { seed: 6 });
  const app = w.apps.get("u1");
  // from the list of games: only Liar's Dice's card has the button
  let ctx = await w.ctx("u1");
  assert.deepEqual(ctx.games.filter((g) => g.rulesBtn).map((g) => g.id), ["liars"]);
  await app._onRules();
  ctx = await w.ctx("u1");
  assert.deepEqual([app.screen, ctx.isScreen, ctx.tables, ctx.match, ctx.setup], ["rules", { rules: true }, [], null, null]);
  await app._onRules();
  assert.equal(app.screen, null);
  // over the set-up
  await play(app);
  await app._onRules();
  assert.equal(app.screen, "rules");
  await app._onRules();
  assert.equal(app.screen, "setup");
  // over a match in play: the table is still there underneath, and the match goes on
  await app._onSit();
  await w.flush();
  assert.equal(app.screen, "table");
  await app._onRules();
  assert.deepEqual([app.screen, (await w.ctx("u1")).match], ["rules", null]);
  assert.equal(app.client.part.view.phase, "playing", "the table is not left by reading the rules");
  await app._onRules();
  assert.equal((await w.ctx("u1")).isScreen.table, true);
  assert.equal(w.purse("c1"), 400);
});
