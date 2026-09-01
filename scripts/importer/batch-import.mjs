/**
 * Shadowdark Enhancer — Importer Hub batch planner.
 *
 * Turns the Manage tree into an ordered list of IMPORT JOBS so "Import
 * everything" can drive the ordinary unlock → parse → commit flow unattended.
 * Pure data: no Foundry APIs, no document writes — the runner in
 * importer-hub-batch.mjs executes the plan this module describes.
 *
 * Two ideas carry the whole module:
 *
 *  1. ROUTE — which workspace an entry's unlock already drives. The Manage
 *     tree's own `seedAction` + `type` decide it, exactly as _onCharSeedPaste
 *     does at click time, so a batch run takes the same branch a GM's click
 *     would. An entry no route can drive is BLOCKED with a reason, never
 *     silently dropped.
 *
 *  2. JOB KEY — several locked rows are unlocked by ONE press. Clicking any
 *     boat grabs WR p118 and commits all eight; any CS1 monster grabs the
 *     whole bestiary spread; any Basic Gear row runs the entire price table.
 *     Rows that share a key collapse into a single job (`covers` lists the
 *     rows it should satisfy), so a batch never re-runs the same page fifteen
 *     times — that is what "in batches" means here.
 *
 * Exports:
 *   ROUTE            — route id constants
 *   routeForEntry    — entry → route id, or null when nothing can drive it
 *   jobKeyForEntry   — entry+route → the bulk-unit key rows collapse on
 *   collectLocked    — walk tree nodes → the locked entries under one node
 *   planBatch        — tree nodes → { jobs, blocked, ... }
 *   summarizeBatch   — run results → counts + per-outcome report lines
 */

/** Which workspace drives a job. */
export const ROUTE = {
  /** The hub's own paste box: seed → grab → Parse → Create. */
  HUB: "hub",
  /** The Spell Importer (Class → Tier → Alignment preset lists). */
  SPELLS: "spells",
  /** The Class Importer (body → roll tables → titles). */
  CLASS: "class",
  /** The Item Builder (price table → descriptions → create). */
  GEAR: "gear",
  /** The hub's downtime branch (writes the `downtimeContent` setting). */
  DOWNTIME: "downtime",
};

/** Manage-tree entry types the generic hub paste box parses end-to-end. */
const HUB_TYPES = new Set([
  "Table", "Talent", "Background", "Ancestry",
  "Boat", "SiegeWeapon", "Mount", "Actor",
]);

/** Item types the Item Builder owns (a price table, not a paste-box unlock). */
const GEAR_TYPES = new Set(["Basic", "Weapon", "Armor"]);

/**
 * Which workspace unlocks this entry, mirroring the branches _onCharSeedPaste
 * takes at click time. Returns null when no automated route exists — the caller
 * reports those rather than skipping them quietly.
 * @param {object} entry  a Manage-tree entry
 * @returns {string|null} a ROUTE value
 */
export function routeForEntry(entry) {
  const action = entry?.seedAction ?? "";
  const type = entry?.type ?? "";
  if (action === "spellListSeed") return ROUTE.SPELLS;
  if (action === "downtimeSeedPaste") return ROUTE.DOWNTIME;
  if (action === "monsterSeedPaste") return ROUTE.HUB;
  if (action === "charSeedPaste") {
    if (type === "Class") return ROUTE.CLASS;
    if (type === "Spell") return ROUTE.SPELLS;
    if (GEAR_TYPES.has(type)) return ROUTE.GEAR;
    if (HUB_TYPES.has(type)) return ROUTE.HUB;
    return null;
  }
  // itemSeedPaste (a census gap with no page cite) and anything new land here.
  return null;
}

/**
 * The bulk unit a row belongs to. Rows sharing a key are unlocked by ONE press,
 * so the batch runs the key once and credits every row it covers.
 *
 * Per-row keys (a page holds many things but the unlock keeps exactly one): a
 * seeded TABLE unlock keeps the single best-matching table (see the
 * `seedWantsOneTable` path in _onHubParse). Mounts are the exception: the
 * batch-only Mount path carries every selected name into the existing
 * statblock parser, so one WR spread is read once and committed through the
 * Mount importer as a unit. Everything else is a page-level grab whose parse
 * claims the whole spread.
 */
export function jobKeyForEntry(entry, route = routeForEntry(entry)) {
  const src = entry?.src ?? "";
  const pages = entry?.pages ?? "";
  const type = entry?.type ?? "";
  switch (route) {
    case ROUTE.SPELLS:   return `spells:${entry?.listKey ?? entry?.name ?? ""}`;
    case ROUTE.DOWNTIME: return `downtime:${entry?.listKey ?? src}`;
    case ROUTE.CLASS:    return `class:${entry?.name ?? ""}`;
    case ROUTE.GEAR:     return `gear:${src}:${type}`;
    case ROUTE.HUB:
      // All selected Mounts live on the same WR spread and the batch runner
      // carries the covered names into the Mount parse branch. Keep Mounts on
      // their own key: sharing the ordinary Actor key would feed a Mount seed
      // through the monster/bestiary path, while a name key would re-grab the
      // same two pages once per mount.
      if (type === "Mount") return `mount:${src}:${pages}`;
      // A monster/boat/siege grab parses every statblock or row on the page.
      if (type === "Actor" || type === "Boat" || type === "SiegeWeapon") {
        return `${type.toLowerCase()}:${src}:${pages}`;
      }
      // Seeded tables keep one identity per unlock.
      return `entry:${src}:${type}:${entry?.manifestId || (entry?.name ?? "").toLowerCase()}`;
    default:
      return `unroutable:${src}:${type}:${(entry?.name ?? "").toLowerCase()}`;
  }
}

/**
 * Every locked (not-yet-imported) entry under `nodes`, each stamped with the
 * folder path it was found in so the report can say where a row lives.
 * Pass `rootId` to scope the walk to one branch ("Import all" on a folder).
 * @param {Array<object>} nodes  top-level Manage-tree nodes
 * @param {string|null} rootId   node id to scope to, or null for the whole tree
 * @returns {Array<object>} entries with an added `path` string
 */
export function collectLocked(nodes, rootId = null) {
  const out = [];
  const walk = (node, trail) => {
    const path = [...trail, node.label];
    for (const entry of node.entries ?? []) {
      if (entry?.present) continue;
      out.push({ ...entry, path: path.join(" › ") });
    }
    for (const child of node.children ?? []) walk(child, path);
  };
  const roots = rootId ? findNodes(nodes, rootId) : (nodes ?? []);
  for (const node of roots) walk(node, []);
  return out;
}

/** Every node in the tree whose id matches (ids are unique, but be tolerant). */
function findNodes(nodes, id) {
  const hits = [];
  const walk = (node) => {
    if (node?.id === id) hits.push(node);
    for (const child of node?.children ?? []) walk(child);
  };
  for (const node of nodes ?? []) walk(node);
  return hits;
}

/**
 * Plan a batch run over the locked rows under `rootId` (or the whole tree).
 *
 * `canRun(entry, route)` reports whether this world can actually drive that
 * job unattended — in practice "is the book's PDF uploaded and does this row
 * cite a page". It returns true, or a STRING reason the job is blocked, so the
 * planner stays free of Foundry lookups while the report keeps a real message.
 *
 * @param {Array<object>} nodes
 * @param {{rootId?:string|null, canRun?:(entry:object, route:string)=>true|string}} [opts]
 * @returns {{jobs:Array<object>, blocked:Array<object>, lockedCount:number, rootId:string|null}}
 *   job = { key, route, entry, covers:[entry], label }
 *   blocked = { entry, reason }
 */
export function planBatch(nodes, { rootId = null, canRun = () => true } = {}) {
  const locked = collectLocked(nodes, rootId);
  const jobs = [];
  const byKey = new Map();
  const blocked = [];

  for (const entry of locked) {
    const route = routeForEntry(entry);
    if (!route) {
      blocked.push({ entry, reason: unroutableReason(entry) });
      continue;
    }
    const key = jobKeyForEntry(entry, route);
    // A row covered by a job already planned needs no second run — but a row
    // whose job was BLOCKED must not silently vanish, so blocked keys are
    // recorded too and every later row on that key reports the same reason.
    const seen = byKey.get(key);
    if (seen) {
      if (seen.job) seen.job.covers.push(entry);
      else blocked.push({ entry, reason: seen.reason });
      continue;
    }
    const verdict = canRun(entry, route);
    if (verdict !== true) {
      const reason = String(verdict || "can't be imported automatically");
      byKey.set(key, { reason });
      blocked.push({ entry, reason });
      continue;
    }
    const job = { key, route, entry, covers: [entry], label: entry.name ?? key };
    byKey.set(key, { job });
    jobs.push(job);
  }

  return { jobs, blocked, lockedCount: locked.length, rootId };
}

/** Why an entry has no automated route — specific enough to act on. */
function unroutableReason(entry) {
  if (entry?.seedAction === "itemSeedPaste") {
    return "a census gap with no page citation — use its Import button and paste the entry by hand";
  }
  if (entry?.type === "Spell") return "single spells import through the Spell Importer's list rows";
  return "no automated import route for this row — use its Import button";
}

/**
 * Fold per-job results into report counts and lines.
 * A result is `{ job, status, note, created }` where status is one of
 * "created" | "nothing" | "failed" | "cancelled". A bulk route may also
 * provide `entries`, one such outcome per covered row; those are flattened for
 * the report so a job-level success cannot hide a skipped or missing entry.
 * @param {Array<object>} results
 * @param {Array<object>} [blocked]  planner-blocked rows, folded into `skipped`
 */
export function summarizeBatch(results, blocked = []) {
  const buckets = { created: [], nothing: [], failed: [], cancelled: [] };
  let documents = 0;
  let entries = 0;
  const detailsFor = (result) => {
    if (!Array.isArray(result?.entries) || !result.entries.length) return [result];
    return result.entries.map((entry) => ({
      ...result,
      ...entry,
      created: entry.created ?? (entry.status === "created" ? 1 : 0),
      job: { ...(result.job ?? {}), label: entry.name ?? result.job?.label ?? "" },
    }));
  };
  for (const r of results ?? []) {
    for (const detail of detailsFor(r)) {
      entries++;
      (buckets[detail.status] ?? buckets.failed).push(detail);
      documents += Number(detail.created) || 0;
    }
  }
  entries += (blocked ?? []).length;
  return {
    jobs: (results ?? []).length,
    entries,
    documents,
    created: buckets.created.length,
    nothing: buckets.nothing.length,
    failed: buckets.failed.length,
    cancelled: buckets.cancelled.length,
    blocked: (blocked ?? []).length,
    buckets,
    /** One line per job/row, grouped by outcome — the end-of-run report body. */
    lines: [
      ...buckets.created.map((r) => ({ status: "created", name: r.job.label, note: r.note ?? "" })),
      ...buckets.nothing.map((r) => ({ status: "nothing", name: r.job.label, note: r.note ?? "" })),
      ...buckets.failed.map((r) => ({ status: "failed", name: r.job.label, note: r.note ?? "" })),
      ...buckets.cancelled.map((r) => ({ status: "cancelled", name: r.job.label, note: r.note ?? "" })),
      ...(blocked ?? []).map((b) => ({ status: "blocked", name: b.entry?.name ?? "", note: b.reason ?? "" })),
    ],
  };
}
