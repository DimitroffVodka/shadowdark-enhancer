/**
 * Shadowdark Enhancer — an adventure's treasure as items.
 *
 * The Lost Citadel quickstart files every priced treasure of its key as an item of its own (a pearl, a jade bracelet, a
 * scroll) in a folder per room, and its text links them. This does the same for the books': a thing the key prices,
 * "a blue pearl (40 gp)", becomes a Gem (or a treasure Basic item) worth that much, and a spell scroll the key names
 * becomes a scroll item that points at its spell. Pure: it reads a page's text and says what to make; the filing is in
 * adventure-commit.mjs. Read at import time from the GM's own book, never shipped.
 */

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, dozen: 12 };

/** The words of a gem: such a thing is a Gem item, and picks its icon by them. */
const GEMS = [
  [/pearl/i, "pearl-natural"], [/ruby|rubies/i, "gem-faceted-rough-red"], [/emerald/i, "gem-faceted-rough-green"],
  [/sapphire/i, "gem-faceted-rough-blue"], [/amethyst|purple/i, "gem-faceted-rough-purple"], [/topaz|citrine/i, "gem-faceted-rough-yellow"],
  [/diamond/i, "gem-faceted-diamond-silver-"], [/opal|moonstone/i, "gem-faceted-round-white"], [/obsidian chip|onyx chip/i, "gem-faceted-round-black"],
  [/\bgems?\b|crystals?|geode|jewels?\b|chips?\b|chunks?\b/i, "gem-fragments-rough-grey"],
];
/** A thing is a Gem when its last word is one: "ruby chip", "pearl", not a "pearl torc". */
const GEM_HEAD_RE = /^(?:pearl|ruby|emerald|sapphire|amethyst|topaz|citrine|diamond|opal|moonstone|gem|crystal|geode|jewel|chip|chunk)$/i;
const GEM_DIR = "icons/commodities/gems/";
const TREASURE_ICON = "icons/commodities/currency/coins-plain-pouch-gold.webp";
const SCROLL_ICON = "icons/sundries/scrolls/scroll-bound-green.webp";

/** Words that end a thing's name: where the key goes on to say where it is or what it is set with. */
const TAIL_RE = /\s+(?:in|on|inside|within|at|from|embedded|hidden|buried|beneath|under|atop|held|hangs?|glints?|sits?|lies|left|each|per|that|which|shaped like|carved|adorned|encased|embroidered|scattered|set|is|are|looking)\b.*$/i;
/** A clause's lead-in, up to the verb that hands the thing over: "One wears a silver rosary" → "a silver rosary". */
const LEAD_RE = /^.*\b(?:wears?|holds?|has|have|contains?|reveals?|clutche?s|houses?|carr(?:y|ies)|bears?|wields?|includes?|finds?|hides?|tossing|including|holding|over|inside|reveal|(?:is|are)(?=\s+an?\s))\s+/i;
const DETERMINER_RE = /^(?:a stack of|a handful of|neat pyramid of|pyramid of|a pile of|piles of|a set of|a pair of|an?|the|some|each|every|\d[\d,]*|(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|dozen))\s+/i;
/** Never a thing to carry off: coins and the clause's own bookkeeping. */
const SKIP_RE = /\b(?:coins?|gp|sp|cp|total|rounds?|purchase|buy|reward|pays?|spectral|items)\b/i;

const lower = new Set(["of", "a", "an", "the", "and", "in", "on", "with", "for", "to"]);
/** "alabaster statuette of a bull" → "Alabaster Statuette of a Bull" */
export const titleCase = (s) => String(s).toLowerCase().replace(/[a-z][\p{L}'’-]*/gu, (w, i) => (i > 0 && lower.has(w) ? w : w[0].toUpperCase() + w.slice(1)));

/** "chunks" → "chunk", "rubies" → "ruby", "teeth" → "tooth": a name for one of them. */
export function singular(word) {
  const w = String(word);
  if (/teeth$/i.test(w)) return w.replace(/teeth$/i, "tooth");
  if (/ies$/i.test(w)) return w.replace(/ies$/i, "y");
  if (/(?:ch|sh|ss|x)es$/i.test(w)) return w.replace(/es$/i, "");
  if (/[^s]s$/i.test(w) && !/(?:us|is)$/i.test(w)) return w.slice(0, -1);
  return w;
}

/**
 * What the key says is the priced thing, out of the words in front of its price: "Sifting reveals dozens of teeth and a blue
 * pearl" → "blue pearl", "20 iridescent meteorite chunks inside" → 20 × "iridescent meteorite chunks".
 * @param {string} before
 * @returns {{phrase:string, count:number}|null}  null when it does not read as a thing
 */
export function treasurePhrase(before) {
  let s = String(before).replace(/\s+/g, " ").trim();
  // The last clause: after a sentence or list break, or after "and" when a new thing (an article or a number) follows it.
  const cut = [...s.matchAll(/[.;:,]\s+|\s+and\s+(?=(?:an?|the|some|\d|one|two|three|four|five|six|seven|eight|nine|ten)\s)/gi)].at(-1);
  if (cut) s = s.slice(cut.index + cut[0].length);
  // ", and a skull…" continues a list whose head is not here.
  if (cut && /^,/.test(cut[0]) && /^(?:and|or)\s/i.test(s)) return null;
  s = s.replace(/^[,.;:\s]+/, "").replace(LEAD_RE, "");
  let count = 1;
  for (let guard = 0; guard < 4; guard++) {
    const m = DETERMINER_RE.exec(s);
    if (!m) break;
    const w = m[1] ?? m[0].trim();
    const n = /^\d/.test(w) ? Number(w.replace(/,/g, "")) : NUMBER_WORDS[w.toLowerCase()];
    if (n) count = n;
    s = s.slice(m[0].length);
  }
  const tail = TAIL_RE.exec(s)?.[0] ?? "";
  s = s.replace(TAIL_RE, "").replace(/[,\s]+$/, "");
  if (/^(?:iron|gold|silver|copper|electrum|platinum|steel|bronze|mithral)$/i.test(s) || /\b(?:sits?|hangs?|lies|glints?|looking)\b/i.test(tail)) return null;
  if (!s || s.split(" ").length > 6 || SKIP_RE.test(s) || /^\d/.test(s) || !/[a-z]{3}/i.test(s)) return null;
  return { phrase: s, count };
}

/** "5 gp each" / "1,500 gp" / "10gp per" → { gp, sp, cp, each }. */
function priceOf(text) {
  const m = /^\s*(\d[\d,]*)\s*(gp|sp|cp)\b([^)]*)/i.exec(text);
  if (!m) return null;
  return { amount: Number(m[1].replace(/,/g, "")), unit: m[2].toLowerCase(), each: /\b(?:each|per)\b/i.test(m[3]) };
}

/**
 * The priced things a page's text names, each once, in order. Text only, never markup, an existing link or an inline roll.
 * @param {string} html
 * @returns {Array<{phrase:string, name:string, count:number, cost:{gp:number,sp:number,cp:number}, gem:boolean, img:string}>}
 */
export function findTreasure(html) {
  const found = [];
  const seen = new Set();
  for (const [i, seg] of String(html ?? "").split(/(<[^>]+>|@UUID\[[^\]]*\]\{[^}]*\}|\[\[[^\]]*\]\]|@@LOC\[[^\]]*\]\{[^}]*\}@@)/).entries()) {
    if (i % 2) continue;
    for (const m of seg.matchAll(/\(\s*(\d[\d,]*\s*(?:gp|sp|cp)\b[^)]*)\)/gi)) {
      const price = priceOf(m[1]);
      const thing = price && treasurePhrase(seg.slice(0, m.index));
      if (!thing) continue;
      const each = price.each || thing.count === 1 || price.amount % thing.count !== 0 ? price.amount : price.amount / thing.count;
      const count = price.each || price.amount % thing.count === 0 ? thing.count : 1;
      const words = thing.phrase.split(" ");
      const name = titleCase([...words.slice(0, -1), count > 1 ? singular(words.at(-1)) : words.at(-1)].join(" "));
      if (seen.has(`${name}|${each}${price.unit}`)) continue;
      seen.add(`${name}|${each}${price.unit}`);
      const head = name.split(/\s(?:with|of)\s/i)[0].split(" ").at(-1);
      const gem = GEM_HEAD_RE.test(singular(head)) ? GEMS.find(([re]) => re.test(name)) : null;
      found.push({
        phrase: thing.phrase, name, count, cost: { gp: 0, sp: 0, cp: 0, [price.unit]: each },
        gem: !!gem, img: gem ? `${GEM_DIR}${gem[1]}.webp` : TREASURE_ICON,
      });
    }
  }
  return found;
}

/**
 * The spell scrolls a page's text names ("Scroll of Charm Person", "Spell Scroll of Mirror Image") whose spell the system has,
 * minus those the system already has as items.
 * @param {string} html
 * @param {Array<{name:string, uuid:string}>} spells
 * @param {Set<string>} [have]  lower-case names of the scroll items that already exist
 * @returns {Array<{phrase:string, name:string, spell:{name:string,uuid:string}}>}
 */
export function findScrolls(html, spells, have = new Set()) {
  const list = [...(spells ?? [])].sort((a, b) => b.name.length - a.name.length);
  if (!list.length || !html) return [];
  const byLower = new Map(list.map((s) => [s.name.toLowerCase(), s]));
  const re = new RegExp(`\\b(?:Spell )?Scroll of (${list.map((s) => s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "g");
  const out = [];
  const seen = new Set();
  for (const [i, seg] of String(html).split(/(<[^>]+>|@UUID\[[^\]]*\]\{[^}]*\}|\[\[[^\]]*\]\]|@@LOC\[[^\]]*\]\{[^}]*\}@@)/).entries()) {
    if (i % 2) continue;
    for (const m of seg.matchAll(re)) {
      const spell = byLower.get(m[1].toLowerCase());
      const name = `Scroll of ${spell.name}`;
      if (have.has(name.toLowerCase()) || seen.has(m[0])) continue;
      seen.add(m[0]);
      out.push({ phrase: m[0], name, spell });
    }
  }
  return out;
}

/** The item data of one found treasure: a Gem for a gem, a treasure Basic item for the rest. */
export function treasureItemData(t, { source = "" } = {}) {
  const base = { name: t.name, img: t.img, system: { cost: t.cost, quantity: t.count, source: { title: source } } };
  return t.gem ? { ...base, type: "Gem" } : { ...base, type: "Basic", system: { ...base.system, treasure: true } };
}

/** The item data of one found scroll: a magic Basic item whose description is its spell, as the quickstart's scrolls are. */
export const scrollItemData = (s, { source = "" } = {}) => ({
  name: s.name, type: "Basic", img: SCROLL_ICON,
  system: { magicItem: true, description: `<p>@UUID[${s.spell.uuid}]{${s.spell.name}}</p>`, source: { title: source } },
});
