/**
 * Shadowdark Enhancer — what the Town window and the shopfront show (pure).
 *
 * The windows are thin: they gather the world's facts (the scene's landing page, the NPC's items, the buyer's coins)
 * and these functions turn them into the cards, tiles and rows the templates draw. `t(key, data)` localizes (the
 * windows pass the real one; tests pass a stand-in), so nothing here needs Foundry.
 */
import { canAfford, fromCopper, formatPrice } from "../shared/coins.mjs";
import { buyCopper, sellCopper, bundleOf, STOCK_TYPES } from "../merchant/shop-core.mjs";
import { PLACE_LABEL_KEYS } from "./town-core.mjs";

/** The shopfront's filter chips. `gear` is the system's Basic items. */
export const CATEGORIES = [
  { id: "all", key: "SDE.town.cat.all", types: null },
  { id: "weapon", key: "SDE.town.cat.weapon", types: ["Weapon"] },
  { id: "armor", key: "SDE.town.cat.armor", types: ["Armor"] },
  { id: "gear", key: "SDE.town.cat.gear", types: ["Basic"] },
];
export const TYPE_LABEL_KEYS = { Weapon: "SDE.town.type.weapon", Armor: "SDE.town.type.armor", Basic: "SDE.town.type.gear" };
export const PLACE_ICONS = { quests: "fa-list-check", journals: "fa-book-open", party: "fa-people-group", downtime: "fa-hourglass-half", carouse: "fa-beer-mug-empty", rumors: "fa-comments", games: "fa-dice" };
export const PLACE_SUB_KEYS = {
  quests: "SDE.town.sub.quests", journals: "SDE.town.sub.journals", party: "SDE.town.sub.party", downtime: "SDE.town.sub.downtime", carouse: "SDE.town.sub.carouse", rumors: "SDE.town.sub.rumors", games: "SDE.town.sub.games",
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
 * The ware cards for a shelf (shop-core's `shelf`). `swing` maps copper to copper (the buyer's armed extortion, or
 * identity). `describe(entry)` gives a ware's whole description (shown for the one that is open); `blurb(entry)` its
 * short form, shown on every card; `facts(entry)` its facts (wareFacts); `rules(entry)` the `{ name, text }` of each
 * property, shown with the description. A card has a Details button (`more`) only when there is more to read.
 */
export function wareCards(shelf, { merchant, coins, category = "all", expandedId = null, swing = (c) => c, describe = () => "", blurb = () => "", facts = () => [], rules = () => [], t }) {
  const types = CATEGORIES.find((c) => c.id === category)?.types ?? null;
  return shelf.filter((e) => !types || types.includes(e.type)).map((e) => {
    const price = fromCopper(swing(buyCopper(e.cost, (merchant?.buyMultiplier ?? 100) / 100, e.bundle, e.bundle)));
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
export function sellRows(items, merchant, { swing = (c) => c, t }) {
  return [...items].filter((i) => STOCK_TYPES.includes(i.type)).map((i) => {
    const copper = swing(sellCopper(i.system?.cost, 1, merchant?.sellRatio ?? 50, bundleOf(i)));
    return { id: i.id, name: i.name, img: i.img, qty: i.system?.quantity ?? 1, pays: copper ? formatPrice(fromCopper(copper)) : t("SDE.town.nothing") };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** The tiles that open other windows, for the places the GM left on. */
export function placeTiles(places, { isGM, hasParty, downtimeOpen, activeQuests, nightOpen = false, gmOnline = true, rumorsHeard = false, t }) {
  return places.map((id) => {
    const tile = { id, icon: PLACE_ICONS[id], label: t(PLACE_LABEL_KEYS[id]), sub: t(PLACE_SUB_KEYS[id]), tag: "", disabled: false, hint: "" };
    if (id === "quests" && activeQuests) tile.tag = t("SDE.town.activeQuests", { n: activeQuests });
    if (id === "party" && !hasParty) Object.assign(tile, { disabled: true, hint: t("SDE.town.hint.party") });
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
