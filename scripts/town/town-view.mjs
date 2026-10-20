/**
 * Shadowdark Enhancer — what the Town window and the shopfront show (pure).
 *
 * The windows are thin: they gather the world's facts (the scene's landing page, the NPC's items, the buyer's coins)
 * and these functions turn them into the cards, tiles and rows the templates draw. `t(key, data)` localizes (the
 * windows pass the real one; tests pass a stand-in), so nothing here needs Foundry.
 */
import { canAfford, fromCopper, formatPrice } from "../shared/coins.mjs";
import { quoteLine, sellCopper, bundleOf, STOCK_TYPES } from "../merchant/shop-core.mjs";
import { PLACE_LABEL_KEYS } from "./town-core.mjs";

/** The shopfront's filter chips. `gear` is the system's Basic items. */
export const CATEGORIES = [
  { id: "all", key: "SDE.town.cat.all", types: null },
  { id: "weapon", key: "SDE.town.cat.weapon", types: ["Weapon"] },
  { id: "armor", key: "SDE.town.cat.armor", types: ["Armor"] },
  { id: "gear", key: "SDE.town.cat.gear", types: ["Basic"] },
];
export const TYPE_LABEL_KEYS = { Weapon: "SDE.town.type.weapon", Armor: "SDE.town.type.armor", Basic: "SDE.town.type.gear" };
export const PLACE_ICONS = { quests: "fa-list-check", journals: "fa-book-open", recaps: "fa-scroll", party: "fa-people-group", map: "fa-map", downtime: "fa-hourglass-half", carouse: "fa-beer-mug-empty", rumors: "fa-comments", games: "fa-dice" };
export const PLACE_SUB_KEYS = {
  quests: "SDE.town.sub.quests", journals: "SDE.town.sub.journals", recaps: "SDE.town.sub.recaps", party: "SDE.town.sub.party", map: "SDE.town.sub.map", downtime: "SDE.town.sub.downtime", carouse: "SDE.town.sub.carouse", rumors: "SDE.town.sub.rumors", games: "SDE.town.sub.games",
};

/** A price as the coins it is made of, for the card ("9 gp", "6 gp 5 sp"). A price of nothing has no parts. */
export const priceParts = (cost) => ["gp", "sp", "cp"].filter((u) => cost?.[u]).map((u) => ({ n: cost[u], u }));

/** A purse as text: the coins it holds, or "0 gp". */
export const purseText = (coins) => (priceParts(coins).length ? priceParts(coins).map((p) => `${p.n} ${p.u}`).join(" ") : "0 gp");

const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
/** An item's description as plain text, at most `max` characters (the markup and entities are stripped, never shown). */
export function plainText(html, max = 400) {
  const text = String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const RANGE_KEYS = { close: "SDE.town.fact.close", near: "SDE.town.fact.near", far: "SDE.town.fact.far" };

/**
 * What a buyer wants to know about a ware at a glance, from the item's own stats, so a ware with no description still
 * says what it is: a weapon's kind, range and damage, an armor's AC, the slots it takes, and the names of its
 * properties. `propName(uuid)` names a property (the system keeps them as compendium links) and gives "" when it cannot.
 */
export function wareFacts(item, { t, propName = () => "" }) {
  const s = item?.system ?? {}, out = [];
  if (item?.type === "Weapon") {
    out.push(t(s.type === "ranged" ? "SDE.town.fact.ranged" : "SDE.town.fact.melee"));
    if (RANGE_KEYS[s.range]) out.push(t(RANGE_KEYS[s.range]));
    const one = s.damage?.oneHanded, two = s.damage?.twoHanded;
    if (one && two) out.push(t("SDE.town.fact.damageVersatile", { one, two }));
    else if (one) out.push(t("SDE.town.fact.damage", { dice: one }));
    else if (two) out.push(t("SDE.town.fact.damageTwo", { dice: two }));
  }
  if (item?.type === "Armor") {
    const ac = s.ac ?? {};
    if (ac.base) out.push(ac.attribute ? t("SDE.town.fact.acStat", { n: ac.base, stat: String(ac.attribute).toUpperCase() }) : t("SDE.town.fact.ac", { n: ac.base }));
    if (ac.modifier) out.push(t("SDE.town.fact.acBonus", { n: ac.modifier }));
  }
  const per = Number(s.slots?.per_slot) || 1, used = Number(s.slots?.slots_used) || 1;
  if (per > 1) out.push(t("SDE.town.fact.perSlot", { n: per }));
  else if (used > 1) out.push(t("SDE.town.fact.slots", { n: used }));
  for (const link of s.properties ?? []) { const name = propName(link); if (name) out.push(name); }
  return out;
}

/**
 * The ware cards for a shelf (shop-core's `shelf`). `pct` is the buyer's haggle percent for this merchant (the extortion
 * bargain never shows on a card: it falls on one cart line only). `describe(entry)` gives a ware's whole description (shown for the one that is open); `blurb(entry)` its
 * short form, shown on every card; `facts(entry)` its facts (wareFacts); `rules(entry)` the `{ name, text }` of each
 * property, shown with the description. A card has a Details button (`more`) only when there is more to read.
 */
export function wareCards(shelf, { merchant, coins, category = "all", expandedId = null, pct = 0, describe = () => "", blurb = () => "", facts = () => [], rules = () => [], t }) {
  const types = CATEGORIES.find((c) => c.id === category)?.types ?? null;
  return shelf.filter((e) => !types || types.includes(e.type)).map((e) => {
    const price = fromCopper((quoteLine(e, 1, merchant, { pct }) ?? quoteLine({ ...e, stock: -1 }, 1, merchant, { pct })).copper);
    const out = e.stock === 0, unlimited = e.stock === -1, open = expandedId === e.id;
    const full = describe(e), short = blurb(e), props = rules(e);
    return {
      id: e.id, name: e.name, img: e.img, type: t(TYPE_LABEL_KEYS[e.type] ?? TYPE_LABEL_KEYS.Basic),
      price: priceParts(price), free: !priceParts(price).length, perBundle: e.bundle > 1 ? e.bundle : 0,
      stock: unlimited ? t("SDE.town.plenty") : t("SDE.town.left", { n: e.stock }), low: !unlimited && e.stock === 1, out, unlimited,
      poor: !out && !canAfford(coins, price), open, facts: facts(e), blurb: short, more: full.length > short.length || props.length > 0,
      desc: open ? full : "", rules: open ? props : [],
    };
  });
}

/** What a character can sell here: gear the merchant deals in, with what one unit pays. */
export function sellRows(items, merchant, { swing = (c) => c, facts = () => [], blurb = () => "", t }) {
  return [...items].filter((i) => STOCK_TYPES.includes(i.type)).map((i) => {
    const copper = swing(sellCopper(i.system?.cost, 1, merchant?.sellRatio ?? 50, bundleOf(i)));
    return { id: i.id, name: i.name, img: i.img, qty: i.system?.quantity ?? 1, pays: copper ? formatPrice(fromCopper(copper)) : t("SDE.town.nothing"), facts: facts(i), blurb: blurb(i) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What a character sold here and can take back: each lot with what they were paid, its facts, and whether they can
 * afford it now (`poor`). `lots` are lots-core lots, whose `data` is the item as it was handed over.
 */
export function lotRows(lots, { coins, facts = () => [], blurb = () => "", t }) {
  return [...lots].reverse().map((l) => ({
    id: l.id, name: l.name, img: l.img, qty: l.qty, paid: l.copper ? formatPrice(fromCopper(l.copper)) : t("SDE.town.nothing"),
    poor: !canAfford(coins, fromCopper(l.copper)), facts: facts(l.data), blurb: blurb(l.data),
  }));
}

/** The tiles that open other windows, for the places the GM left on. */
export function placeTiles(places, { isGM, hasParty, downtimeOpen, activeQuests, nightOpen = false, gmOnline = true, rumorsHeard = false, hasMap = true, t }) {
  return places.map((id) => {
    const tile = { id, icon: PLACE_ICONS[id], label: t(PLACE_LABEL_KEYS[id]), sub: t(PLACE_SUB_KEYS[id]), tag: "", disabled: false, hint: "" };
    if (id === "quests" && activeQuests) tile.tag = t("SDE.town.activeQuests", { n: activeQuests });
    if (id === "party" && !hasParty) Object.assign(tile, { disabled: true, hint: t("SDE.town.hint.party") });
    if (id === "map" && !hasMap) Object.assign(tile, { disabled: true, hint: t("SDE.town.hint.map") });
    if (id === "downtime" && !isGM && !downtimeOpen) Object.assign(tile, { disabled: true, hint: t("SDE.town.hint.downtime") });
    if (id === "carouse" && !isGM && !nightOpen) Object.assign(tile, { disabled: true, hint: t("SDE.town.hint.carouse") });
    if (id === "carouse" && !isGM && nightOpen && !gmOnline) Object.assign(tile, { disabled: true, hint: t("SDE.town.hint.carouseGM") });
    if (id === "rumors" && !isGM && !rumorsHeard) Object.assign(tile, { disabled: true, hint: t("SDE.town.hint.rumors") });
    return tile;
  });
}

/** The price note on a shopfront: how far the merchant's prices sit from list, or "" at list price. */
export function priceNote(merchant, t) {
  const pct = (merchant?.buyMultiplier ?? 100) - 100;
  return pct ? t("SDE.town.prices", { sign: pct > 0 ? "+" : "-", pct: Math.abs(pct) }) : "";
}

/**
 * Which of the user's characters buys: the one they chose in the window, else the token they have selected, else
 * the character their account is assigned to, else the first they own. `actors` are the choices (any `{ id }`).
 */
export function pickBuyer(actors, { chosenId = null, controlledId = null, assignedId = null } = {}) {
  const has = (id) => id && actors.find((a) => a.id === id);
  return has(chosenId) ?? has(controlledId) ?? has(assignedId) ?? actors[0] ?? null;
}

// ── the cart ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A cart is `[{ wareId, qty }]` (bundles), one line per ware. Add `by` bundles of a ware; a line at 0 or less goes. */
export function cartAdd(lines, wareId, by = 1) {
  const out = lines.map((l) => ({ ...l })), line = out.find((l) => l.wareId === wareId);
  if (line) line.qty += by; else if (by > 0) out.push({ wareId, qty: by });
  return out.filter((l) => l.qty > 0);
}

/**
 * Price a cart against the shelf as it is now. Lines for wares that are gone drop out; a line is cut to what the shelf
 * can fill (`adjusted`). `swing(copper)` is the buyer's armed extortion (`{ copper, applied, pct }`); it falls on ONE line,
 * the costliest before it (ties: the first). `total` is what checkout will charge.
 */
export function priceCart(lines, shelf, { merchant, pct = 0, swing = (copper) => ({ copper, applied: false, pct: 0 }) }) {
  const priced = [], merged = [];
  for (const { wareId, qty } of lines) {
    const n = Math.floor(Number(qty)) || 0, same = merged.find((l) => l.wareId === wareId);
    if (n < 1) continue;
    if (same) same.qty += n; else merged.push({ wareId, qty: n });
  }
  for (const { wareId, qty } of merged) {
    const entry = shelf.find((e) => e.id === wareId);
    if (!entry || entry.stock === 0) continue;
    const most = entry.stock === -1 ? 99 : Math.ceil(entry.stock / entry.bundle);
    const q = Math.min(qty, most);
    const quote = quoteLine(entry, q, merchant, { pct });
    if (quote) priced.push({ wareId, entry, qty: q, units: quote.units, base: quote.copper, copper: quote.copper, adjusted: q !== qty, swung: false, swingPct: 0 });
  }
  let top = null;
  for (const l of priced) if (!top || l.base > top.base) top = l;
  if (top) {
    const s = swing(top.base);
    if (s.applied) Object.assign(top, { copper: s.copper, swung: true, swingPct: s.pct });
  }
  return { lines: priced, total: priced.reduce((n, l) => n + l.copper, 0), adjusted: priced.some((l) => l.adjusted) || priced.length !== merged.length };
}
