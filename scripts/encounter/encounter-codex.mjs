/**
 * Shadowdark Enhancer — the Encounters Met codex.
 *
 * What the table has seen of the road, kept for the players: one journal entry
 * they can read, a page a region, each page a run of entries (the day and hour,
 * the place, and the creature with its art, how many, and how it was behaving)
 * newest first. The party can open it whenever it likes; nothing on it is a
 * secret, because a line is only written once the encounter has been shown to
 * the players — posted to chat, or brought to the table as a battle.
 *
 * The page's entries live in its `encounterCodexPage` flag and its text is
 * rewritten from them, as the rumors ledger does (#190), so the same page can
 * always be rebuilt. Only the active GM writes (a second GM's line is relayed to it), one write at a time.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { dateParts } from "../time/time-core.mjs";
import { regionKey } from "../rules-data/rules-data-core.mjs";
import { partyHex } from "./encounter-terrain.mjs";
import { facetWords } from "./encounter-result.mjs";
import { isActiveGM, queryActiveGM, refuseQuery, registerQuery } from "../shared/gm-relay.mjs";
import { codexHtml, entryKey } from "./encounter-codex-core.mjs";

const LEDGER_FLAG = "encounterCodex";
const PAGE_FLAG = "encounterCodexPage";
const QUERY = `${MODULE_ID}.encounterCodex`;
/** A page stops growing here: the oldest lines go, as a codex full of one region's history still reads. */
const MAX_ENTRIES = 300;

let queue = Promise.resolve();
const enqueue = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch((err) => console.error(`${MODULE_ID} | encounter codex`, err));
  return run;
};

const ledger = () => game.journal.find((e) => e.getFlag(MODULE_ID, LEDGER_FLAG)) ?? null;
const pageFlag = (page) => page.getFlag(MODULE_ID, PAGE_FLAG);

/** The codex journal, made on first use (a GM's write). */
async function ledgerFor() {
  return ledger() ?? JournalEntry.create({
    name: t("SDE.codex.name"),
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: { [MODULE_ID]: { [LEDGER_FLAG]: true } },
  });
}

/** Open the codex for anyone who can read it; false when there is none yet. */
export function openCodex() {
  const log = ledger();
  if (!log || log.visible === false) return false;
  log.sheet.render(true);
  return true;
}

/** Where the party stands: Overland's travel hex, else the party's hex on the viewed map. */
async function whereHex() {
  try {
    const { overlandState, isOverland } = await import("../overland/overland.mjs");
    // Overland keeps its last hex after End travel; it is the party's place only while travelling.
    const hex = isOverland?.() ? overlandState?.()?.hex : null;
    if (hex) return hex;
  } catch { /* not travelling */ }
  try { return partyHex(); } catch { return null; }
}

/** "Hex 1204 · forest, river": the place, without the region, which names the page. */
function whereText(hex) {
  if (!hex) return "";
  const terrain = [hex.terrain, ...(hex.features ?? [])].filter(Boolean).join(", ").replace(/_/g, " ");
  return [Number.isInteger(hex.num) ? t("SDE.calendar.log.hex", { num: hex.num }) : "", terrain].filter(Boolean).join(" · ");
}

const whenText = (at) => {
  const p = dateParts(game.time.calendar, at);
  return t("SDE.codex.when", {
    date: t("SDE.clock.date", { weekday: t(p.weekday), day: p.day, month: t(p.month), year: p.year }),
    time: p.time,
  });
};

/** How it was behaving: the same words the card and the panel use. */
function facetText(res) {
  if (res.distanceText || res.activityText || res.reactionText) {
    return [res.distanceText, res.activityText, res.reactionText].filter(Boolean).join(" · ");
  }
  const words = facetWords({
    distanceRoll: res.distanceRoll, activityRoll: res.activityRoll,
    reactionRoll: res.reactionRoll, reactionTotal: res.reactionTotal ?? res.reactionRoll,
  });
  return [words.distanceText, words.activityText, words.reactionText].filter(Boolean).join(" · ");
}

/** A forwarded line, rebuilt from plain values only. */
function cleanEntry(e) {
  const str = (v) => (v == null ? null : String(v));
  const kind = e?.kind === "monster" ? "monster" : "flavor";
  const at = Number(e?.at);
  if (!e?.key || !Number.isFinite(at)) return null;
  return {
    key: String(e.key), at, when: str(e.when) ?? "", where: str(e.where) ?? "", region: str(e.region), kind,
    name: str(e.name), count: kind === "monster" ? Math.max(1, Math.floor(Number(e.count)) || 1) : null,
    img: str(e.img), facets: str(e.facets), text: str(e.text), heading: str(e.heading), poi: !!e.poi,
  };
}

/** Write one entry to its region's page (the active GM). */
function writeEntry(entry) {
  return enqueue(async () => {
    try {
      const pageKey = regionKey(entry.region);
      const log = await ledgerFor();
      const page = log.pages.find((p) => pageFlag(p)?.key === pageKey) ?? null;
      const kept = page ? (pageFlag(page)?.entries ?? []) : [];
      if (kept.some((e) => e.key === entry.key)) return null;
      const entries = [...kept, entry].slice(-MAX_ENTRIES);
      const content = codexHtml(entries, t);
      const flag = { key: pageKey, region: entry.region ?? null, entries };
      if (page) {
        await log.updateEmbeddedDocuments("JournalEntryPage", [{
          _id: page.id, "text.content": content, [`flags.${MODULE_ID}.${PAGE_FLAG}`]: flag,
        }]);
      } else {
        const top = Math.max(0, ...log.pages.map((p) => p.sort));
        await log.createEmbeddedDocuments("JournalEntryPage", [{
          name: entry.region || t("SDE.codex.general"),
          type: "text",
          // The general page first; regions after it, in the order first met.
          sort: pageKey ? top + CONST.SORT_INTEGER_DENSITY : 0,
          text: { content },
          flags: { [MODULE_ID]: { [PAGE_FLAG]: flag } },
        }]);
      }
      return entry;
    } catch (err) {
      console.warn(`${MODULE_ID} | the encounter codex could not be written`, err);
      return null;
    }
  });
}

/** The query handler: a GM's line, written here when this is the active GM. */
export function handleCodexQuery(data, user) {
  const refusal = refuseQuery(user, t("SDE.codex.relayLabel"));
  if (refusal) return refusal;
  if (!user.isGM) return { ok: false, error: t("SDE.shared.relay.notOwner") };
  const entry = cleanEntry(data);
  return entry ? writeEntry(entry).then(() => ({ ok: true })) : { ok: false, error: t("SDE.shared.relay.emptyReply") };
}

export function registerCodex() {
  registerQuery(QUERY, (data, { user } = {}) => handleCodexQuery(data, user));
}

/**
 * File one encounter in the codex (GM). Only for an encounter the players have
 * seen: `postEncounter` calls it for a public post, the battle map for a fight
 * brought to the table. A second call for the same draw is a no-op.
 * @param {object} res  the drawn encounter (`drawEncounter`'s entry, or its card)
 * @param {{at?:number, facets?:boolean}} [opts]  at: the hour it happened (default: the draw's own, else now);
 *   facets: false for a fight brought to the table, whose private rolls the players never saw
 * @returns {Promise<object|null>} the entry written, or null
 */
export async function recordEncounter(res, { at = null, facets = true } = {}) {
  // A battle record's encounter is a creature without a kind.
  const kind = res?.kind ?? (res?.uuid || res?.name ? "monster" : "empty");
  if (!game.user?.isGM || !res || kind === "empty") return null;
  try {
    const when = Number.isFinite(Number(at ?? res.at)) ? Number(at ?? res.at) : game.time.worldTime;
    const hex = await whereHex();
    const text = kind === "flavor" ? String(res.text ?? "").replace(/<[^>]*>/g, "").trim() : null;
    if (kind === "flavor" && !text) return null;
    const entry = {
      key: entryKey({ ...res, at: when }),
      at: when,
      when: whenText(when),
      where: whereText(hex),
      region: hex?.region ?? null,
      kind,
      name: kind === "monster" ? (res.name ?? null) : null,
      count: kind === "monster" ? (res.count ?? 1) : null,
      img: kind === "monster" ? (res.img ?? null) : null,
      facets: kind === "monster" && facets ? facetText(res) : null,
      text,
      heading: kind === "flavor" ? (res.heading ?? null) : null,
      poi: !!res.poi,
    };
    if (isActiveGM()) return await writeEntry(entry);
    // Another GM writes it, so two GMs never race on one page (or make the journal twice).
    const reply = await queryActiveGM(QUERY, entry, { label: t("SDE.codex.relayLabel") });
    return reply?.ok ? entry : null;
  } catch (err) {
    console.warn(`${MODULE_ID} | the encounter codex could not be written`, err);
    return null;
  }
}
