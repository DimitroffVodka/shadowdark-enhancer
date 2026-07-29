/**
 * Downtime log — one entry point, two sinks.
 *
 *   recordDowntime(entry)
 *     1. Session Recap — a narrative "Downtime" section in the live session
 *        (self-guarding: nothing is written when no session is running).
 *     2. Journal — a persistent world "Downtime Log" JournalEntry that
 *        outlives the session, grouped under a heading per real-world day.
 *
 * EXECUTION CONTEXT: **GM-side only.** Both sinks write world state (a world
 * setting and a world JournalEntry) which a player client cannot do. Nothing
 * is gated here on purpose — the callers own the activeGM / relay decision,
 * mirroring how merchant-shop.mjs and downtime-effects.mjs are gated by their
 * callers. `recordDowntime` NEVER throws outward: a logging failure must not
 * take down the downtime roll that produced it.
 *
 * DELIBERATE DOUBLE-ENTRY: a paid downtime attempt is ALSO mirrored into the
 * recap's Purchases via `SessionRecap.logPurchase` at the attempt site. That
 * stays — Purchases is the money ledger (it feeds the party-total sums), while
 * this Downtime section is the narrative record of what was attempted and what
 * came of it. Removing either would leave one of the two views wrong.
 *
 * The pure formatting/grouping half lives in downtime-log-core.mjs.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";
import {
  countRows,
  dayKey,
  insertRow,
  journalRow,
  normalizeEntry,
} from "./downtime-log-core.mjs";

export { countRows, dayKey, insertRow, journalRow, normalizeEntry };

/** Flags the world JournalEntry. Lookup is by THIS, never by name. */
const JOURNAL_FLAG = "downtimeLog";
/** Flags the single text page inside it. */
const PAGE_FLAG = "downtimeLogPage";

const JOURNAL_NAME = "Downtime Log";
const PAGE_NAME = "Log";

/**
 * Serializes journal read-modify-write cycles. Appending is
 * read `text.content` → splice → update; two entries landing in the same tick
 * would otherwise both read the pre-append HTML and one row would vanish.
 * Mirrors SessionRecap._writeQueue.
 */
let _journalQueue = Promise.resolve();

function enqueueJournal(fn) {
  const run = _journalQueue.then(fn, fn);
  _journalQueue = run.catch(() => {});
  return run;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Journal plumbing                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The log JournalEntry, or null.
 *
 * Flag-only by design. `source-pdf-registry.findLibraryJournal` falls back to
 * a name match; this one deliberately does not, so a GM's own unrelated
 * "Downtime Log" entry is never adopted and silently appended to.
 */
export function findDowntimeJournal() {
  return game.journal?.find((j) => j.getFlag(MODULE_ID, JOURNAL_FLAG)) ?? null;
}

/**
 * The log JournalEntry, creating it flagged if absent.
 *
 * Created at the world journal ROOT with no folder — matching the module's
 * only existing world-Journal precedent (`ensureLibraryJournal` in
 * source-pdf-registry.mjs). The module defines no world-Journal folder
 * convention; the "never create at pack root" rule is about compendium packs,
 * which this is not.
 */
export async function ensureDowntimeJournal() {
  const existing = findDowntimeJournal();
  if (existing) return existing;
  return JournalEntry.create({
    name: JOURNAL_NAME,
    flags: { [MODULE_ID]: { [JOURNAL_FLAG]: true } },
  });
}

/** The single flagged text page, creating it if absent. */
async function ensureLogPage(journal) {
  const existing = journal.pages.find((p) => p.getFlag(MODULE_ID, PAGE_FLAG));
  if (existing) return existing;
  const [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
    name: PAGE_NAME,
    type: "text",
    text: { content: "", format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
    flags: { [MODULE_ID]: { [PAGE_FLAG]: true } },
  }]);
  return page;
}

/**
 * Append one row to the log page under its day heading (newest first).
 * Returns the page, or null when the entry carried no usable timestamp.
 */
async function appendToJournal(entry) {
  const day = dayKey(entry.timestamp);
  if (!day) {
    console.warn(`${MODULE_ID} | downtime log: entry has no usable timestamp, skipping the journal`, entry);
    return null;
  }
  const journal = await ensureDowntimeJournal();
  if (!journal) return null;
  const page = await ensureLogPage(journal);
  if (!page) return null;

  // Read-modify-write of the page's HTML. v14 JournalEntryPage text lives at
  // `text.content`; there is no append API, so the whole body is rewritten.
  const current = page.text?.content ?? "";
  const next = insertRow(current, day, journalRow(entry));
  if (next === current) return page;
  await page.update({ "text.content": next });
  return page;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Public entry point                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Record one resolved downtime attempt in both sinks.
 *
 * GM-side only (see the file header) — the caller gates.
 *
 * @param {{actorId:string, actorName:string, player:string, sourceSlug:string,
 *   slotKey:string, slotLabel:string, activityKey:string, activityName:string,
 *   total:number, dc:number, success:boolean, costGp:number,
 *   effectSummary:string, gmRolled:boolean, timestamp:string}} entry
 *   `timestamp` is an ISO string supplied by the caller, never generated here.
 * @returns {Promise<{recap:boolean, journal:boolean}>} which sinks accepted it
 */
export async function recordDowntime(entry) {
  const result = { recap: false, journal: false };
  let normalized;
  try {
    normalized = normalizeEntry(entry);
  } catch (err) {
    console.warn(`${MODULE_ID} | downtime log: unreadable entry, nothing recorded`, err, entry);
    return result;
  }

  // Sink 1 — session recap. Self-guards on an active session, exactly like
  // logPurchase/logLoot, so an out-of-session downtime attempt is a no-op here
  // and still lands in the journal below.
  try {
    await SessionRecap.logDowntime(normalized);
    result.recap = !!SessionRecap.isActive?.();
  } catch (err) {
    console.warn(`${MODULE_ID} | downtime log: session recap write failed`, err);
  }

  // Sink 2 — the persistent journal. Queued so concurrent entries can't drop
  // a row through a stale read-modify-write.
  try {
    const page = await enqueueJournal(() => appendToJournal(normalized));
    result.journal = !!page;
  } catch (err) {
    console.warn(`${MODULE_ID} | downtime log: journal write failed`, err);
  }

  return result;
}

/** Open the log journal for the GM, creating it if it doesn't exist yet. */
export async function openDowntimeLog() {
  const journal = await ensureDowntimeJournal();
  journal?.sheet?.render(true);
  return journal;
}
