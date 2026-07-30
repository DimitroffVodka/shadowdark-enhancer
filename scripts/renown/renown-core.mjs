/**
 * Renown — pure core (Foundry-free, node-tested).
 *
 * Renown is a Western Reaches (p233) character track. The system already owns
 * the number: `system.renown` on the Shadowdark Player model
 * (systems/shadowdark/src/models/PlayerSD.mjs — NumberField, integer, initial
 * 0, NO min, so it is allowed to go negative). Nothing here defines schema;
 * this file is the band ladder, the bonus lookup and the phrasing helpers that
 * the window, the chat card, the recap and the Discord export all share.
 *
 * CONTENT NOTE: the four band descriptions below are OUR compressed wording,
 * not the book's. The band thresholds and the bonus numbers are mechanics and
 * ship as mechanics, exactly like the reaction bands in encounter-result.mjs;
 * the book's own social paragraphs do not ship. See docs/wiki/Renown.md.
 */

/**
 * The four bands, low to high. `max` is inclusive; the top band is open-ended.
 * `bonus` is the renown bonus that band grants.
 */
export const RENOWN_BANDS = [
  {
    key: "unknown",
    label: "Unknown",
    max: 3,
    bonus: 0,
    note: "No one who matters knows your face.",
  },
  {
    key: "local",
    label: "Locally known",
    max: 7,
    bonus: 1,
    note: "Ordinary folk warm to you. Nobody grand does.",
  },
  {
    key: "name",
    label: "Known name",
    max: 11,
    bonus: 2,
    note: "The powerful treat you as one of their own.",
  },
  {
    key: "celebrity",
    label: "Celebrity",
    max: Infinity,
    bonus: 3,
    note: "Doors open everywhere, and important people defer.",
  },
];

/**
 * The triggers the book lists, as short labels only. These populate the award
 * dialog's suggestion list; every one of them is the GM's judgement call at the
 * table, which is why nothing here fires automatically except a level gain.
 */
export const RENOWN_TRIGGERS = {
  gains: [
    "Gained a level",
    "Honoured in public",
    "Lavish public spending",
    "A major triumph",
  ],
  losses: [
    "Public humiliation",
    "Trouble with the law",
    "A fashion misstep",
    "A cultural blunder",
    "Offended someone grander",
  ],
};

/** Coerce anything to a finite integer renown value. Unset/garbage ⇒ 0. */
export function renownValue(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * The band a renown value falls in.
 * @param {number} value
 * @returns {{key:string, label:string, max:number, bonus:number, note:string}}
 */
export function renownBand(value) {
  const v = renownValue(value);
  return RENOWN_BANDS.find((b) => v <= b.max) ?? RENOWN_BANDS[RENOWN_BANDS.length - 1];
}

/**
 * The bonus a renown value grants (0–3).
 *
 * The book applies it to reaction rolls AND carousing event rolls. Only the
 * reaction roll is automated (encounter-roller-app.mjs) — the module has no
 * carousing roll to hook, so carousing is applied by hand at the table. Do not
 * describe this as automatic anywhere user-facing.
 */
export function renownBonus(value) {
  return renownBand(value).bonus;
}

/**
 * Who may change renown. Pure, so the rule is testable without a Foundry client.
 *
 * An award writes an actor AND the `sessionRecap` world setting, so a non-GM
 * caller could not finish it — it refuses rather than half-applying. This is
 * also the check the query handler runs against its authenticated sender:
 * the handler is registered on GM clients, and a query's recipient is chosen by
 * the SENDER, so a player can address it directly and nothing else in that path
 * would turn them away.
 *
 * @param {{requesterIsGM:boolean}} ctx
 * @returns {null|{ok:false, error:string}} null when the award may proceed.
 */
export function authorizeRenownAward({ requesterIsGM } = {}) {
  if (!requesterIsGM) return { ok: false, error: "Only a GM can change renown." };
  return null;
}

/**
 * A PC's renown starts at their CHA modifier, and may start negative.
 * @param {number} chaMod
 */
export function startingRenown(chaMod) {
  return renownValue(chaMod);
}

/**
 * How many ledger entries a character keeps. Old entries fall off the front.
 *
 * The ledger lives in an actor flag, so it is part of the actor document and
 * travels with an export — it needs a ceiling. 50 changes is several campaigns
 * of a track that moves a point at a time.
 */
export const RENOWN_HISTORY_CAP = 50;

/**
 * Whether a character is still eligible for its one automatic starting seed.
 *
 * Pure, because this is the rule that decides whether an automatic write touches
 * a live character, and it must be testable without a Foundry client.
 *
 * Three conditions, and all three exist to stop the seed landing on somebody
 * whose renown is already meaningful:
 *
 *   - `seeded` — the flag stamped by a seed that actually moved the number. A
 *     seed of +0 (a CHA modifier of 0) deliberately does NOT stamp: a blank
 *     actor created before its abilities are rolled reads CHA 10, and stamping
 *     there would burn the seed on a placeholder.
 *   - `renown` — a non-zero value is somebody's real score, whether it was
 *     awarded, typed on the sheet, or came in with an imported character.
 *   - `historyCount` — a character docked back to exactly 0 has a non-zero score
 *     in every sense that matters, and the ledger is what proves it.
 *
 * @param {{seeded?:boolean, renown?:number, historyCount?:number}} ctx
 * @returns {boolean}
 */
export function shouldSeedStartingRenown({ seeded = false, renown = 0, historyCount = 0 } = {}) {
  if (seeded) return false;
  if (renownValue(renown) !== 0) return false;
  if (renownValue(historyCount) > 0) return false;
  return true;
}

/**
 * Append one entry to a character's renown ledger, oldest first, capped.
 *
 * Returns a NEW array and never mutates the input, because the input is a live
 * actor flag value.
 *
 * @param {Array<object>} existing  the stored ledger; junk is treated as empty
 * @param {object} entry            the change to record
 * @param {{cap?:number}} [opts]
 * @returns {Array<object>}
 */
export function appendRenownHistory(existing, entry, { cap = RENOWN_HISTORY_CAP } = {}) {
  const rows = Array.isArray(existing) ? existing.filter((r) => r && typeof r === "object") : [];
  const next = [...rows, {
    delta: renownValue(entry?.delta),
    before: renownValue(entry?.before),
    after: renownValue(entry?.after),
    reason: String(entry?.reason ?? ""),
    source: String(entry?.source ?? "gm"),
    player: String(entry?.player ?? "GM"),
    gm: String(entry?.gm ?? ""),
    at: renownValue(entry?.at),
  }];
  const limit = Math.max(1, renownValue(cap));
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * What each `source` tag means in the ledger, for an entry with no GM reason.
 * The tags themselves are the provenance values `Renown.award` accepts.
 */
export const RENOWN_SOURCE_LABELS = {
  gm: "GM adjustment",
  start: "Starting renown",
  "level-up": "Gained a level",
  downtime: "Downtime",
  external: "Changed outside the module",
};

/**
 * One ledger line for display: the change, the resulting total, and why.
 * Pure and markup-free, like `recapRow` — the caller adds the bullet.
 * @param {{delta?:number, after?:number, reason?:string, source?:string}} entry
 */
export function historyRow(entry = {}) {
  const head = `${signedRenown(entry?.delta)} → ${renownValue(entry?.after)}`;
  const reason = String(entry?.reason ?? "").trim();
  const source = String(entry?.source ?? "").trim();
  const tail = reason || RENOWN_SOURCE_LABELS[source] || source;
  return tail ? `${head} · ${tail}` : head;
}

/**
 * Group a flat ledger by the player who owns the character.
 *
 * The per-player view is the one the table asks for — "what has my character
 * done?" — and a character's owner is captured on each entry rather than looked
 * up at read time, so a reassigned character keeps its history intact.
 *
 * @param {Array<{player?:string, actorName?:string, delta?:number}>} entries
 * @returns {Array<{player:string, net:number, count:number, entries:Array<object>}>}
 */
export function groupHistoryByPlayer(entries) {
  const rows = Array.isArray(entries) ? entries.filter((r) => r && typeof r === "object") : [];
  const byPlayer = new Map();

  for (const row of rows) {
    const player = String(row.player ?? "GM") || "GM";
    if (!byPlayer.has(player)) byPlayer.set(player, { player, net: 0, count: 0, entries: [] });
    const bucket = byPlayer.get(player);
    bucket.net += renownValue(row.delta);
    bucket.count += 1;
    bucket.entries.push(row);
  }

  return [...byPlayer.values()].sort((a, b) => a.player.localeCompare(b.player));
}

/** "+2" / "-1" / "0" — the sign is always explicit for a positive delta. */
export function signedRenown(delta) {
  const n = renownValue(delta);
  return n > 0 ? `+${n}` : String(n);
}

/**
 * One-line summary of a renown change, shared by the chat card, the
 * notification and the recap row so all three read alike.
 * @param {{actorName?:string, delta:number, after:number}} change
 */
export function renownChangeLine({ actorName = "Someone", delta = 0, after = 0 } = {}) {
  const band = renownBand(after);
  return `${actorName}: renown ${signedRenown(delta)} → ${renownValue(after)} (${band.label})`;
}

/**
 * The recap / Discord row for one logged renown change. Mirrors
 * downtime-log-core's `recapRow`: pure, no markup, caller adds the bullet.
 * @param {{actorName?:string, delta?:number, after?:number, reason?:string}} entry
 */
export function recapRow(entry = {}) {
  const line = renownChangeLine({
    actorName: entry.actorName,
    delta: entry.delta,
    after: entry.after,
  });
  const reason = String(entry.reason ?? "").trim();
  return reason ? `${line} — ${reason}` : line;
}

/**
 * Whether a 2d6 reaction roll came up double 1s.
 *
 * The roller keeps only the 2d6 TOTAL, which is enough: on two six-sided dice a
 * total of 2 can only be 1+1. Double 1s are always a hostile reaction, whatever
 * the CHA modifier and renown bonus add up to.
 *
 * @param {number} total  the raw 2d6 total, before any modifier
 */
export function isDoubleOnes(total) {
  return renownValue(total) === 2;
}
