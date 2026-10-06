/**
 * Importer Hub — "what did this update add?"
 *
 * The import library grows with the module: a release adds a book, a bestiary,
 * a hundred roll-table rows. A GM who already imported everything they own has
 * no way to learn that, because the Manage tree looks the same until they walk
 * it. This snapshots the library's row identities once per MODULE VERSION and
 * reports what appeared since the last snapshot.
 *
 * Stored in the `importerCatalog` world setting as
 *   { version, keys: [...every row], fresh: [...rows this version added] }
 * `fresh` is what the hub badges and its "New" filter read; it is replaced
 * wholesale at the next version bump, and a row drops out of view on its own
 * once it is imported (only not-yet-imported rows are ever flagged).
 *
 * A world that has never been snapshotted reports NOTHING new — the first run
 * seeds the baseline. Flagging a fresh install's entire library as "new" would
 * be true and useless.
 */
import { t } from "./importer-hub-shared.mjs";
import { buildManageTree } from "./manage-tree.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";

/** World setting holding the snapshot. Persisted state — the key never changes. */
export const CATALOG_SETTING = "importerCatalog";

/**
 * A row's identity across versions: its folder plus its name. Deliberately NOT
 * the `src` the row carries — for content reprinted in two books that is chosen
 * against the live PDF registry (firstLinkedCite), so linking a book would
 * otherwise rename rows the GM already has and report them as new.
 */
export const entryKey = (nodeId, name) => `${nodeId}::${name}`;

/** Walk the tree depth-first, yielding [key, entry] for every row. */
function* rows(nodes) {
  for (const node of nodes ?? []) {
    for (const e of node.entries ?? []) yield [entryKey(node.id, e.name), e];
    yield* rows(node.children);
  }
}

/** Every row identity in the tree, imported or not. */
export function catalogKeys(nodes) {
  return [...new Set([...rows(nodes)].map(([key]) => key))];
}

/** The books the given rows lead with, in the order the rows are met (a row's `src` is the book it cites first). */
export function freshBooks(nodes, keys) {
  const wanted = keys instanceof Set ? keys : new Set(keys);
  return [...new Set([...rows(nodes)].filter(([key]) => wanted.has(key)).map(([, e]) => e.src).filter(Boolean))];
}

/** Row identities that are not imported — the ones an Unlock button offers. */
export function lockedKeys(nodes) {
  return [...new Set([...rows(nodes)].filter(([, e]) => !e.present).map(([key]) => key))];
}

/** The stored "added by this version" keys, for the hub's badge and filter. */
export function freshKeys() {
  try {
    return new Set(globalThis.game?.settings?.get(MODULE_ID, CATALOG_SETTING)?.fresh ?? []);
  } catch {
    return new Set();
  }
}

/**
 * Ask the GM whether to go and get what the update added, and take them there.
 *
 * This was a permanent toast first, and a toast was the wrong shape: it named
 * the destination ("Importer Hub → Manage → New") and then left the GM to
 * navigate there from memory. The prompt does the navigating.
 *
 * Dismissing it is the same as "Not now" — the rows stay tagged in the Manage
 * tree and the New filter keeps offering them, so closing it loses nothing.
 * There is no "don't ask again" because it only ever asks once per version.
 *
 * Yes opens the import wizard in update mode: it asks only for the books the new rows come from
 * (none, when those are still linked), and its Advanced link leads to the hub's New filter.
 *
 * @param {number} n  how many not-yet-imported rows this version added
 * @param {{books?:string[]}} [info]  the books those rows come from
 * @returns {Promise<boolean>} whether the GM chose to go and look
 */
export async function promptImporterUpdate(n, info = {}) {
  const { bookTitle } = await import("./wizard/wizard-core.mjs");   // dynamic: the wizard imports this file's siblings
  const books = (info.books ?? []).filter((src) => { try { return !!bookTitle(src); } catch { return false; } });
  const go = await foundry.applications.api.DialogV2.confirm({
    classes: ["sde-ui", "sde-dialog"],
    window: { title: t("SDE.importer.news.title") },
    content: `<p>${books.length
      ? t("SDE.importer.news.bodyBooks", { n, books: books.map(bookTitle).join(", ") })
      : t("SDE.importer.news.body", { n })}</p>`,
    yes: { label: t("SDE.importer.news.review"), icon: "fa-solid fa-sparkles", default: true },   // not destructive: the offer is the default
    no: { label: t("SDE.importer.news.later"), default: false },
    rejectClose: false,   // dismissing the window is "Not now", not an error
  });
  if (!go) return false;
  const { ImportWizardApp } = await import("./wizard/wizard-app.mjs");
  ImportWizardApp.open({ update: { n, books } });
  return true;
}

/**
 * Re-snapshot the library and offer the GM what the update added. Runs at most
 * once per module version: on every other load this is one settings read and a
 * return, so the census it needs is never paid for twice.
 *
 * Every dependency is injected — the caller owns the settings keys, and tests
 * own the tree and the prompt. `announce` receives the COUNT, not a message,
 * so the presentation stays here beside the thing that computed it.
 *
 * @param {object} deps
 * @param {string} deps.version   this module's version
 * @param {()=>object} deps.read  the stored snapshot
 * @param {(v:object)=>Promise} deps.write
 * @param {(n:number)=>any} [deps.announce]  how the GM is asked
 * @param {()=>Promise<Array>} [deps.build]  the manage tree
 * @returns {Promise<string[]|null>} the new keys, or null when nothing ran
 */
export async function checkImporterNews({ version, read, write, announce = promptImporterUpdate, build = buildManageTree } = {}) {
  const stored = read() ?? {};
  if (stored.version === version) return null;
  const nodes = await build();
  const keys = catalogKeys(nodes);
  // A census that read nothing (packs not ready, a thrown build caught
  // upstream) must not be stamped as this version's library — the next run
  // would then diff against an empty baseline and stay silent for good.
  if (!keys.length) return null;
  const seen = new Set(stored.keys ?? []);
  const fresh = seen.size ? lockedKeys(nodes).filter((key) => !seen.has(key)) : [];
  await write({ version, keys, fresh });
  if (fresh.length) await announce?.(fresh.length, { books: freshBooks(nodes, new Set(fresh)) });
  return fresh;
}
