/**
 * Encounter battle maps — the preload readout's Foundry-bound half
 * (scripts/encounter/battle-maps/encounter-preload.mjs), against tiny fakes of
 * game.socket, game.users, game.settings, game.scenes and the texture loader.
 *
 * What this pins:
 *   1. THE GM'S LEDGER. It expects only active non-GM players, ignores a report
 *      whose requestId it does not hold, files a report under the id the SERVER
 *      names as the sender (not the id the payload claims), and replaces a
 *      scene's readout on a restart while cancelling the old one.
 *   2. THE SETTING. Off means no request, no readout, null back.
 *   3. THE PLAYER LOOP. It reports after every file, weighs files by HEAD size,
 *      counts a failure and carries on, says done the moment the last file has
 *      finished, and stops quietly on a cancel or a newer request. It acts only
 *      on a request from a GM, never on a GM's own client. It never calls
 *      game.scenes.preload (which would wait for audio to unlock and raise a
 *      loading bar) or loader.load() (which raises the bar). It takes a
 *      request once: the same one delivered twice (live, then replayed by
 *      Foundry) is one loop, an older one replayed after a newer one does not
 *      take its place, and a repeat of a finished one is answered with how it
 *      ended, not run again.
 *   4. WHO IS ASKED. A player who disconnects stops being waited on; one who
 *      connects mid-preload, or comes back, is added and asked, alone. The
 *      userConnected hook is held only while a preload runs.
 *   5. THE ROUND TRIP. The exact payloads a player emits walk the GM's ledger to
 *      "ready".
 *
 * Not covered here, because it needs real clients on a real server: that
 * `(payload, senderId)` really reaches the listener (read in
 * dist/server/sockets.mjs, not run), that a player's game.scenes holds a scene
 * the moment the request lands, and the real loader's timing.
 */
import test, { describe, mock } from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import { SETTINGS, SOCKET, SOCKET_ACTIONS } from "../scripts/encounter/battle-maps/constants.mjs";
import {
  describeSnapshot,
  onPreloadChange,
  preloadSnapshot,
  registerPreloadSocket,
  startPreload,
  stopPreload,
} from "../scripts/encounter/battle-maps/encounter-preload.mjs";
import { DEFAULT_STALL_MS } from "../scripts/encounter/battle-maps/encounter-preload-core.mjs";

const GM = { id: "gm1", name: "Gamemaster", isGM: true, active: true };
const BRIDGE = { id: "bridge", name: "Bridge", isGM: true, active: true };
const VELLA = { id: "p1", name: "Vella", isGM: false, active: true };
const TOBIN = { id: "p2", name: "Tobin", isGM: false, active: true };
const AWAY = { id: "p3", name: "Away", isGM: false, active: false };
const USERS = [GM, BRIDGE, VELLA, TOBIN, AWAY];

const ORIGIN = "http://localhost:30000";
const flush = () => new Promise((resolve) => setImmediate(resolve));

let requestCounter = 0;

/**
 * One registry of hooks for the whole file: the module hooks in under one
 * `installClient`'s fake `Hooks` and may take the hook off under the next one's.
 */
const hookRegistry = new Map();
let hookCounter = 0;
const fakeHooks = {
  on: (name, fn) => { hookRegistry.set(++hookCounter, { name, fn }); return hookCounter; },
  off: (name, id) => { if (hookRegistry.get(id)?.name === name) hookRegistry.delete(id); },
};
const hooksOn = (name) => [...hookRegistry.values()].filter((hook) => hook.name === name).length;
const fireHook = (name, ...args) => { for (const hook of [...hookRegistry.values()]) if (hook.name === name) hook.fn(...args); };

/**
 * Install a fake client for `user` and register the module's listener on its
 * socket. Each call is a fresh socket, so each registers afresh (the module
 * remembers sockets, not a flag). The module's own state (the GM's readouts, a
 * player's running job) carries over between worlds, as it would in one tab, so
 * tests use their own scene ids and stop what they start.
 *
 * @param {object} options
 * @param {object} options.user                 who this client is
 * @param {boolean} [options.setting=true]      the preload world setting
 * @param {object} [options.scenes={}]          sceneId -> scene data this client holds
 * @param {object} [options.sizes={}]           src -> Content-Length, or "error" / "none" / "404"
 * @param {Function} [options.load]             (src) => result of loadTexture; default resolves a texture
 * @param {object} [options.mod]                A fresh copy of the module, to stand for another page (see `freshPage`)
 */
function installClient({ user, setting = true, scenes = {}, sizes = {}, load = async () => ({ valid: true }), mod }) {
  const emitted = [];
  const handlers = [];
  const log = [];
  const gauge = { active: 0, peak: 0 };
  globalThis.location = { origin: ORIGIN, href: `${ORIGIN}/game` };
  globalThis.game = {
    user,
    users: { filter: (fn) => USERS.filter(fn), get: (id) => USERS.find((u) => u.id === id) },
    settings: {
      get: (module, key) => {
        assert.equal(module, MODULE_ID);
        assert.equal(key, SETTINGS.preload);
        return setting;
      },
    },
    socket: {
      on: (event, fn) => { assert.equal(event, SOCKET); handlers.push(fn); },
      emit: (event, payload, options) => emitted.push({ event, payload, options }),
    },
    scenes: {
      get: (id) => scenes[id] ?? null,
      // The player loop must never call this: it also waits for the playlist sound, which waits for the first click.
      preload: (id) => { log.push(`preload:${id}`); throw new Error("game.scenes.preload must not be called"); },
    },
  };
  globalThis.Hooks = fakeHooks;
  // Anything the table can see: the module has no business raising a notification while it loads quietly.
  globalThis.ui = { notifications: { info: () => log.push("notify:info"), warn: () => log.push("notify:warn"), error: () => log.push("notify:error") } };
  globalThis.foundry = {
    utils: {
      randomID: () => `req${++requestCounter}`,
      fetchWithTimeout: async (src, init, options) => {
        log.push(`head:${src}`);
        assert.equal(init.method, "HEAD");
        assert.equal(options.timeoutMs, 5000);
        const size = sizes[src];
        if (size === "error") throw new Error("timed out");
        // An error page has a Content-Length too: it must not be taken for the file's size.
        if (size === "404") return { ok: false, headers: { get: () => "512" } };
        if (size === "none" || size === undefined) return { ok: true, headers: { get: () => null } };
        return { ok: true, headers: { get: (name) => (name === "content-length" ? String(size) : null) } };
      },
    },
    canvas: {
      TextureLoader: {
        loader: {
          // What Scenes#preload ends in: it raises the "Loading <scene>" progress notification.
          load: async () => { log.push("loader.load()"); globalThis.ui.notifications.info("Loading", { progress: true }); },
          loadTexture: async (src) => {
            gauge.active++;
            gauge.peak = Math.max(gauge.peak, gauge.active);
            log.push(`load:${src}`);
            try {
              await flush();
              return await load(src);
            } finally {
              gauge.active--;
            }
          },
        },
      },
    },
  };
  (mod?.registerPreloadSocket ?? registerPreloadSocket)();
  return {
    emitted,
    log,
    gauge,
    handlers,
    /** Hand the listener a message the way the server would: `(payload, senderId)`. */
    deliver: (payload, senderId) => handlers[0](payload, senderId),
    progress: () => emitted.filter((e) => e.payload.action === SOCKET_ACTIONS.progress),
  };
}

/** Silence console.warn for one test (the module logs what it swallows) and hand back the spy. */
function muteWarnings(t) {
  const spy = mock.method(console, "warn", () => {});
  t.after(() => spy.mock.restore());
  return spy;
}

/**
 * A request as a GM's client sends it. Each call gets an id of its own: a page takes a request once, and the
 * tests share one copy of the module, so a fixed id would be a repeat of the last test's.
 */
let requestSerial = 0;
const request = (over = {}) => ({ action: SOCKET_ACTIONS.preload, requestId: `ask${++requestSerial}`, sceneId: "sc", gmId: GM.id, ...over });
const cancelOf = (req, over = {}) => ({ action: SOCKET_ACTIONS.cancel, requestId: req.requestId, sceneId: req.sceneId, gmId: GM.id, ...over });

/** Another copy of the module, with a memory of its own: another browser page. */
let pageSerial = 0;
const freshPage = () => import(`../scripts/encounter/battle-maps/encounter-preload.mjs?page=${++pageSerial}`);

const report = (requestId, over = {}) => ({
  action: SOCKET_ACTIONS.progress, requestId, sceneId: "sc", userId: VELLA.id,
  loaded: 0, failed: 0, total: 4, weightLoaded: 0, weightTotal: 0, done: false, ...over,
});

const rowOf = (sceneId, userId) => preloadSnapshot(sceneId).rows.find((r) => r.userId === userId);

describe("GM: starting a preload", () => {
  test("with the setting off nothing is sent, nothing is kept, and null comes back", async () => {
    const w = installClient({ user: GM, setting: false });
    assert.equal(await startPreload({ id: "off-scene" }), null);
    assert.deepEqual(w.emitted, []);
    assert.equal(preloadSnapshot("off-scene"), null);
  });

  test("a player's client cannot start one", async () => {
    const w = installClient({ user: VELLA });
    assert.equal(await startPreload({ id: "player-scene" }), null);
    assert.deepEqual(w.emitted, []);
  });

  test("a scene without an id is refused", async () => {
    const w = installClient({ user: GM });
    assert.equal(await startPreload(null), null);
    assert.equal(await startPreload({}), null);
    assert.deepEqual(w.emitted, []);
  });

  test("it waits for the active players only, asks only them, and every row starts waiting", async (t) => {
    const w = installClient({ user: GM });
    const started = await startPreload({ id: "start-scene" });
    t.after(() => stopPreload("start-scene"));

    assert.deepEqual(started.expected, [{ userId: "p1", name: "Vella" }, { userId: "p2", name: "Tobin" }],
      "no GM (the Bridge included), and nobody who is not connected");
    assert.equal(w.emitted.length, 1);
    const [sent] = w.emitted;
    assert.equal(sent.event, SOCKET);
    assert.deepEqual(sent.payload, {
      action: SOCKET_ACTIONS.preload, requestId: started.requestId, sceneId: "start-scene", gmId: "gm1",
    });
    assert.deepEqual(sent.options, { recipients: ["p1", "p2"] });

    const snap = preloadSnapshot("start-scene");
    assert.equal(snap.sceneId, "start-scene");
    assert.deepEqual(snap.rows.map((r) => [r.userId, r.state]), [["p1", "waiting"], ["p2", "waiting"]]);
    assert.equal(snap.ready, 0);
    assert.equal(snap.expected, 2);
    assert.equal(snap.allReady, false);
    assert.equal(typeof snap.startedAt, "number");
  });

  test("with nobody connected the readout exists, empty, and is not 'ready'", async (t) => {
    installClient({ user: GM });
    const original = USERS.map((u) => u.active);
    VELLA.active = false;
    TOBIN.active = false;
    t.after(() => { USERS.forEach((u, i) => { u.active = original[i]; }); stopPreload("empty-scene"); });
    const started = await startPreload({ id: "empty-scene" });
    assert.deepEqual(started.expected, []);
    const snap = preloadSnapshot("empty-scene");
    assert.deepEqual(snap.rows, []);
    assert.equal(snap.allReady, false);
    assert.deepEqual(describeSnapshot(snap).readyLabelArgs, { ready: 0, expected: 0 });
  });
});

describe("GM: reading the players' reports", () => {
  test("a report moves its sender's row, by bytes when it has them", async (t) => {
    const w = installClient({ user: GM });
    const { requestId } = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));

    w.deliver(report(requestId, { loaded: 1, total: 4, weightLoaded: 900, weightTotal: 1000 }), VELLA.id);
    assert.deepEqual(rowOf("sc", "p1"), { userId: "p1", name: "Vella", state: "loading", loaded: 1, total: 4, failed: 0, pct: 0.9 });
    assert.equal(rowOf("sc", "p2").state, "waiting");
  });

  test("a report whose requestId it does not hold is ignored and does not even ring the bell", async (t) => {
    const w = installClient({ user: GM });
    const { requestId } = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));
    const seen = [];
    const off = onPreloadChange((snap) => seen.push(snap));
    t.after(off);

    w.deliver(report("not-a-request", { loaded: 4, done: true }), VELLA.id);
    w.deliver({ action: SOCKET_ACTIONS.progress, userId: VELLA.id, loaded: 4, done: true }, VELLA.id);
    assert.equal(rowOf("sc", "p1").state, "waiting");
    assert.deepEqual(seen, []);

    w.deliver(report(requestId, { loaded: 1 }), VELLA.id);
    assert.equal(rowOf("sc", "p1").state, "loading");
    assert.equal(seen.length, 1);
  });

  test("the row is the one the SERVER names as sender: a payload claiming another player moves nothing of theirs", async (t) => {
    const w = installClient({ user: GM });
    const { requestId } = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));

    // Vella's client sends a report that says it is Tobin's, and finished.
    w.deliver(report(requestId, { userId: TOBIN.id, loaded: 4, total: 4, done: true }), VELLA.id);
    assert.equal(rowOf("sc", "p1").state, "ready", "filed under the real sender");
    assert.equal(rowOf("sc", "p2").state, "waiting", "the claimed identity bought nothing");
  });

  test("a sender who was not expected, a GM's tab for one, gets no row", async (t) => {
    const w = installClient({ user: GM });
    const { requestId } = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));

    w.deliver(report(requestId, { userId: VELLA.id, loaded: 4, done: true }), BRIDGE.id);
    w.deliver(report(requestId, { userId: VELLA.id, loaded: 4, done: true }), AWAY.id);
    assert.deepEqual(preloadSnapshot("sc").rows.map((r) => r.state), ["waiting", "waiting"]);
  });

  test("if the server's sender id were ever missing, the payload's userId is the fallback", async (t) => {
    const w = installClient({ user: GM });
    const { requestId } = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));

    w.deliver(report(requestId, { userId: TOBIN.id, loaded: 1 }));
    assert.equal(rowOf("sc", "p2").state, "loading");
  });

  test("allReady turns true when every expected player has finished clean", async (t) => {
    const w = installClient({ user: GM });
    const { requestId } = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));

    w.deliver(report(requestId, { loaded: 4, done: true }), VELLA.id);
    assert.equal(preloadSnapshot("sc").allReady, false);
    w.deliver(report(requestId, { loaded: 4, done: true }), TOBIN.id);
    const snap = preloadSnapshot("sc");
    assert.equal(snap.allReady, true);
    assert.deepEqual(describeSnapshot(snap), { readyLabelArgs: { ready: 2, expected: 2 }, pending: [], tone: "ready" });
  });

  test("a player who finished with a failed file keeps it from going green", async (t) => {
    const w = installClient({ user: GM });
    const { requestId } = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));

    w.deliver(report(requestId, { loaded: 4, done: true }), VELLA.id);
    w.deliver(report(requestId, { loaded: 3, failed: 1, done: true }), TOBIN.id);
    const snap = preloadSnapshot("sc");
    assert.equal(snap.allReady, false);
    assert.deepEqual(snap.rows.map((r) => r.state), ["ready", "failed"]);
    assert.deepEqual(describeSnapshot(snap).pending, ["Tobin"]);
  });
});

describe("GM: restarting and stopping", () => {
  test("a second start for the same scene cancels the first, and the first's reports stop counting", async (t) => {
    const w = installClient({ user: GM });
    const first = await startPreload({ id: "sc" });
    w.deliver(report(first.requestId, { loaded: 2 }), VELLA.id);
    const second = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));

    assert.notEqual(second.requestId, first.requestId);
    assert.deepEqual(w.emitted.map((e) => [e.payload.action, e.payload.requestId]), [
      [SOCKET_ACTIONS.preload, first.requestId],
      [SOCKET_ACTIONS.cancel, first.requestId],
      [SOCKET_ACTIONS.preload, second.requestId],
    ]);
    assert.deepEqual(w.emitted[1].options, { recipients: ["p1", "p2"] });
    assert.deepEqual(preloadSnapshot("sc").rows.map((r) => r.state), ["waiting", "waiting"], "a fresh ledger");

    w.deliver(report(first.requestId, { loaded: 4, done: true }), VELLA.id);
    assert.equal(rowOf("sc", "p1").state, "waiting", "the old request is unknown now");
    w.deliver(report(second.requestId, { loaded: 4, done: true }), VELLA.id);
    assert.equal(rowOf("sc", "p1").state, "ready");
  });

  test("scenes keep separate readouts", async (t) => {
    const w = installClient({ user: GM });
    const a = await startPreload({ id: "scene-a" });
    const b = await startPreload({ id: "scene-b" });
    t.after(() => { stopPreload("scene-a"); stopPreload("scene-b"); });

    w.deliver(report(a.requestId, { loaded: 4, done: true }), VELLA.id);
    assert.equal(rowOf("scene-a", "p1").state, "ready");
    assert.equal(rowOf("scene-b", "p1").state, "waiting");
    w.deliver(report(b.requestId, { loaded: 1 }), VELLA.id);
    assert.equal(rowOf("scene-b", "p1").state, "loading");
  });

  test("stopping tells the players to stop, drops the readout and says so; stopping twice is quiet", async () => {
    const w = installClient({ user: GM });
    const { requestId } = await startPreload({ id: "sc" });
    const seen = [];
    const off = onPreloadChange((snap, sceneId) => seen.push([snap, sceneId]));

    stopPreload("sc");
    off();
    assert.equal(preloadSnapshot("sc"), null);
    assert.deepEqual(seen, [[null, "sc"]]);
    const cancel = w.emitted.at(-1);
    assert.deepEqual(cancel.payload, { action: SOCKET_ACTIONS.cancel, requestId, sceneId: "sc", gmId: "gm1" });
    assert.deepEqual(cancel.options, { recipients: ["p1", "p2"] });

    const sent = w.emitted.length;
    stopPreload("sc");
    stopPreload("never-started");
    assert.equal(w.emitted.length, sent);
  });

  test("after a stop, a late report from a player is just ignored", async () => {
    const w = installClient({ user: GM });
    const { requestId } = await startPreload({ id: "sc" });
    stopPreload("sc");
    w.deliver(report(requestId, { loaded: 4, done: true }), VELLA.id);
    assert.equal(preloadSnapshot("sc"), null);
  });
});

describe("GM: the readout subscription", () => {
  test("fires on a start, on every report that moves a row, and not on a repeat", async (t) => {
    const w = installClient({ user: GM });
    const seen = [];
    t.after(onPreloadChange((snap, sceneId) => seen.push([sceneId, snap?.rows.map((r) => r.state).join()])));
    const { requestId } = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));

    w.deliver(report(requestId, { loaded: 1 }), VELLA.id);
    w.deliver(report(requestId, { loaded: 1 }), VELLA.id);
    w.deliver(report(requestId, { loaded: 2 }), VELLA.id);
    assert.deepEqual(seen, [
      ["sc", "waiting,waiting"],
      ["sc", "loading,waiting"],
      ["sc", "loading,waiting"],
    ]);
  });

  test("unsubscribing stops it, and a listener that throws does not stop the others", async (t) => {
    const w = installClient({ user: GM });
    const { requestId } = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));
    const calls = { gone: 0, steady: 0 };
    const offGone = onPreloadChange(() => { calls.gone++; });
    t.after(onPreloadChange(() => { throw new Error("a bad window"); }));
    t.after(onPreloadChange(() => { calls.steady++; }));
    muteWarnings(t); // registered last, so lifted last: the stop above still reaches the bad listener

    w.deliver(report(requestId, { loaded: 1 }), VELLA.id);
    offGone();
    w.deliver(report(requestId, { loaded: 2 }), VELLA.id);
    assert.deepEqual(calls, { gone: 1, steady: 2 });
  });

  test("a quiet loading row shows as stalled on the timer, and the timer then rests", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_700_000_000_000 });
    const w = installClient({ user: GM });
    const states = [];
    t.after(onPreloadChange((snap) => states.push(snap?.rows.map((r) => r.state).join())));
    const { requestId } = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));
    w.deliver(report(requestId, { loaded: 1 }), VELLA.id);
    assert.equal(states.at(-1), "loading,waiting");

    t.mock.timers.tick(DEFAULT_STALL_MS + 10_000);
    assert.equal(states.at(-1), "stalled,waiting", "a silent client sent nothing, so only the timer could say so");

    const rang = states.length;
    t.mock.timers.tick(5 * 60_000);
    assert.equal(states.length, rang, "nobody is loading, so the timer is off");
  });

  test("a client that keeps reporting is never called stalled, however long the load takes", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_700_000_000_000 });
    const w = installClient({ user: GM });
    const states = [];
    t.after(onPreloadChange((snap) => states.push(snap?.rows.map((r) => r.state).join())));
    const { requestId } = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));
    for (let n = 1; n <= 6; n++) {
      t.mock.timers.tick(30_000);
      w.deliver(report(requestId, { loaded: n, total: 8 }), VELLA.id);
    }
    assert.ok(states.length > 6, "the timer rang between reports");
    assert.ok(states.every((s) => !s.includes("stalled")), states.join(" | "));
    assert.equal(rowOf("sc", "p1").state, "loading");
  });
});

describe("GM: players coming and going", () => {
  const states = (sceneId) => preloadSnapshot(sceneId).rows.map((r) => [r.userId, r.state]);

  test("it listens for people coming and going only while a preload runs, and only once", async () => {
    installClient({ user: GM });
    assert.equal(hooksOn("userConnected"), 0);
    await startPreload({ id: "scene-a" });
    assert.equal(hooksOn("userConnected"), 1);
    await startPreload({ id: "scene-b" });
    assert.equal(hooksOn("userConnected"), 1, "one hook for any number of preloads");
    await startPreload({ id: "scene-a" });
    assert.equal(hooksOn("userConnected"), 1, "a restart replaces a preload, it does not stack a hook");
    stopPreload("scene-a");
    assert.equal(hooksOn("userConnected"), 1, "scene-b is still running");
    stopPreload("scene-b");
    assert.equal(hooksOn("userConnected"), 0, "released with the last");
    stopPreload("scene-b");
    assert.equal(hooksOn("userConnected"), 0);

    await startPreload({ id: "scene-a" });
    assert.equal(hooksOn("userConnected"), 1, "and taken again by the next");
    stopPreload("scene-a");
    assert.equal(hooksOn("userConnected"), 0);
  });

  test("a preload that never started takes no hook", async () => {
    installClient({ user: GM, setting: false });
    assert.equal(await startPreload({ id: "scene-a" }), null);
    assert.equal(hooksOn("userConnected"), 0);
  });

  test("once the last preload has stopped, someone connecting asks nothing of anybody", async () => {
    const w = installClient({ user: GM });
    await startPreload({ id: "sc" });
    stopPreload("sc");
    const sent = w.emitted.length;
    fireHook("userConnected", AWAY, true);
    assert.equal(w.emitted.length, sent);
    assert.equal(preloadSnapshot("sc"), null);
  });

  test("a player who disconnects stops being waited on, and the table can go green without them", async (t) => {
    const w = installClient({ user: GM });
    const { requestId } = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));
    w.deliver(report(requestId, { loaded: 4, done: true }), VELLA.id);
    assert.equal(preloadSnapshot("sc").allReady, false, "Tobin has not reported");

    fireHook("userConnected", TOBIN, false);
    const snap = preloadSnapshot("sc");
    assert.deepEqual(states("sc"), [["p1", "ready"], ["p2", "left"]]);
    assert.deepEqual([snap.ready, snap.expected, snap.allReady], [1, 1, true]);
    assert.deepEqual(describeSnapshot(snap), { readyLabelArgs: { ready: 1, expected: 1 }, pending: [], tone: "ready" });
  });

  test("when everyone has left nothing is ready", async (t) => {
    installClient({ user: GM });
    await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));
    fireHook("userConnected", VELLA, false);
    fireHook("userConnected", TOBIN, false);
    const snap = preloadSnapshot("sc");
    assert.deepEqual([snap.ready, snap.expected, snap.allReady], [0, 0, false]);
    assert.deepEqual(snap.rows.map((r) => r.state), ["left", "left"]);
  });

  test("a report from a player who has left is ignored", async (t) => {
    const w = installClient({ user: GM });
    const { requestId } = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));
    fireHook("userConnected", TOBIN, false);
    w.deliver(report(requestId, { loaded: 4, done: true }), TOBIN.id);
    assert.equal(rowOf("sc", "p2").state, "left");
  });

  test("a player who connects after the start is added and sent the request, to them alone", async (t) => {
    const w = installClient({ user: GM });
    const started = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));
    const sent = w.emitted.length;

    fireHook("userConnected", AWAY, true);
    assert.equal(w.emitted.length, sent + 1);
    const asked = w.emitted.at(-1);
    assert.deepEqual(asked.payload, { action: SOCKET_ACTIONS.preload, requestId: started.requestId, sceneId: "sc", gmId: "gm1" });
    assert.deepEqual(asked.options, { recipients: ["p3"] });
    assert.deepEqual(states("sc"), [["p1", "waiting"], ["p2", "waiting"], ["p3", "waiting"]]);
    assert.equal(preloadSnapshot("sc").expected, 3);

    w.deliver(report(started.requestId, { loaded: 2 }), AWAY.id);
    assert.equal(rowOf("sc", "p3").state, "loading", "and what they report counts");
  });

  test("a player who comes back gets a clean row and a fresh request", async (t) => {
    const w = installClient({ user: GM });
    const started = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));
    w.deliver(report(started.requestId, { loaded: 3, total: 4 }), TOBIN.id);
    assert.equal(rowOf("sc", "p2").state, "loading");

    fireHook("userConnected", TOBIN, false);
    assert.equal(rowOf("sc", "p2").state, "left");
    const sent = w.emitted.length;
    fireHook("userConnected", TOBIN, true);
    assert.deepEqual(rowOf("sc", "p2"), { userId: "p2", name: "Tobin", state: "waiting", loaded: 0, total: 0, failed: 0, pct: 0 },
      "their old progress died with their page");
    assert.deepEqual(states("sc"), [["p1", "waiting"], ["p2", "waiting"]], "back where they were in the table");
    assert.equal(w.emitted.length, sent + 1);
    assert.deepEqual(w.emitted.at(-1).options, { recipients: ["p2"] });
    assert.equal(w.emitted.at(-1).payload.requestId, started.requestId);
  });

  test("a player who is already here connecting again changes nothing", async (t) => {
    const w = installClient({ user: GM });
    const started = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));
    w.deliver(report(started.requestId, { loaded: 2 }), VELLA.id);
    const seen = [];
    t.after(onPreloadChange((snap) => seen.push(snap)));
    const sent = w.emitted.length;

    fireHook("userConnected", VELLA, true);
    assert.equal(w.emitted.length, sent);
    assert.deepEqual(seen, []);
    assert.equal(rowOf("sc", "p1").state, "loading");
  });

  test("a GM coming or going changes nothing", async (t) => {
    const w = installClient({ user: GM });
    await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));
    const sent = w.emitted.length;
    fireHook("userConnected", BRIDGE, false);
    fireHook("userConnected", BRIDGE, true);
    fireHook("userConnected", GM, true);
    assert.equal(w.emitted.length, sent);
    assert.deepEqual(states("sc"), [["p1", "waiting"], ["p2", "waiting"]]);
  });

  test("every running preload hears about it, and each asks with its own request", async (t) => {
    const w = installClient({ user: GM });
    const a = await startPreload({ id: "scene-a" });
    const b = await startPreload({ id: "scene-b" });
    t.after(() => { stopPreload("scene-a"); stopPreload("scene-b"); });
    const sent = w.emitted.length;

    fireHook("userConnected", AWAY, true);
    const asked = w.emitted.slice(sent).map((e) => [e.payload.sceneId, e.payload.requestId, e.options.recipients.join()]);
    assert.deepEqual(asked, [["scene-a", a.requestId, "p3"], ["scene-b", b.requestId, "p3"]]);

    fireHook("userConnected", VELLA, false);
    assert.equal(rowOf("scene-a", "p1").state, "left");
    assert.equal(rowOf("scene-b", "p1").state, "left");
  });

  test("the readout's listeners are told when someone comes or goes", async (t) => {
    installClient({ user: GM });
    await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));
    const seen = [];
    t.after(onPreloadChange((snap, sceneId) => seen.push([sceneId, snap?.rows.map((r) => r.state).join()])));

    fireHook("userConnected", TOBIN, false);
    fireHook("userConnected", AWAY, true);
    fireHook("userConnected", TOBIN, true);
    assert.deepEqual(seen, [
      ["sc", "waiting,left"],
      ["sc", "waiting,left,waiting"],
      ["sc", "waiting,waiting,waiting"],
    ]);
  });

  test("the cancel reaches a player who joined late", async () => {
    const w = installClient({ user: GM });
    await startPreload({ id: "sc" });
    fireHook("userConnected", AWAY, true);
    stopPreload("sc");
    const cancel = w.emitted.at(-1);
    assert.equal(cancel.payload.action, SOCKET_ACTIONS.cancel);
    assert.deepEqual(cancel.options, { recipients: ["p1", "p2", "p3"] });
  });
});

describe("registering the listener", () => {
  test("registering twice on one socket adds one listener", () => {
    const w = installClient({ user: GM });
    registerPreloadSocket();
    registerPreloadSocket();
    assert.equal(w.handlers.length, 1);
  });

  test("it ignores messages that are not its own", () => {
    const w = installClient({ user: GM });
    for (const msg of [null, undefined, "x", {}, { action: "downtime:sync" }, { type: "state" }]) {
      assert.equal(w.deliver(msg, "p1"), undefined);
    }
    assert.deepEqual(w.emitted, []);
  });
});

const arena = {
  id: "sc",
  levels: [{ background: { src: "modules/shadowdark-enhancer/assets/scenes/encounter/arena.webp" } }],
  tiles: [],
  tokens: [
    { texture: { src: "tokens/orc.webp" } },
    { texture: { src: "https://cdn.example.com/elf.webp" } },
  ],
};
const MAP = arena.levels[0].background.src;

describe("player: the loading loop", () => {
  test("opens, reports after every file, then says it is done", async () => {
    const w = installClient({ user: VELLA, scenes: { sc: arena }, sizes: { [MAP]: 8000, "tokens/orc.webp": 2000 } });
    const req = request();
    await w.deliver(req, GM.id);

    const sent = w.progress();
    assert.ok(sent.every((e) => e.event === SOCKET && e.options.recipients.join() === "gm1"), "to the starting GM only");
    assert.ok(sent.every((e) => e.payload.requestId === req.requestId && e.payload.sceneId === "sc" && e.payload.userId === "p1"));
    assert.deepEqual(sent.map((e) => e.payload.loaded), [0, 1, 2, 3, 3]);
    assert.deepEqual(sent.map((e) => e.payload.done), [false, false, false, false, true]);
    assert.equal(sent.length, 3 + 2, "one per file, plus the opening report and the closing one");

    const first = sent[0].payload;
    assert.equal(first.total, 3);
    assert.equal(first.weightTotal, 8000 + 2000 + 5000, "the cross-origin file weighs the mean of the known sizes");
    assert.equal(sent.at(-1).payload.weightLoaded, 15000);
    assert.equal(sent.at(-1).payload.failed, 0);
  });

  test("HEADs only same-origin files, and knows every size before its opening report", async () => {
    const w = installClient({ user: VELLA, scenes: { sc: arena } });
    await w.deliver(request(), GM.id);

    assert.deepEqual(w.log.filter((l) => l.startsWith("head:")).sort(), [`head:${MAP}`, "head:tokens/orc.webp"].sort());
    assert.equal(w.log.filter((l) => l.startsWith("load:")).length, 3);
    assert.ok(w.log.lastIndexOf(`head:${MAP}`) < w.log.indexOf(`load:${MAP}`), "sizes are known before the bar starts");
  });

  test("never has more than two files loading at once", async () => {
    const many = {
      id: "sc",
      levels: [],
      tiles: [],
      tokens: Array.from({ length: 9 }, (_, i) => ({ texture: { src: `tokens/t${i}.webp` } })),
    };
    const w = installClient({ user: VELLA, scenes: { sc: many } });
    await w.deliver(request(), GM.id);
    assert.equal(w.gauge.peak, 2);
    assert.equal(w.progress().at(-1).payload.loaded, 9);
  });

  test("a file that throws, and one that comes back invalid, are counted and reported, never thrown", async (t) => {
    const warn = muteWarnings(t);
    const w = installClient({
      user: VELLA,
      scenes: { sc: arena },
      load: async (src) => {
        if (src === "tokens/orc.webp") throw new Error("404");
        if (src.startsWith("https://")) return null;
        return { valid: true };
      },
    });
    await assert.doesNotReject(async () => w.deliver(request(), GM.id));

    const last = w.progress().at(-1).payload;
    assert.equal(last.done, true);
    assert.equal(last.loaded, 1);
    assert.equal(last.failed, 2);
    assert.equal(last.total, 3);
    assert.equal(last.weightLoaded, last.weightTotal, "failed files still finish the bar");
    assert.ok(warn.mock.callCount() >= 1);
  });

  test("a HEAD that fails, times out or has no length just means no weight", async () => {
    const w = installClient({
      user: VELLA,
      scenes: { sc: arena },
      sizes: { [MAP]: "error", "tokens/orc.webp": "404" },
    });
    await w.deliver(request(), GM.id);
    const open = w.progress()[0].payload;
    assert.equal(open.weightTotal, 3, "no sizes anywhere: every file weighs 1");
    assert.equal(w.progress().at(-1).payload.done, true);
  });

  test("a scene with nothing to fetch still finishes", async () => {
    const w = installClient({ user: VELLA, scenes: { sc: { id: "sc", levels: [], tiles: [], tokens: [] } } });
    await w.deliver(request(), GM.id);
    const sent = w.progress().map((e) => e.payload);
    assert.deepEqual(sent.map((p) => [p.total, p.loaded, p.done]), [[0, 0, false], [0, 0, true]]);
    assert.deepEqual(w.log, []);
  });

  test("says done when the last file has finished, without asking Foundry to preload the scene", async () => {
    const w = installClient({ user: VELLA, scenes: { sc: arena } });
    await w.deliver(request(), GM.id);
    const last = w.progress().at(-1).payload;
    assert.equal(last.done, true);
    assert.equal(last.failed, 0);
    assert.deepEqual(w.log.filter((l) => l.startsWith("preload:")), []);
  });

  test("a scene with a playlist cannot hold it up: Foundry's scene preload would wait for audio to unlock", async () => {
    // Scenes#preload also preloads the scene's playlist sound, and Sound#load waits for the first click or key press.
    const w = installClient({ user: VELLA, scenes: { sc: arena } });
    globalThis.game.scenes.preload = (id) => { w.log.push(`preload:${id}`); return new Promise(() => {}); };
    const hung = new Promise((resolve) => { setTimeout(() => resolve("hung"), 500).unref(); });
    const outcome = await Promise.race([w.deliver(request(), GM.id).then(() => "finished"), hung]);
    assert.equal(outcome, "finished");
    assert.equal(w.progress().at(-1).payload.done, true);
  });

  test("nothing it does raises Foundry's loading bar on the player's screen", async () => {
    // loader.load() (what Scenes#preload ends in) shows "Loading <scene>"; loader.loadTexture shows nothing.
    const w = installClient({ user: VELLA, scenes: { sc: arena } });
    await w.deliver(request(), GM.id);
    assert.deepEqual(w.log.filter((l) => l === "loader.load()" || l.startsWith("notify:")), []);
  });

  test("a scene that never reaches this client is reported failed, after a short wait", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const warn = muteWarnings(t);
    const w = installClient({ user: VELLA, scenes: {} });
    const job = w.deliver(request(), GM.id);
    for (let i = 0; i < 20; i++) {
      await flush();
      t.mock.timers.tick(250);
    }
    await job;
    const sent = w.progress().map((e) => e.payload);
    assert.equal(sent.length, 1);
    assert.deepEqual([sent[0].failed, sent[0].total, sent[0].done], [1, 1, true]);
    assert.deepEqual(w.log, [], "nothing was loaded");
    assert.equal(warn.mock.callCount(), 1, "and the reason is in the console");
  });

  test("a scene that arrives a moment late is found", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const scenes = {};
    const w = installClient({ user: VELLA, scenes });
    const job = w.deliver(request(), GM.id);
    await flush(); // the first look found nothing, and the loop is asleep on a (mocked) timer
    scenes.sc = arena; // the document lands
    t.mock.timers.tick(250);
    await job;
    const last = w.progress().at(-1).payload;
    assert.deepEqual([last.failed, last.loaded, last.done], [0, 3, true]);
  });
});

describe("player: whose request it will act on", () => {
  const untouched = (w) => {
    assert.deepEqual(w.emitted, []);
    assert.deepEqual(w.log, []);
  };

  test("a GM's own client (the Bridge too) does not preload", async () => {
    const w = installClient({ user: BRIDGE, scenes: { sc: arena } });
    await w.deliver(request(), GM.id);
    untouched(w);
  });

  test("with the setting off a player does nothing", async () => {
    const w = installClient({ user: VELLA, setting: false, scenes: { sc: arena } });
    await w.deliver(request(), GM.id);
    untouched(w);
  });

  test("a request that came from another player is ignored, whoever it names as the GM", async () => {
    const w = installClient({ user: VELLA, scenes: { sc: arena } });
    await w.deliver(request({ gmId: GM.id }), TOBIN.id);
    untouched(w);
  });

  test("the progress goes to the GM who sent it, not to whoever the payload names", async () => {
    const w = installClient({ user: VELLA, scenes: { sc: arena } });
    await w.deliver(request({ gmId: BRIDGE.id }), GM.id);
    assert.ok(w.progress().length > 0);
    assert.ok(w.progress().every((e) => e.options.recipients.join() === "gm1"));
  });

  test("a request with no usable ids is ignored", async () => {
    const w = installClient({ user: VELLA, scenes: { sc: arena } });
    await w.deliver(request({ requestId: undefined }), GM.id);
    await w.deliver(request({ sceneId: 12 }), GM.id);
    untouched(w);
  });

  test("if the server's sender id were ever missing, the payload's gmId is the fallback, and must be a GM", async () => {
    const w = installClient({ user: VELLA, scenes: { sc: arena } });
    await w.deliver(request({ gmId: TOBIN.id }));
    untouched(w);
    await w.deliver(request({ gmId: GM.id }));
    assert.equal(w.progress().at(-1).payload.done, true);
  });
});

/** A loader that holds every file until the test opens it, so a job can be caught mid-way. */
function gatedLoader() {
  let open = false;
  const waiting = [];
  return {
    load: () => (open ? Promise.resolve({ valid: true }) : new Promise((resolve) => waiting.push(resolve))),
    open: () => {
      open = true;
      for (const resolve of waiting.splice(0)) resolve({ valid: true });
    },
  };
}

/** Start a job and let it reach the point where its opening report is out and its first files wait at the gate. */
async function heldJob(w, over = {}) {
  const req = request(over);
  const job = w.deliver(req, GM.id);
  await flush();
  await flush();
  return { job, req }; // an object, not `job` alone: an async function would wait for it, and the gate is shut
}

describe("player: cancel and replace", () => {
  test("a cancel from the GM stops the loop: no more reports and no final one", async () => {
    const gate = gatedLoader();
    const w = installClient({ user: VELLA, scenes: { sc: arena }, load: gate.load });
    const { job, req } = await heldJob(w);
    assert.equal(w.progress().length, 1, "only the opening report so far");

    w.deliver(cancelOf(req), GM.id);
    gate.open();
    await job;
    assert.equal(w.progress().length, 1);
    assert.equal(w.progress().some((e) => e.payload.done), false);
  });

  test("a cancel for another request, or from a player, changes nothing", async () => {
    const gate = gatedLoader();
    const w = installClient({ user: VELLA, scenes: { sc: arena }, load: gate.load });
    const { job, req } = await heldJob(w);

    w.deliver(cancelOf(req, { requestId: "someone-else" }), GM.id);
    w.deliver(cancelOf(req), TOBIN.id);
    gate.open();
    await job;
    assert.equal(w.progress().at(-1).payload.done, true);
    assert.equal(w.progress().at(-1).payload.loaded, 3);
  });

  test("a newer request replaces a running one: the old one goes quiet, the new one finishes", async () => {
    const gate = gatedLoader();
    const w = installClient({ user: VELLA, scenes: { sc: arena }, load: gate.load });
    const { job: first, req: older } = await heldJob(w);
    const { job: second, req: newer } = await heldJob(w);
    gate.open();
    await Promise.all([first, second]);

    const byRequest = (req) => w.progress().filter((e) => e.payload.requestId === req.requestId).map((e) => e.payload);
    assert.equal(byRequest(older).length, 1, "only its opening report");
    assert.equal(byRequest(newer).at(-1).done, true);
    assert.equal(w.progress().filter((e) => e.payload.done).length, 1, "one closing report, the new request's");
  });
});

describe("player: a request is run once", () => {
  const loadsOf = (w) => w.log.filter((l) => l.startsWith("load:")).length;

  test("the same request twice, as when Foundry replays what a live listener already heard, is one loop and one run of reports", async () => {
    const gate = gatedLoader();
    const w = installClient({ user: VELLA, scenes: { sc: arena }, load: gate.load });
    const { job, req } = await heldJob(w);
    assert.equal(w.deliver(req, GM.id), undefined, "the repeat starts nothing");
    gate.open();
    await job;

    const sent = w.progress().map((e) => e.payload);
    assert.deepEqual(sent.map((p) => p.loaded), [0, 1, 2, 3, 3], "the first run's opening report was not dropped, and nothing was said twice");
    assert.equal(sent.filter((p) => p.done).length, 1);
    assert.equal(loadsOf(w), 3, "every file loaded once");
  });

  test("a repeat after the request finished runs nothing again, but says once more how it ended", async (t) => {
    muteWarnings(t);
    const w = installClient({
      user: VELLA,
      scenes: { sc: arena },
      sizes: { [MAP]: 8000 },
      load: async (src) => {
        if (src === "tokens/orc.webp") throw new Error("404");
        return { valid: true };
      },
    });
    const req = request();
    await w.deliver(req, GM.id);
    const ending = w.progress().at(-1);
    assert.deepEqual([ending.payload.done, ending.payload.failed], [true, 1]);
    const sentBefore = w.progress().length;
    const logBefore = [...w.log];

    assert.equal(w.deliver(req, GM.id), undefined);
    assert.deepEqual(w.log, logBefore, "no HEAD and no load");
    assert.equal(w.progress().length, sentBefore + 1);
    assert.deepEqual(w.progress().at(-1), ending, "the same closing report, to the same GM");
  });

  test("a repeat is answered to the GM who sent it, about the request as it was first taken", async () => {
    const w = installClient({ user: VELLA, scenes: { sc: arena } });
    const req = request();
    await w.deliver(req, GM.id);
    const sent = w.progress().length;

    w.deliver({ ...req, sceneId: "elsewhere", gmId: BRIDGE.id }, GM.id);
    const again = w.progress();
    assert.equal(again.length, sent + 1);
    assert.equal(again.at(-1).payload.sceneId, "sc", "the scene it was asked about, not the one the repeat names");
    assert.equal(again.at(-1).payload.requestId, req.requestId);
    assert.deepEqual(again.at(-1).options, { recipients: ["gm1"] }, "the sender, not the gmId in the payload");
  });

  test("a repeat is only answered for a GM", async () => {
    const w = installClient({ user: VELLA, scenes: { sc: arena } });
    const req = request();
    await w.deliver(req, GM.id);
    const sent = w.emitted.length;
    assert.equal(w.deliver(req, TOBIN.id), undefined);
    assert.equal(w.emitted.length, sent);
  });

  test("an older request replayed after a newer one does not take its place", async () => {
    const gate = gatedLoader();
    const w = installClient({ user: VELLA, scenes: { sc: arena }, load: gate.load });
    const { job: first, req: older } = await heldJob(w);
    const { job: second, req: newer } = await heldJob(w);
    assert.equal(w.deliver(older, GM.id), undefined);
    gate.open();
    await Promise.all([first, second]);

    const byRequest = (req) => w.progress().filter((e) => e.payload.requestId === req.requestId).map((e) => e.payload);
    assert.equal(byRequest(newer).at(-1).done, true, "the newer request ran to the end");
    assert.equal(byRequest(older).length, 1, "the older one stayed quiet");
  });

  test("a cancelled request is not brought back by a repeat", async () => {
    const gate = gatedLoader();
    const w = installClient({ user: VELLA, scenes: { sc: arena }, load: gate.load });
    const { job, req } = await heldJob(w);
    w.deliver(cancelOf(req), GM.id);
    gate.open();
    await job;
    const loads = loadsOf(w);
    const sent = w.progress().length;

    assert.equal(w.deliver(req, GM.id), undefined);
    await flush();
    assert.equal(loadsOf(w), loads);
    assert.equal(w.progress().length, sent, "not a word: it was cancelled, not finished");
  });

  test("it remembers only the last few requests", async () => {
    const w = installClient({ user: VELLA, scenes: { sc: arena } });
    const asked = [];
    for (let i = 0; i < 20; i++) {
      asked.push(request());
      await w.deliver(asked.at(-1), GM.id);
    }
    const loads = loadsOf(w);
    await w.deliver(asked.at(-1), GM.id);
    assert.equal(loadsOf(w), loads, "the latest is remembered");
    await w.deliver(asked[0], GM.id);
    assert.equal(loadsOf(w), loads + 3, "the first was forgotten long ago, so it is a request like any other");
  });

  test("a page that survived a dropped connection is heard from again when the GM asks again", async (t) => {
    const gm = installClient({ user: GM });
    await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));
    const asked = gm.emitted.find((e) => e.payload.action === SOCKET_ACTIONS.preload);

    // Tobin's page loads it, and the GM files the reports.
    const page = await freshPage();
    const tobin = installClient({ user: TOBIN, scenes: { sc: arena }, mod: page });
    await tobin.deliver(asked.payload, GM.id);
    const gmFirst = installClient({ user: GM });
    for (const e of tobin.progress()) gmFirst.deliver(e.payload, TOBIN.id);
    assert.equal(rowOf("sc", "p2").state, "ready");

    // The connection drops and comes back: the GM starts Tobin's row afresh and asks again with the same request.
    fireHook("userConnected", TOBIN, false);
    const sent = gmFirst.emitted.length;
    fireHook("userConnected", TOBIN, true);
    assert.equal(rowOf("sc", "p2").state, "waiting");
    const askedAgain = gmFirst.emitted.at(sent);
    assert.equal(askedAgain.payload.requestId, asked.payload.requestId);

    // The same page gets it: nothing loads again, and it says how it ended.
    const back = installClient({ user: TOBIN, scenes: { sc: arena }, mod: page });
    await back.deliver(askedAgain.payload, GM.id);
    assert.deepEqual(back.log, []);
    const gmLast = installClient({ user: GM });
    for (const e of back.progress()) gmLast.deliver(e.payload, TOBIN.id);
    assert.equal(rowOf("sc", "p2").state, "ready");
  });
});

describe("the round trip", () => {
  test("what a player emits is exactly what walks the GM's ledger to ready", async (t) => {
    // 1. The GM starts the preload.
    const gm = installClient({ user: GM });
    const started = await startPreload({ id: "sc" });
    t.after(() => stopPreload("sc"));
    const asked = gm.emitted.find((e) => e.payload.action === SOCKET_ACTIONS.preload);
    assert.deepEqual(asked.options.recipients, ["p1", "p2"]);

    // 2. Each player's client gets it from the server (sender = the GM) and loads.
    const heard = [];
    for (const player of [VELLA, TOBIN]) {
      const client = installClient({ user: player, scenes: { sc: arena }, sizes: { [MAP]: 4000 }, mod: await freshPage() });
      await client.deliver(asked.payload, GM.id);
      heard.push(...client.progress().map((e) => ({ payload: e.payload, from: player.id, to: e.options.recipients })));
    }
    assert.ok(heard.every((h) => h.to.join() === "gm1"));

    // 3. Back on the GM's client, the server hands each report over with its true sender.
    const gmAgain = installClient({ user: GM });
    for (const { payload, from } of heard.filter((h) => h.from === "p1")) gmAgain.deliver(payload, from);
    assert.equal(rowOf("sc", "p1").state, "ready");
    assert.equal(preloadSnapshot("sc").allReady, false, "Tobin has not been heard");
    assert.equal(describeSnapshot(preloadSnapshot("sc")).tone, "loading");
    for (const { payload, from } of heard.filter((h) => h.from === "p2")) gmAgain.deliver(payload, from);

    const snap = preloadSnapshot("sc");
    assert.equal(snap.allReady, true);
    assert.deepEqual(snap.rows.map((r) => [r.state, r.pct, r.failed]), [["ready", 1, 0], ["ready", 1, 0]]);
    assert.equal(asked.payload.requestId, started.requestId);
  });
});

// Last in the file, so it runs after every test above has stopped what it started.
test("no hook is left registered once every preload has stopped", () => {
  assert.equal(hooksOn("userConnected"), 0);
});
