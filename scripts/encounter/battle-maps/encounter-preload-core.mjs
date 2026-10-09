/**
 * Shadowdark Enhancer — encounter battle maps: the preload readout, pure half.
 *
 * Foundry has no "has every player loaded this scene?" answer:
 * `game.scenes.preload(id, {broadcast: true})` is fire-and-forget, each client's
 * loading bar is private to it, and the loader's counter is private too. So the
 * module runs its own loop on each player's client and reports back
 * (encounter-preload.mjs). Everything here needs no Foundry, so Node tests
 * import it:
 *
 *   sceneSources      which image files a Scene needs (live document or plain data)
 *   fileWeights       a weight per file from whatever sizes the HEAD requests gave
 *   runPool           a small concurrency cap for the HEAD and load loops
 *   makeTracker       the GM's ledger of what each player reported
 *   describeSnapshot  what a window needs to word that ledger
 *
 * THE LEDGER IS FORGIVING ON PURPOSE. Messages cross a socket, so they can
 * arrive twice, late, or after the row already finished. Every number only ever
 * moves up and `done` never reverts, which makes duplicates and reordering
 * harmless without sequence numbers. A progress bar that jumps backwards, or
 * passes 100%, would read as a bug to the GM, so `pct` is clamped both ways.
 *
 * A row's state is `waiting` (never reported), `loading`, `stalled` (loading,
 * but quiet for `stallMs`), `ready` (finished with every file loaded),
 * `failed` (finished, at least one file did not load) or `left` (the player
 * disconnected). A failed file counts toward finishing, so a broken token image
 * cannot hold the bar below 100%, but it keeps the row from being `ready`: the
 * GM is told, not left to guess.
 *
 * WHO IS WAITED ON CAN CHANGE. `join` adds a player who connects mid-preload, or
 * reopens the row of one who left and came back (their old progress died with
 * their page); `leave` marks a disconnect. A `left` row stays in `rows` so a
 * window can show it, but it is not counted in `expected` or `ready`, `allReady`
 * is judged on the players still connected, and a stray report from it is
 * ignored.
 */

/**
 * Every row state and the string that words it, written out in full:
 * test/i18n-keys.test.mjs finds keys by scanning source for `SDE.…`, so a key
 * built from pieces (`state.${state}`) would look unused. The words live in
 * languages/en.json.
 */
export const PRELOAD_STATE_KEYS = {
  waiting: "SDE.encounterMaps.preload.state.waiting",
  loading: "SDE.encounterMaps.preload.state.loading",
  ready: "SDE.encounterMaps.preload.state.ready",
  failed: "SDE.encounterMaps.preload.state.failed",
  stalled: "SDE.encounterMaps.preload.state.stalled",
  left: "SDE.encounterMaps.preload.state.left",
};

export const PRELOAD_STATES = Object.keys(PRELOAD_STATE_KEYS);

/** How long a loading row may stay silent before it reads as stalled. */
export const DEFAULT_STALL_MS = 90000;

// ─── Which files a scene needs ──────────────────────────────────────────────

/** Embedded collections arrive as arrays (plain data) or Foundry Collections (live documents). */
const items = (collection) => (Array.isArray(collection) ? collection : (Array.isArray(collection?.contents) ? collection.contents : []));

/**
 * Something the loader can fetch by path. `#name` is a virtual texture Foundry
 * registers in canvas.sceneTextures, `*` is a wildcard that was never resolved,
 * and data:/blob: URLs already carry their bytes. Foundry's own loader skips
 * the first as well (TextureLoader#load).
 */
const loadable = (src) => typeof src === "string" && src.trim() !== "" && !src.includes("*") && !/^(#|data:|blob:)/i.test(src);

/** A document's id: a live document has `id`, plain `toObject()` data has `_id`. */
const idOf = (doc) => doc?.id ?? doc?._id;

/** A Set field (`levels`, `visibility.levels`) is a Set on a live document and an array in plain data. */
const idSet = (value) => new Set(value instanceof Set || Array.isArray(value) ? value : []);

/**
 * The Level Foundry opens the scene on (BaseScene#initialLevel): the one named by
 * the scene's `initialLevel`, else the first. A live Scene's `initialLevel` is
 * that Level document and plain data holds its id, so both are read.
 */
function openingLevel(scene, levels) {
  const named = scene?.initialLevel;
  const id = typeof named === "string" ? named : idOf(named);
  return (id ? levels.find((level) => idOf(level) === id) : null) ?? levels[0] ?? null;
}

/**
 * The image URLs Foundry would draw if the scene were opened now, de-duplicated,
 * the big files first. That is what TextureLoader.loadSceneTextures asks for
 * (client/canvas/loader.mjs), not everything the scene holds, so a multi-level
 * scene does not make a weak client decode floors nobody is standing on:
 *
 *   - the opening level's background, foreground and fog, then the background
 *     and foreground (no fog) of any level it can see through
 *     (`visibility.levels`, Scene#_configureLevelTextures);
 *   - tiles on the opening level, or on no level in particular
 *     (CanvasDocument#includedInLevel: an empty `levels` set means everywhere);
 *   - tokens on the opening level or one it can see (TokenDocument#includedInLevel
 *     reads the token's single `level`, which defaults to the opening level).
 *
 * Data with no levels at all (a bare list of tiles and tokens) is not filtered.
 * The strings are returned untouched because Foundry's texture cache is keyed by
 * the exact string a document holds.
 *
 * Not listed: control icons, status effects and the token ring spritesheet,
 * which every client that has drawn a scene already holds, and the textures of
 * walls, drawings and notes, which load when the scene is drawn.
 *
 * @param {object} scene  A Scene document or its plain `toObject()` data.
 * @returns {string[]}
 */
export function sceneSources(scene) {
  const found = new Set();
  const add = (src) => { if (loadable(src)) found.add(src); };
  const levels = items(scene?.levels);
  const opening = openingLevel(scene, levels);
  const openingId = idOf(opening);
  const seen = idSet(opening?.visibility?.levels);

  const drawn = opening ? [opening, ...levels.filter((level) => level !== opening && seen.has(idOf(level)))] : [];
  for (const level of drawn) {
    add(level?.background?.src);
    add(level?.foreground?.src);
    if (level === opening) add(level?.fog?.src);
  }
  for (const tile of items(scene?.tiles)) {
    const only = idSet(tile?.levels);
    if (!opening || !only.size || only.has(openingId)) add(tile?.texture?.src);
  }
  for (const token of items(scene?.tokens)) {
    const own = token?.level ?? openingId;
    if (opening && own !== openingId && !seen.has(own)) continue;
    add(token?.texture?.src);
    // A dynamic token ring draws its own subject texture, but only when the ring is on.
    if (token?.ring?.enabled) add(token.ring.subject?.texture);
  }
  return [...found];
}

// ─── The player loop's helpers ──────────────────────────────────────────────

/**
 * A weight per file, so the bar tracks bytes rather than file count (one 8 MB
 * map and six 20 KB tokens should not each be a seventh). A file whose size is
 * unknown gets the mean of the known ones; when nothing is known every weight
 * is 1, which is the plain file count.
 *
 * @param {Array<number|null|undefined>} sizes  Content-Length per file, null if unknown.
 * @returns {number[]}
 */
export function fileWeights(sizes) {
  const known = (n) => Number.isFinite(n) && n > 0;
  const sized = sizes.filter(known);
  const fill = sized.length ? sized.reduce((a, b) => a + b, 0) / sized.length : 1;
  return sizes.map((n) => (known(n) ? n : fill));
}

/**
 * Run `worker(item, index)` over `list` with at most `limit` in flight, results
 * in input order. A weak client cannot afford every request or decode at once.
 * The worker must not throw: both callers catch their own errors, because a
 * rejected lane would drop the results of the others.
 */
export async function runPool(list, limit, worker) {
  const results = new Array(list.length);
  let next = 0;
  const lane = async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await worker(list[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, lane));
  return results;
}

// ─── The GM's ledger ────────────────────────────────────────────────────────

const amount = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
const whole = (n) => Math.floor(amount(n));

/**
 * `seen`: has this player reported at all. `left`: they disconnected. `at`: when the row last moved, which is what
 * a stall is measured from.
 */
function blankRow(userId, name) {
  return { userId, name, seen: false, left: false, loaded: 0, failed: 0, total: 0, weightLoaded: 0, weightTotal: 0, done: false, pct: 0, at: 0 };
}

/** The share of the work a row has finished: bytes when the player knew them, else files. */
function fraction(row) {
  if (row.done) return 1;
  const share = row.weightTotal > 0 ? row.weightLoaded / row.weightTotal : (row.total > 0 ? (row.loaded + row.failed) / row.total : 0);
  return Math.min(1, share);
}

const isReady = (row) => row.seen && row.done && row.failed === 0;

/**
 * One ledger for one preload request.
 *
 * `now` is a clock, `() => milliseconds` (a number is taken as the start time and
 * the real clock is used from then on), so a test can drive time by hand.
 * `update` and `snapshot` take an optional time that overrides it.
 *
 * @param {object} options
 * @param {Array<{userId: string, name?: string}>} options.expected  Who we wait for to begin with. Nobody else gets a row until `join`.
 * @param {Function|number} [options.now=Date.now]
 * @param {number} [options.stallMs=DEFAULT_STALL_MS]
 */
export function makeTracker({ expected = [], now = Date.now, stallMs = DEFAULT_STALL_MS } = {}) {
  const clock = typeof now === "function" ? now : Date.now;
  const startedAt = typeof now === "number" ? now : clock();
  const rows = new Map();

  /**
   * Wait for one more player: a new row at the end, or a clean one in place of
   * the row of a player who left and is back (their page reloaded, so nothing
   * they had reported still holds). False when they are already here.
   */
  const join = (entry) => {
    const userId = entry?.userId;
    if (!userId) return false;
    const row = rows.get(userId);
    if (row && !row.left) return false;
    rows.set(userId, blankRow(userId, entry.name ?? row?.name ?? userId));
    return true;
  };

  /** Stop waiting for a player who disconnected. False for a stranger, or one already gone. */
  const leave = (userId) => {
    const row = rows.get(userId);
    if (!row || row.left) return false;
    row.left = true;
    return true;
  };

  for (const entry of expected) join(entry);

  const stateOf = (row, at) => {
    if (row.left) return "left";
    if (!row.seen) return "waiting";
    if (row.done) return row.failed ? "failed" : "ready";
    return at - row.at >= stallMs ? "stalled" : "loading";
  };

  const connected = () => [...rows.values()].filter((row) => !row.left);

  return {
    join,
    leave,

    /**
     * Fold one player report into their row.
     * @param {string} userId
     * @param {{loaded?: number, total?: number, weightLoaded?: number, weightTotal?: number,
     *          failed?: number|boolean, done?: boolean}} patch
     *   `loaded` and `failed` count files; `weightLoaded` is the weight of every
     *   file that has finished, failed ones included.
     * @returns {boolean} whether the row changed (false for a stranger, a player who left, or a repeat)
     */
    update(userId, patch, at = clock()) {
      const row = rows.get(userId);
      if (!row || row.left || !patch || typeof patch !== "object") return false;
      const next = {
        loaded: Math.max(row.loaded, whole(patch.loaded)),
        failed: Math.max(row.failed, patch.failed === true ? 1 : whole(patch.failed)),
        total: Math.max(row.total, whole(patch.total)),
        weightLoaded: Math.max(row.weightLoaded, amount(patch.weightLoaded)),
        weightTotal: Math.max(row.weightTotal, amount(patch.weightTotal)),
        done: row.done || patch.done === true,
      };
      if (row.seen && Object.keys(next).every((key) => next[key] === row[key])) return false;
      Object.assign(row, next, { seen: true, at });
      row.pct = Math.max(row.pct, fraction(row));
      return true;
    },

    /**
     * True only when everyone still connected is `ready`. Nobody connected is not "ready":
     * the caller decides what that means.
     */
    allReady() {
      const here = connected();
      return here.length > 0 && here.every(isReady);
    },

    /** Every row, a player who left included (state `left`); `expected` and `ready` count only those still connected. */
    snapshot(at = clock()) {
      const out = [...rows.values()].map((row) => ({
        userId: row.userId,
        name: row.name,
        state: stateOf(row, at),
        // A failed file is finished too, so "n of N" and the bar agree.
        loaded: row.total ? Math.min(row.total, row.loaded + row.failed) : row.loaded + row.failed,
        total: row.total,
        failed: row.failed,
        pct: row.pct,
      }));
      const here = out.filter((row) => row.state !== "left");
      const ready = here.filter((row) => row.state === "ready").length;
      return { rows: out, ready, expected: here.length, allReady: here.length > 0 && ready === here.length, startedAt };
    },
  };
}

// ─── Wording ────────────────────────────────────────────────────────────────

/**
 * What a window needs to word a snapshot without re-deriving state:
 * the args for the "Ready {ready}/{expected}" label, who is not ready yet (in
 * table order, failed and stalled included — the GM is waiting on them all), and
 * a tone to colour it: `ready` when everyone is, `waiting` while nobody has
 * reported (or nobody is connected), `loading` otherwise. A player who left is
 * none of these: they are not waited on, so they are not counted or named.
 *
 * @param {object|null} snapshot  A tracker snapshot, or null when no preload is running.
 */
export function describeSnapshot(snapshot) {
  const here = (Array.isArray(snapshot?.rows) ? snapshot.rows : []).filter((row) => row.state !== "left");
  const ready = here.filter((row) => row.state === "ready").length;
  const pending = here.filter((row) => row.state !== "ready").map((row) => row.name);
  let tone = "waiting";
  if (here.length && ready === here.length) tone = "ready";
  else if (here.some((row) => row.state !== "waiting")) tone = "loading";
  return { readyLabelArgs: { ready, expected: here.length }, pending, tone };
}
