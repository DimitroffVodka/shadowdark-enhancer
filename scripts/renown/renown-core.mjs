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

/** The reaction / carousing bonus a renown value grants (0–3). */
export function renownBonus(value) {
  return renownBand(value).bonus;
}

/**
 * A PC's renown starts at their CHA modifier, and may start negative.
 * @param {number} chaMod
 */
export function startingRenown(chaMod) {
  return renownValue(chaMod);
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
