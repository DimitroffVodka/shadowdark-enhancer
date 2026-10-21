/**
 * Shadowdark Enhancer — a round of the death roll at a town table: the money and the record (the round itself is played in
 * death-core.mjs, the house's answers are `deathMove` there).
 *
 * Like the hands it runs on the player's own client with no GM connected and only ever changes the PLAYER'S character. The
 * wager goes on the table when the round begins; a double the player takes puts the player's other half of the new stake
 * on it. A win hands the player's coins back with the house's share less the town's cut of that share; a loss has nothing
 * more to take. Walking away loses what is on the table.
 *
 * A table is `{ game: "death", wager, round, rolls, settled }`. Each function returns `{ ok: true, table, ... }` or
 * `{ ok: false, error }` with the error already localized; `io` is the Foundry side (`roll`, `random`, `charge`, `pay`,
 * `chat`, `t`) and tests pass their own.
 */
import { formatPrice, fromCopper, spendFromPurse, toCopper } from "../shared/coins.mjs";
import { WAGER_KEYS, checkWager } from "./games-core.mjs";
import { applyDeath, deathMove, newDeath, takeCost, walkAwayDeath } from "./death-core.mjs";
import { settleHand } from "./hand-core.mjs";
import { deathLines } from "./death-view.mjs";
import { handIo } from "./town-hand.mjs";
import { payAndPost } from "./town-table.mjs";

const fail = (error) => ({ ok: false, error });
/** The real Foundry side is the hands': the games' own io and the dice's random source. */
export const deathIo = handIo;

/** Let the house make every move that is its own: roll, offer or answer a double. `error` is set if a coin write did not land. */
async function houseTurns({ player, round, rolls }, io) {
  while (!round.result) {
    const move = deathMove(round, io.random);
    if (!move) break;
    if (move.type === "roll") {
      const r = await io.roll(`1d${round.max}`);
      rolls = [...rolls, r.roll];
      round = applyDeath(round, "house", { type: "roll", n: r.total });
    } else {
      // The house taking the player's double puts the player's other half of the new stake on the table.
      if (move.type === "take" && !(await io.charge(player, spendFromPurse(player.system.coins, takeCost(round))))) return { error: io.t("SDE.town.games.notSaved") };
      round = applyDeath(round, "house", move);
    }
  }
  return { round, rolls };
}

/** Sit down: check the table and the wager, put the wager on the table, and let the house have its first say. */
export async function startDeath({ player, wager, town }, io = null) {
  io ??= await deathIo();
  if (!player?.isOwner) return fail(io.t("SDE.merchant.notify.actorNotFound"));
  if (!town?.on) return fail(io.t("SDE.town.games.closed"));
  const check = checkWager(wager, { maxBetGp: town.maxBet, purse: toCopper(player.system.coins), left: town.left });
  if (!check.ok) return fail(io.t(WAGER_KEYS[check.why], { max: formatPrice(fromCopper(town.maxBet * 100)) }));
  // A charge that did not land starts nothing: the table is never free.
  if (!(await io.charge(player, spendFromPurse(player.system.coins, wager)))) return fail(io.t("SDE.town.games.notSaved"));
  const started = await houseTurns({ player, round: newDeath({ unit: wager }), rolls: [] }, io);
  if (started.error) return fail(started.error);
  return { ok: true, table: { game: "death", wager, round: started.round, rolls: started.rolls, settled: false } };
}

/**
 * The player's move: `{ type: "roll" }` (the die is rolled here), `{ type: "double" }`, `{ type: "skip" }` (let the house
 * roll), `{ type: "take" }` or `{ type: "pass" }`. It is checked against the rules and the purse before any coin moves;
 * then the house answers and plays on until the decision is the player's again. A round that ends is settled here.
 */
export async function playDeath({ player, table, action, town }, io = null) {
  io ??= await deathIo();
  if (!player?.isOwner) return fail(io.t("SDE.merchant.notify.actorNotFound"));
  let rolls = [...table.rolls];
  let you = action;
  if (action.type === "roll") {
    const r = await io.roll(`1d${table.round.max}`);
    rolls = [...rolls, r.roll];
    you = { type: "roll", n: r.total };
  }
  try { applyDeath(table.round, "you", you); } catch { return fail(io.t("SDE.town.hand.notNow")); }
  // Taking a double costs the player's share of the stake; offering one must be affordable in case it is taken.
  if ((you.type === "take" || you.type === "double") && takeCost(table.round) > toCopper(player.system.coins)) return fail(io.t("SDE.town.hand.cantAfford"));
  if (you.type === "take" && !(await io.charge(player, spendFromPurse(player.system.coins, takeCost(table.round))))) return fail(io.t("SDE.town.games.notSaved"));

  const turns = await houseTurns({ player, round: applyDeath(table.round, "you", you), rolls }, io);
  if (turns.error) return fail(turns.error);
  const next = { ...table, round: turns.round, rolls: turns.rolls };
  return next.round.result ? settleDeathTable({ player, table: next, town }, io) : { ok: true, table: next, over: false };
}

/** The player leaves the table in the middle of a round, or closes its window: what is on the table is the house's. */
export async function walkAwayDeathTable({ player, table, town }, io = null) {
  const walked = table.round.result ? table : { ...table, round: walkAwayDeath(table.round) };
  return settleDeathTable({ player, table: walked, town }, io);
}

/** Settle a finished round and post its card. Safe to call again if the coins did not land: `settled` stays false until they do. */
export async function settleDeathTable({ player, table, town }, io = null) {
  io ??= await deathIo();
  if (table.settled) return { ok: true, table, over: true, lines: [], result: null, net: 0 };
  const { round } = table;
  const { net, result, payBack } = settleHand({ put: round.put, result: round.result }, town.edge);
  const names = { you: player.name, house: io.t("SDE.town.hand.house") };
  const lines = deathLines(round, names, io.t);
  const posted = await payAndPost({ player, game: "death", town, net, result, payBack, put: round.put.you, lines, rolls: table.rolls }, io);
  if (!posted.ok) return { ok: false, error: posted.error, table };
  return { ok: true, table: { ...table, settled: true }, over: true, lines: [...lines, posted.outcome], result, net };
}
