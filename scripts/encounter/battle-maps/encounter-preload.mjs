/**
 * Shadowdark Enhancer — encounter battle maps: the preload readout.
 *
 * The GM sets a battle up; this makes every connected player's client load the
 * scene's art in the background and tells the GM how far each one has got, so
 * "Bring the table" can wait for a green "Ready 4/4" instead of guessing.
 *
 * WHY THE MODULE RUNS ITS OWN LOOP (verified in Foundry v14.364,
 * client/documents/collections/scenes.mjs and client/canvas/loader.mjs).
 * `game.scenes.preload(id, {broadcast: true})` emits `preloadScene` and every
 * client preloads, but nothing comes back: each client's loading bar is its own
 * and the loader's counter is private. So each player's client loads the
 * scene's files itself, through the public
 * `foundry.canvas.TextureLoader.loader.loadTexture`, and reports after every
 * file. The closing `done` goes out as soon as the last file has finished.
 *
 * WHAT IT DELIBERATELY DOES NOT CALL. `game.scenes.preload(sceneId)` would add
 * Foundry's shared extras (the token ring spritesheet, control and status icons),
 * but every client that has drawn a scene already holds those, and the call
 * costs two things this readout cannot afford:
 *
 *   - It also preloads the scene's playlist sound (Scenes#preload ->
 *     AudioHelper.preloadSound -> Sound#load), and Sound#load waits on
 *     `game.audio.unlock` while audio is locked, which lasts until the player's
 *     first click or keypress in the tab. A freshly reloaded, idle or
 *     auto-logged-in client would never finish, so it would never turn ready.
 *   - It shows Foundry's "Loading <scene>" progress notification on every
 *     player's screen (TextureLoader#load, whose `displayProgress` defaults on),
 *     in the middle of the GM's quiet setup. `loader.loadTexture`, which this
 *     loop uses, shows none.
 *
 * Foundry drops a cached texture unused for 15 minutes (TextureLoader.CACHE_TTL,
 * swept on the next scene load), so a preload that sits through a long break is
 * not guaranteed to survive it.
 *
 * THE MESSAGES (on SOCKET, told apart by `action`; names in constants.mjs):
 *
 *   preload   GM -> the expected players   {requestId, sceneId, gmId}
 *   progress  player -> the starting GM    {requestId, sceneId, userId, loaded, failed, total,
 *                                           weightLoaded, weightTotal, done}
 *   cancel    GM -> the same players       {requestId, sceneId, gmId}
 *
 * A player sends the opening progress report (nothing loaded, the totals known),
 * one after every file, and the closing one with `done: true`. `weightLoaded`
 * counts failed files too, so a broken image cannot hold the bar back.
 *
 * WHO IS ASKED CAN CHANGE. The request goes to the players connected when the GM
 * starts. After that the GM's client listens for `userConnected` (Foundry fires
 * it on a client when ANOTHER user joins or leaves): a player who disconnects is
 * marked `left` and no longer waited on, and one who connects, or comes back
 * after a reload, is added (or has their row reset) and is sent the request,
 * to them alone. The listener is registered with the first running preload and
 * released with the last.
 *
 * ONE RUN PER REQUEST. A player's page takes a request once. The same message
 * reaches a listener twice when it arrives after the listener exists and before
 * Foundry replays the events it buffered while the game loaded (socket.io hands
 * an event to the `any` listeners, where Foundry's buffer sits, and then to the
 * specific ones), and the GM asks a returning player again with the id they
 * already have. A repeat does not start a loop. While the first run goes on it is
 * ignored; once the first has finished the player says again how it ended, so a
 * page that survived a dropped connection is heard from again. A different id for
 * the same scene is a new request and replaces a running one, but an older id
 * replayed after a newer one does not. The last few ids are remembered.
 *
 * REGISTER EARLY. The server announces a user the moment their socket opens, long
 * before their game is ready, and Foundry's client buffers socket events until
 * just BEFORE the `ready` hook, then replays them to whoever is listening
 * (Game#activateSocketListeners, client/game.mjs). A listener added at `ready`
 * therefore misses a request sent to a player who was still loading: call
 * registerPreloadSocket() at `setup`.
 *
 * WHO MAY SAY WHAT. `game.socket.emit` carries no identity of its own: a
 * `userId` in a payload is a claim any client can make (see the header of
 * downtime/downtime-session.mjs for what that cost this module once). The
 * server does name the real sender, though: it re-emits every module message to
 * the receiver as `(payload, senderId)` (`handleCustomSocket` in
 * dist/server/sockets.mjs, and Foundry's own AV code reads it the same way,
 * client/av/clients/simplepeer.mjs). So here:
 *
 *   - the GM files a report under that sender id, never under the payload's
 *     `userId`. The payload's `userId` (and `gmId`) are only a fallback if the
 *     argument is ever absent, and all they could move is a row of a GM-only
 *     readout;
 *   - a player starts or cancels a preload only when that sender is a GM, so
 *     no player can make the others fetch files or stop them;
 *   - the request id is not a secret (every player receives it): it only tells
 *     one request from another, so a late report from a replaced one is dropped.
 *
 * Nothing on this channel changes a document or a setting, so it rides the raw
 * socket. The module's user queries (shared/gm-relay.mjs) authenticate too, but
 * they cost an acknowledgement and a 20 s timeout per message, which is the
 * wrong price for a progress tick.
 *
 * Players only run this when the world setting is on, and never on a GM's
 * client (the always-on Bridge GM must not spend a decode on every battle).
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { SETTINGS, SOCKET, SOCKET_ACTIONS } from "./constants.mjs";
import { fileWeights, makeTracker, runPool, sceneSources } from "./encounter-preload-core.mjs";

export { describeSnapshot } from "./encounter-preload-core.mjs";

/** HEADs are tiny, so four at once; a decode is not, so two. A weak client sets the ceiling. */
const HEAD_CONCURRENCY = 4;
const HEAD_TIMEOUT_MS = 5000;
const LOAD_CONCURRENCY = 2;
/** The scene is created just before the request goes out; give its document a moment to reach a slow client. */
const SCENE_WAIT_MS = 4000;
const SCENE_POLL_MS = 250;
/** How often the GM's readout is re-read while someone is loading, so a silent client can show as stalled. */
const TICK_MS = 10000;

const enabled = () => Boolean(game.settings.get(MODULE_ID, SETTINGS.preload));
const send = (payload, recipients) => game.socket.emit(SOCKET, payload, { recipients });

// ─── GM side: one readout per scene ─────────────────────────────────────────

/** sceneId -> {requestId, tracker, recipients}. The newest request for a scene wins; `recipients` is everyone ever asked. */
const sessions = new Map();
const listeners = new Set();
let ticker = null;
let connectHook = null;

function notify(sceneId) {
  const snapshot = preloadSnapshot(sceneId);
  for (const fn of [...listeners]) {
    try { fn(snapshot, sceneId); }
    catch (err) { console.warn(`${MODULE_ID} | preload listener failed`, err); }
  }
}

/**
 * A silent client is exactly the one that never sends the message that would
 * redraw it, so while anyone is loading the readout is re-announced on a timer
 * and a row that has gone quiet shows as stalled.
 */
function syncTicker() {
  const loading = [...sessions.values()].some((s) => s.tracker.snapshot().rows.some((row) => row.state === "loading"));
  if (loading && !ticker) {
    ticker = setInterval(() => {
      for (const sceneId of sessions.keys()) notify(sceneId);
      syncTicker();
    }, TICK_MS);
    ticker.unref?.();
  } else if (!loading && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

/** Forget a scene's readout and tell its players to stop. False when there was none. */
function endSession(sceneId) {
  const session = sessions.get(sceneId);
  if (!session) return false;
  sessions.delete(sceneId);
  send({ action: SOCKET_ACTIONS.cancel, requestId: session.requestId, sceneId, gmId: game.user.id }, session.recipients);
  return true;
}

/**
 * Foundry fires `userConnected` on this client when ANOTHER user joins or leaves.
 * A player who goes is no longer waited on. One who comes, or comes back after a
 * reload with nothing loaded, is added (or has their row reset) and is asked,
 * alone. A GM loads nothing, so a GM coming or going changes nothing.
 */
function onUserConnected(user, connected) {
  if (!user || user.isGM) return;
  for (const [sceneId, session] of sessions) {
    const changed = connected ? session.tracker.join({ userId: user.id, name: user.name }) : session.tracker.leave(user.id);
    if (!changed) continue;
    if (connected) {
      if (!session.recipients.includes(user.id)) session.recipients.push(user.id);
      send({ action: SOCKET_ACTIONS.preload, requestId: session.requestId, sceneId, gmId: game.user.id }, [user.id]);
    }
    notify(sceneId);
  }
  syncTicker();
}

/** Listen for people coming and going only while a preload is running: on with the first, off with the last. */
function syncHook() {
  if (sessions.size && connectHook === null) {
    connectHook = Hooks.on("userConnected", onUserConnected);
  } else if (!sessions.size && connectHook !== null) {
    Hooks.off("userConnected", connectHook);
    connectHook = null;
  }
}

/**
 * GM: ask every connected player to load this scene's art, and start a readout.
 * Call it after the scene's tokens exist, because token art is part of what is
 * loaded. A second call for the same scene replaces the first and cancels it.
 *
 * @param {Scene} scene
 * @returns {Promise<{requestId: string, expected: Array<{userId: string, name: string}>}|null>}
 *   null when this is not a GM or the preload setting is off.
 */
export async function startPreload(scene) {
  if (!game.user.isGM || !scene?.id || !enabled()) return null;
  endSession(scene.id);
  const expected = game.users.filter((user) => user.active && !user.isGM).map((user) => ({ userId: user.id, name: user.name }));
  const requestId = foundry.utils.randomID();
  const recipients = expected.map((entry) => entry.userId);
  sessions.set(scene.id, { requestId, tracker: makeTracker({ expected }), recipients });
  send({ action: SOCKET_ACTIONS.preload, requestId, sceneId: scene.id, gmId: game.user.id }, recipients);
  syncHook();
  syncTicker();
  notify(scene.id);
  return { requestId, expected };
}

/** GM: drop the scene's readout and cancel the players' loops (Change map, Return to travel). */
export function stopPreload(sceneId) {
  if (!endSession(sceneId)) return;
  syncHook();
  syncTicker();
  notify(sceneId);
}

/**
 * The readout for a scene, or null when none is running. A player who disconnected keeps a row, state `left`,
 * which `expected`, `ready` and `allReady` do not count.
 * @returns {{sceneId: string, rows: Array<{userId: string, name: string, state: string, loaded: number,
 *   total: number, failed: number, pct: number}>, ready: number, expected: number, allReady: boolean,
 *   startedAt: number}|null}
 */
export function preloadSnapshot(sceneId) {
  const session = sessions.get(sceneId);
  return session ? { sceneId, ...session.tracker.snapshot() } : null;
}

/**
 * Subscribe to the readout changing. `fn(snapshot, sceneId)` runs when a
 * request starts, on every report that moves a row, when a player joins or
 * leaves, on a timer while someone is loading (so stalls show), and when a
 * readout ends (snapshot is then null).
 * @returns {Function} unsubscribe
 */
export function onPreloadChange(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function onProgress(msg, senderId) {
  const found = [...sessions].find(([, session]) => session.requestId === msg.requestId);
  if (!found) return; // another request's, a replaced one's, or invented
  const [sceneId, session] = found;
  if (!session.tracker.update(senderId ?? msg.userId, msg)) return;
  syncTicker();
  notify(sceneId);
}

// ─── Player side: load, report, finish ──────────────────────────────────────

/** The one preload this client is running. A newer request or a cancel stops it between files. */
let job = null;

/**
 * The last few requests this client took, oldest first: requestId -> the job, which
 * carries `final` (the counts it ended on) once it has finished. A request is run
 * once. The same message reaches a listener twice when it arrives after the
 * listener exists and before Foundry replays the events it buffered while the game
 * loaded, and the GM asks a returning player again with the id it had. A repeat is
 * therefore never a new run: it would cancel the first, drop its early reports, and
 * an older request replayed after a newer one would take the newer one's place. A
 * repeat of a request that finished is answered with how it ended instead, because
 * a player whose page survived a dropped connection is waited on from a clean row
 * and would otherwise never be heard from again.
 */
const recent = new Map();
const RECENT_REQUESTS = 8;

/** The sender, when it is a GM; null otherwise. See WHO MAY SAY WHAT. */
function gmOf(msg, senderId) {
  const id = senderId ?? msg.gmId;
  return game.users.get(id)?.isGM ? id : null;
}

/** The file's byte size from a HEAD, or null when it cannot be had (cross-origin, no Content-Length, slow). */
async function sizeOf(src) {
  try {
    if (new URL(src, location.href).origin !== location.origin) return null;
    const response = await foundry.utils.fetchWithTimeout(src, { method: "HEAD" }, { timeoutMs: HEAD_TIMEOUT_MS });
    return response.ok ? (Number(response.headers.get("content-length")) || null) : null;
  } catch {
    return null;
  }
}

/**
 * Load one file into Foundry's texture cache. True when it is there; a failure is logged, never thrown.
 * `loader.loadTexture` is PIXI.Assets.load plus a cache entry and shows nothing on screen; it is
 * `loader.load()` (what Scenes#preload ends in) that raises the "Loading <scene>" progress notification.
 */
async function loadOne(src) {
  try {
    return Boolean(await foundry.canvas.TextureLoader.loader.loadTexture(src));
  } catch (err) {
    console.warn(`${MODULE_ID} | battle map preload: ${src} did not load`, err);
    return false;
  }
}

async function waitForScene(sceneId, mine) {
  for (let waited = 0; !mine.cancelled; waited += SCENE_POLL_MS) {
    const scene = game.scenes.get(sceneId);
    if (scene || waited >= SCENE_WAIT_MS) return scene ?? null;
    await new Promise((resolve) => setTimeout(resolve, SCENE_POLL_MS));
  }
  return null;
}

/**
 * Report after every file and once at the end: a message to the GM costs a
 * socket round trip for them, so it is never more than one per file, plus the
 * opening one that takes the row off "waiting" and the closing `done`.
 */
async function preloadHere(requestId, sceneId, gmId) {
  const mine = { requestId, sceneId, cancelled: false, final: null };
  if (job) job.cancelled = true;
  job = mine;
  recent.set(requestId, mine);
  if (recent.size > RECENT_REQUESTS) recent.delete(recent.keys().next().value);
  const counts = { loaded: 0, failed: 0, total: 0, weightLoaded: 0, weightTotal: 0 };
  const report = (done = false) => {
    if (mine.cancelled) return;
    if (done) mine.final = { ...counts };
    send({ action: SOCKET_ACTIONS.progress, requestId, sceneId, userId: game.user.id, ...counts, done }, [gmId]);
  };
  try {
    const scene = await waitForScene(sceneId, mine);
    if (mine.cancelled) return;
    if (!scene) throw new Error(`scene ${sceneId} did not reach this client`);
    const sources = sceneSources(scene);
    const weights = fileWeights(await runPool(sources, HEAD_CONCURRENCY, sizeOf));
    if (mine.cancelled) return;
    counts.total = sources.length;
    counts.weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    report();
    await runPool(sources, LOAD_CONCURRENCY, async (src, i) => {
      if (mine.cancelled) return;
      if (await loadOne(src)) counts.loaded++;
      else counts.failed++;
      counts.weightLoaded += weights[i];
      report();
    });
    // Done is the last file finishing. game.scenes.preload() is not called: see WHAT IT DELIBERATELY DOES NOT CALL.
    report(true);
  } catch (err) {
    console.warn(`${MODULE_ID} | battle map preload failed`, err);
    counts.failed = Math.max(counts.failed, 1);
    counts.total = Math.max(counts.total, counts.failed);
    report(true);
  } finally {
    if (job === mine) job = null;
  }
}

function onPreload(msg, senderId) {
  const gmId = gmOf(msg, senderId);
  if (game.user.isGM || !gmId || !enabled()) return undefined;
  if (typeof msg.requestId !== "string" || typeof msg.sceneId !== "string") return undefined;
  const known = recent.get(msg.requestId);
  if (!known) return preloadHere(msg.requestId, msg.sceneId, gmId);
  // Running, cancelled or replaced: nothing to do (the running one reports on its own). Finished: say how it ended.
  if (known.final && !known.cancelled) {
    send({ action: SOCKET_ACTIONS.progress, requestId: known.requestId, sceneId: known.sceneId, userId: game.user.id, ...known.final, done: true }, [gmId]);
  }
  return undefined;
}

function onCancel(msg, senderId) {
  if (job && job.requestId === msg.requestId && gmOf(msg, senderId)) job.cancelled = true;
}

// ─── Wiring ─────────────────────────────────────────────────────────────────

const registered = new WeakSet();

/**
 * Listen for the three preload messages, on every client: a GM's client answers
 * progress, a player's client answers a request or a cancel. Call it once, at
 * `setup` and not later (see REGISTER EARLY). Calling it again is harmless.
 */
export function registerPreloadSocket() {
  if (registered.has(game.socket)) return;
  registered.add(game.socket);
  // The listener hands back the player loop's promise so a test can await it; socket.io ignores the value.
  game.socket.on(SOCKET, (msg, senderId) => {
    if (msg?.action === SOCKET_ACTIONS.preload) return onPreload(msg, senderId);
    if (msg?.action === SOCKET_ACTIONS.progress) return onProgress(msg, senderId);
    if (msg?.action === SOCKET_ACTIONS.cancel) return onCancel(msg, senderId);
    return undefined;
  });
}
