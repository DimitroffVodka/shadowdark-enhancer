/**
 * Shadowdark Enhancer — a hand of blackjack at a town table: the money and the record (the hand itself is played in
 * blackjack-core.mjs; the dealer has no choices, it draws to 17).
 *
 * Like the other games it runs on the player's own client with no GM connected and only ever changes the PLAYER'S
 * character. The wager goes on the table when the cards are dealt, a double or a split puts one more wager on it, and
 * walking away from a hand loses what is there. A win hands back the wagers that survived with the winnings, less the
 * town's cut of the winnings; a push hands the wager back.
 *
 * A table is `{ game: "blackjack", wager, round, rolls: [], settled }`. Each function returns `{ ok: true, table, ... }` or
 * `{ ok: false, error }` with the error already localized; `io` is the Foundry side (`random`, `charge`, `pay`, `chat`,
 * `t`) and tests pass their own.
 */
import { formatPrice, fromCopper, spendFromPurse, toCopper } from "../shared/coins.mjs";
import { WAGER_KEYS, checkWager } from "./games-core.mjs";
import { applyBlackjack, costOf, newRound, settleRound, shuffle, walkAwayBlackjack } from "./blackjack-core.mjs";
import { blackjackLines } from "./blackjack-view.mjs";
import { handIo } from "./town-hand.mjs";
import { payAndPost } from "./town-table.mjs";

const fail = (error) => ({ ok: false, error });
/** The real Foundry side is the hands': the games' own io and the dice's random source (it shuffles the deck). */
export const blackjackIo = handIo;

/**
 * Sit down: check the table and the wager, put the wager on the table, shuffle and deal. A natural on either side ends
 * the hand on the spot, so that comes back already settled (or, if the winnings did not save, waiting to be collected).
 */
export async function startBlackjack({ player, wager, town }, io = null) {
  io ??= await blackjackIo();
  if (!player?.isOwner) return fail(io.t("SDE.merchant.notify.actorNotFound"));
  if (!town?.on) return fail(io.t("SDE.town.games.closed"));
  const check = checkWager(wager, { maxBetGp: town.maxBet, purse: toCopper(player.system.coins), left: town.left });
  if (!check.ok) return fail(io.t(WAGER_KEYS[check.why], { max: formatPrice(fromCopper(town.maxBet * 100)) }));
  // A charge that did not land starts nothing: the table is never free.
  if (!(await io.charge(player, spendFromPurse(player.system.coins, wager)))) return fail(io.t("SDE.town.games.notSaved"));
  const table = { game: "blackjack", wager, round: newRound({ unit: wager, deck: shuffle(io.random) }), rolls: [], settled: false };
  return { ok: true, table: table.round.result ? (await settleBlackjackTable({ player, table, town }, io)).table : table };
}

/**
 * The player's move: `{ type: "hit" | "stand" | "double" | "split" }`. It is checked against the rules (and the purse, for
 * the second wager of a double or a split) before any coin moves; a hand that ends is settled here.
 */
export async function playBlackjack({ player, table, action, town }, io = null) {
  io ??= await blackjackIo();
  if (!player?.isOwner) return fail(io.t("SDE.merchant.notify.actorNotFound"));
  let round;
  try { round = applyBlackjack(table.round, action.type); } catch { return fail(io.t("SDE.town.hand.notNow")); }
  const cost = costOf(table.round, action.type);
  if (cost > toCopper(player.system.coins)) return fail(io.t("SDE.town.hand.cantAfford"));
  if (cost > 0 && !(await io.charge(player, spendFromPurse(player.system.coins, cost)))) return fail(io.t("SDE.town.games.notSaved"));
  const next = { ...table, round };
  return round.result ? settleBlackjackTable({ player, table: next, town }, io) : { ok: true, table: next, over: false };
}

/** The player leaves the table in the middle of a hand, or closes its window: what is on the table is the house's. */
export async function walkAwayBlackjackTable({ player, table, town }, io = null) {
  const walked = table.round.result ? table : { ...table, round: walkAwayBlackjack(table.round) };
  return settleBlackjackTable({ player, table: walked, town }, io);
}

/** Settle a finished hand and post its card. Safe to call again if the coins did not land: `settled` stays false until they do. */
export async function settleBlackjackTable({ player, table, town }, io = null) {
  io ??= await blackjackIo();
  if (table.settled) return { ok: true, table, over: true, lines: [], result: null, net: 0 };
  const { round } = table;
  const { net, result, payBack, put } = settleRound(round, town.edge);
  const lines = blackjackLines(round, { you: player.name }, io.t);
  const posted = await payAndPost({ player, game: "blackjack", town, net, result, payBack, put, lines, rolls: [] }, io);
  if (!posted.ok) return { ok: false, error: posted.error, table };
  return { ok: true, table: { ...table, settled: true }, over: true, lines: [...lines, posted.outcome], result, net };
}
