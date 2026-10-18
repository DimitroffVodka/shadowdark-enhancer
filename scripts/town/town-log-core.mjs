/**
 * Shadowdark Enhancer — the town's sales log, read from the chat (pure).
 *
 * A town sale or game is made on the player's own client, and a player cannot write a world setting, so the log is
 * not a setting: each chat card the town posts carries its facts as a flag, and the log is those cards read back.
 * It therefore works with no GM connected, and it lasts as long as the chat does (clearing the chat clears it).
 *
 *   flags[MODULE_ID].townLog = { kind, sceneId, placeId, place, charId, charName, what, qty, net, wager, result }
 *
 * `net` is in copper from the character's side: a buy is negative, a sale positive, a game its winnings or its loss.
 */
import { MODULE_ID } from "../shared/module-id.mjs";

export const LOG_FLAG = "townLog";
export const KINDS = ["buy", "sell", "game"];

const text = (v, max) => String(v ?? "").slice(0, max);
const int = (v) => Math.round(Number(v)) || 0;

/** The flag a town card carries (every field present and plain). */
export function logFlag({ kind, sceneId = "", placeId = "", place = "", charId = "", charName = "", what = "", qty = 1, net = 0, wager = 0, result = "" }) {
  return { kind, sceneId: text(sceneId, 40), placeId: text(placeId, 40), place: text(place, 80), charId: text(charId, 40), charName: text(charName, 80), what: text(what, 120), qty: Math.max(1, int(qty)), net: int(net), wager: Math.max(0, int(wager)), result: text(result, 10) };
}

/** The log entries in `messages` (anything with `id`, `timestamp` and `flags`), newest first. Cards that carry no usable flag are skipped. */
export function entriesFrom(messages) {
  const out = [];
  for (const m of messages ?? []) {
    const f = m?.flags?.[MODULE_ID]?.[LOG_FLAG];
    if (!f || !KINDS.includes(f.kind) || !Number.isFinite(Number(f.net))) continue;
    out.push({ ...logFlag(f), id: m.id, at: Number(m.timestamp) || 0 });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** What is left of `entries` after the filters: a town (`sceneId`), a kind, a merchant or game (`placeId`). A filter of "" or null is off. */
export const filterEntries = (entries, { sceneId = "", kind = "", placeId = "" } = {}) =>
  entries.filter((e) => (!sceneId || e.sceneId === sceneId) && (!kind || e.kind === kind) && (!placeId || e.placeId === placeId));

/** The coins players paid in (buys and lost wagers), the coins paid out (sales and winnings), and what the town kept. */
export function totals(entries) {
  let paidIn = 0, paidOut = 0;
  for (const e of entries) { if (e.net < 0) paidIn -= e.net; else paidOut += e.net; }
  return { count: entries.length, paidIn, paidOut, kept: paidIn - paidOut };
}

export const KIND_ICONS = { buy: "fa-cart-shopping", sell: "fa-coins", game: "fa-dice" };
export const ROW_KEYS = { buy: "SDE.town.log.row.buy", sell: "SDE.town.log.row.sell", game: "SDE.town.log.row.game" };

/**
 * The rows the log window draws. `t(key, data)` localizes, `price(copper)` words an amount of coins (the copper
 * itself is signed here, the price is not) and `when(at)` words a time; the window passes the real ones.
 */
export function logRows(entries, { t, price, when }) {
  return entries.map((e) => {
    const what = e.kind === "game" ? e.what : `${e.what}${e.qty > 1 ? ` ×${e.qty}` : ""}`;
    return {
      id: e.id, icon: KIND_ICONS[e.kind], title: t(ROW_KEYS[e.kind], { who: e.charName, what }),
      sub: [e.place, e.kind === "game" && e.wager ? t("SDE.town.log.wagered", { price: price(e.wager) }) : "", when(e.at)].filter(Boolean).join(" · "),
      amount: e.net ? `${e.net > 0 ? "+" : "−"}${price(Math.abs(e.net))}` : t("SDE.town.log.even"), gain: e.net > 0, loss: e.net < 0,
    };
  });
}

/** The places that appear in `entries`, for the filter: merchants and games with how many entries each. A to Z. */
export function placesIn(entries) {
  const seen = new Map();
  for (const e of entries) {
    if (!e.placeId) continue;
    // A game is named for itself (the town's name is the same on all four).
    const row = seen.get(e.placeId) ?? { id: e.placeId, name: e.kind === "game" ? e.what : e.place, n: 0 };
    row.n += 1;
    seen.set(e.placeId, row);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
