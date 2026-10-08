/**
 * Shadowdark Enhancer — who is in each keyed location (pure).
 *
 * The books set a creature's name in bold and give its number in plain type just
 * before it ("12 unruly **Howlers** make squalid camp"), or as a bold bullet label
 * with the number after it ("• **Skeletons.** Three."). That is the whole rule:
 * a bold phrase that names a creature, with a count beside it. Anything else in a
 * room's text (a creature mentioned from another room, a corpse, a carving) is
 * not a count and places nothing, a creature said to be in another Area is that
 * Area's, and a count that is a die roll ("1d4") or a chance ("2:6") is the GM's
 * to roll, so it places nothing either.
 *
 * The same bold names are linked in the filed text: a bold run the bestiary knows
 * becomes an `@UUID` link to that creature (`inlineHtml` in adventure-parser), so a room's
 * journal page opens the stat block it names.
 *
 * Works on the marked lines the parser keeps (`boldLines`); reads the GM's own
 * book at run time, ships no text. Every string in the tests is invented.
 */

import { BOLD_OPEN, BOLD_CLOSE, stripBold } from "../pdf-text-utils.mjs";

const WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, dozen: 12, fifteen: 15, twenty: 20,
};
const NUM = `\\d{1,3}|${Object.keys(WORDS).join("|")}`;
/** What a number is not a head-count of: "Area 4", "DC 15", "pg 42", "LV 3", "+2". */
const NOT_A_COUNT = /(?:\b(?:areas?|rooms?|dc|pg|pgs|page|lv|level|ac|hp|d)|[+#-])\s*$/i;

/** Right after a name: where the creatures are, and it is another location. */
const ELSEWHERE = /^[^.;•▶]{0,30}?\b(?:in|from|at|near|to)\s+(?:the\s+)?Areas?\s+\d/i;

const numberOf = (tok) => (/^\d+$/.test(tok) ? Number(tok) : WORDS[tok.toLowerCase()]);

/** A name or a bold phrase as lower-case words: no parenthetical, no punctuation. */
const words = (text) => String(text ?? "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9'’\- ]+/g, " ").trim().split(/\s+/).filter(Boolean);

/**
 * Every singular a bold phrase can be read as, most literal first: "giant ants" →
 * "giant ants", "giant ant"; "zombies" → "zombies", "zombie", "zomby"; "wolves" →
 * "wolves", "wolf", "wolfe". The bestiary decides which one is a creature.
 * @param {string} text
 * @returns {string[]}
 */
export function phraseKeys(text) {
  const head = words(text), last = head.pop();
  if (!last) return [];
  const forms = new Set([last]);
  if (/ies$/.test(last)) { forms.add(last.slice(0, -1)); forms.add(`${last.slice(0, -3)}y`); }
  if (/ves$/.test(last)) { forms.add(`${last.slice(0, -3)}f`); forms.add(`${last.slice(0, -3)}fe`); }
  if (/men$/.test(last)) forms.add(`${last.slice(0, -3)}man`);
  if (/(?:ch|sh|x|ss)es$/.test(last)) forms.add(last.slice(0, -2));
  if (/[^s]s$/.test(last)) forms.add(last.slice(0, -1));
  if (/['’]s$/.test(last)) forms.add(last.slice(0, -2));   // "Plogrina's" is Plogrina
  return [...forms].map((f) => [...head, f].join(" "));
}

/**
 * Every key a bestiary name answers to. A name with a comma is how the system
 * files a kind ("Rat, Giant"), and the books say it the other way round
 * ("giant rats").
 * @param {string} name
 * @returns {string[]}
 */
export function nameKeys(name) {
  const [head, ...rest] = String(name ?? "").replace(/\s*\([^)]*\)/g, "").split(/,\s*/);
  const keys = new Set([words(`${head} ${rest.join(" ")}`.trim()).join(" ")]);
  if (rest.length) keys.add(words(`${rest.join(" ")} ${head}`).join(" "));
  return [...keys].filter(Boolean);
}

/** Bold phrase → the words that can name a creature: no bullet, arrow or label punctuation. */
const phraseOf = (run) => run.replace(/^[•▶►\s]+/, "").replace(/[.:,;\s]+$/, "").trim();

/**
 * The creatures a location names with a count.
 * @param {string[]} boldLines  a location's body lines with bold markers (parser `boldLines`)
 * @returns {Array<{phrase:string, count:number}>}  one per distinct bold phrase, the largest count it was given
 */
export function creatureMentions(boldLines) {
  const text = boldLines.reduce((acc, ln) => (/[A-Za-z]-$/.test(acc) && !ln.startsWith(BOLD_OPEN) ? acc.slice(0, -1) + ln : `${acc} ${ln}`), "").replace(/\s+/g, " ");
  const found = new Map();
  const add = (phrase, count) => {
    const key = phrase.toLowerCase();
    if (!key || !(count > 0)) return;
    if (!found.has(key) || found.get(key).count < count) found.set(key, { phrase, count });
  };
  const runs = [...text.matchAll(new RegExp(`${BOLD_OPEN}([^${BOLD_CLOSE}]*)${BOLD_CLOSE}`, "g"))];
  for (const m of runs) {
    const phrase = phraseOf(m[1]);
    if (!phrase || phrase.length > 40) continue;
    const before = text.slice(0, m.index);
    const after = text.slice(m.index + m[0].length);
    // "Four captive [frost trolls] lurk in Area 46": they are in that room, not this one.
    if (ELSEWHERE.test(stripBold(after).slice(0, 45))) continue;

    // "12 unruly [Howlers]", "4 [giant ants]", "Two monks ([acolytes])": a number, up to
    // three plain words, then the bold name.
    const lead = new RegExp(`(?:^|[^\\w:])(${NUM})\\s+(?:[A-Za-z'’-]+\\s+){0,3}\\(?$`, "i").exec(before);
    if (lead && !NOT_A_COUNT.test(before.slice(0, lead.index + lead[0].indexOf(lead[1])))) { add(phrase, numberOf(lead[1])); continue; }
    // "[• Skeletons.] Three.", "[• Duergar.] Two chip at the stone": a bold label, then its number.
    if (/[.:]$/.test(m[1].trim()) || /^[•▶►]/.test(m[1].trim())) {
      const tail = new RegExp(`^\\s*(${NUM})(?![\\d:dD/-])\\b`, "i").exec(stripBold(after));
      // "• People. 12 unruly [Howlers]": that number belongs to the bold name after it.
      const theirs = new RegExp(`^\\s*(?:${NUM})\\s+(?:[A-Za-z'’-]+\\s+){0,3}${BOLD_OPEN}`, "i").test(after);
      if (tail && !theirs) add(phrase, numberOf(tail[1]));
    }
  }
  return [...found.values()];
}

/**
 * Resolve the mentions against a bestiary: who is in this location, as the
 * bestiary calls them. A phrase the bestiary does not know is left out (the
 * caller reports it).
 * @param {Array<{phrase:string, count:number}>} mentions
 * @param {(key:string)=>string|undefined} lookup  name key → the bestiary's name (bestiaryLookup)
 * @returns {{creatures:Array<{monster:string, count:number}>, unknown:string[]}}
 */
export function resolveMentions(mentions, lookup) {
  const byName = new Map(), unknown = [];
  for (const { phrase, count } of mentions) {
    const monster = phraseKeys(phrase).map(lookup).find(Boolean);
    if (!monster) { unknown.push(phrase); continue; }
    byName.set(monster, Math.max(byName.get(monster) ?? 0, count));
  }
  return { creatures: [...byName].map(([monster, count]) => ({ monster, count })), unknown };
}

/** Pure: a lookup over a bestiary's names (core first, so it wins a clash). */
export function bestiaryLookup(names) {
  const map = new Map();
  for (const name of names) for (const key of nameKeys(name)) if (!map.has(key)) map.set(key, name);
  return (key) => map.get(key);
}

/**
 * Pure: phrase → creature link target, over a bestiary index.
 * @param {Array<{name:string, uuid:string, type?:string}>} index  the world's monsters (core first)
 * @param {Record<string,string>} [aliases]  what a book calls a creature that is not its bestiary name
 *   ("monk" → "Acolyte"): a singular phrase, lower case, → a bestiary name
 * @returns {(phrase:string)=>string|undefined}  the creature's uuid, or undefined
 */
export function creatureResolver(index, aliases = {}) {
  const npcs = (index ?? []).filter((e) => e.type === "NPC");
  const lookup = bestiaryLookup(npcs.map((e) => e.name));
  const uuidOf = new Map(npcs.map((e) => [e.name, e.uuid]));
  const alias = Object.fromEntries(Object.entries(aliases ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  // The books call a person by their first name after the first time ("Gordock", for "Gordock Breeg"): an NPC the GM
  // imported answers to it, unless two of them share it. The system's own creatures never do ("Red Knight" is not "Red").
  const first = new Map(), shared = new Set();
  for (const e of npcs) {
    const w = words(e.name);
    if (w.length < 2 || /^Compendium\.shadowdark\./.test(e.uuid ?? "")) continue;
    if (first.has(w[0]) && first.get(w[0]) !== e.name) shared.add(w[0]); else first.set(w[0], e.name);
  }
  return (phrase) => {
    const keys = phraseKeys(phrase);
    const name = keys.map(lookup).find(Boolean) ?? keys.map((k) => alias[k]).find(Boolean)
      ?? (keys.length && !/\s/.test(keys[0]) ? first.get(keys.find((k) => first.has(k) && !shared.has(k))) : undefined);
    return name ? uuidOf.get(name) : undefined;
  };
}

/**
 * Pure: every way an adventure's text names the creatures it sets in bold, to link a mention that the book printed in plain
 * type too ("if Howlers are there", beside the room that has them in bold). One entry per surface form: the bold phrase,
 * its singular and its plural, and an NPC's first name ("Gordock" for "Gordock Breeg").
 * @param {Array<{boldLines?:string[]}>} locations  a site's parsed locations
 * @param {(phrase:string)=>string|undefined} resolve  creatureResolver
 * @returns {Array<{form:string, uuid:string}>}  longest form first
 */
export function creatureVocabulary(locations, resolve) {
  if (!resolve) return [];
  const forms = new Map();
  const add = (form, uuid) => { if (form.length >= 4 && !forms.has(form)) forms.set(form, uuid); };
  for (const loc of locations ?? []) {
    const text = (loc.boldLines ?? []).join(" ");
    for (const m of text.matchAll(new RegExp(`${BOLD_OPEN}([^${BOLD_CLOSE}]*)${BOLD_CLOSE}`, "g"))) {
      let phrase = phraseOf(m[1]);
      if (!phrase || phrase.length > 40 || !/[a-z]/.test(phrase)) continue;
      let uuid = resolve(phrase);
      // "Pool. Mugdulblub": a run-in label and a name in one bold run.
      if (!uuid && phrase.includes(". ")) { phrase = phrase.slice(phrase.lastIndexOf(". ") + 2); uuid = resolve(phrase); }
      if (!uuid) continue;
      const lower = words(phrase).join(" ");
      for (const f of [lower, ...phraseKeys(phrase)]) { add(f, uuid); if (!f.endsWith("s")) add(`${f}s`, uuid); }
      const first = words(phrase)[0];
      if (first && first !== lower && resolve(first) === uuid) add(first, uuid);
    }
  }
  return [...forms].map(([form, uuid]) => ({ form, uuid })).sort((a, b) => b.form.length - a.form.length);
}
