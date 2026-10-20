/**
 * Shadowdark Enhancer — a hand of Beholder's Bluff or Brag at a town table: the money and the record (the hand itself is
 * played in hand-core.mjs, the house's moves are in hand-bot.mjs).
 *
 * Like the other games it runs on the player's own client with no GM connected and only ever changes the PLAYER'S
 * character. A hand takes many moves, so the coins go into the pot as they are bet (the wager as the ante, then each bet,
 * call and raise), and walking away from a hand costs what is in it. A win hands the player's coins back with the house's
 * share less the town's cut of that share; a tie hands them back; a loss has nothing more to take.
 *
 * A table is `{ game, wager, hand, rolls, settled }`: the hand, every Roll made for it (for the chat card) and whether the
 * coins have been settled. Each function returns `{ ok: true, table, ... }` or `{ ok: false, error }` with the error
 * already localized; `io` is the Foundry side (`roll`, `random`, `charge`, `pay`, `chat`, `t`), tests pass their own.
 */
import { formatPrice, fromCopper, spendFromPurse, toCopper } from "../shared/coins.mjs";
import { WAGER_KEYS, checkWager } from "./games-core.mjs";
import { HAND_RULES, apply, costOf, newHand, settleHand, walkAway } from "./hand-core.mjs";
import { houseMove } from "./hand-bot.mjs";
import { endLines, handLines } from "./hand-view.mjs";
import { liveIo } from "./town-games.mjs";
import { payAndPost } from "./town-table.mjs";

const fail = (error) => ({ ok: false, error });

/** The real Foundry side of a hand: the games' own, and the dice's random source for the house's nerve. */
export async function handIo() {
  return { ...(await liveIo()), random: () => CONFIG.Dice.randomUniform() };
}

/** Sit down: check the table and the wager, put the ante in from the purse, and deal both hands. */
export async function startHand({ player, game, wager, town }, io = null) {
  io ??= await handIo();
  if (!player?.isOwner) return fail(io.t("SDE.merchant.notify.actorNotFound"));
  const rules = HAND_RULES[game];
  if (!rules) return fail(io.t("SDE.town.games.noGame"));
  if (!town?.on) return fail(io.t("SDE.town.games.closed"));
  const check = checkWager(wager, { maxBetGp: town.maxBet, purse: toCopper(player.system.coins) });
  if (!check.ok) return fail(io.t(WAGER_KEYS[check.why], { max: formatPrice(fromCopper(town.maxBet * 100)) }));
  // A charge that did not land starts nothing: the table is never free.
  if (!(await io.charge(player, spendFromPurse(player.system.coins, wager)))) return fail(io.t("SDE.town.games.notSaved"));
  const you = await io.roll(`${rules.dice}d${rules.sides}`), house = await io.roll(`${rules.dice}d${rules.sides}`);
  return { ok: true, table: { game, wager, hand: newHand(game, { unit: wager, you: you.dice, house: house.dice }), rolls: [you.roll, house.roll], settled: false } };
}

/**
 * The player's move. It is checked against the rules (and the purse) before any coin moves; then the house answers, and
 * keeps playing while it is its turn. When the hand ends it is settled here. `action` is `{ type: "reveal", idx }`,
 * `{ type: "draw", idx }` (the new faces are rolled here) or `{ type: "check" | "bet" | "call" | "raise" | "fold" }`.
 */
export async function playHand({ player, table, action, town }, io = null) {
  io ??= await handIo();
  if (!player?.isOwner) return fail(io.t("SDE.merchant.notify.actorNotFound"));
  const rules = HAND_RULES[table.game], rolls = [...table.rolls];
  let hand = table.hand;
  const purse = toCopper(player.system.coins);

  const draw = async (a) => {
    if (a.type !== "draw") return a;
    const n = a.idx.length, faces = n ? await io.roll(`${n}d${rules.sides}`) : { dice: [] };
    if (n) rolls.push(faces.roll);
    return { ...a, values: faces.dice };
  };
  // A reroll is rolled before the rules see it, so what is asked for must already be a few different dice that exist.
  const allowed = rules.rerolls[hand.round - 1] ?? 0;
  const dice = (idx) => Array.isArray(idx) && idx.length <= allowed && new Set(idx).size === idx.length && idx.every((i) => Number.isInteger(i) && i >= 0 && i < rules.dice);
  if (action.type === "draw" && !dice(action.idx)) return fail(io.t("SDE.town.hand.notNow"));
  const you = await draw(action);
  try { apply(hand, "you", you); } catch { return fail(io.t("SDE.town.hand.notNow")); }
  const cost = costOf(hand, you.type);
  if (cost > purse) return fail(io.t("SDE.town.hand.cantAfford"));
  if (cost > 0 && !(await io.charge(player, spendFromPurse(player.system.coins, cost)))) return fail(io.t("SDE.town.games.notSaved"));

  // A step with the dice is taken by both sides at once: the house picks without seeing what the player picked.
  const stepped = hand.phase === "reveal" || hand.phase === "draw" ? houseMove(hand, "house", io.random) : null;
  hand = apply(hand, "you", you);
  if (stepped) hand = apply(hand, "house", await draw(stepped));
  while (!hand.result && hand.phase === "bet" && hand.bet.turn === "house") hand = apply(hand, "house", houseMove(hand, "house", io.random));

  const next = { ...table, hand, rolls };
  return hand.result ? settleTable({ player, table: next, town }, io) : { ok: true, table: next, over: false };
}

/** The player leaves the table in the middle of a hand, or closes its window: what is in the pot is the house's. */
export async function walkAwayHand({ player, table, town }, io = null) {
  const walked = table.hand.result ? table : { ...table, hand: walkAway(table.hand) };
  return settleTable({ player, table: walked, town }, io);
}

/**
 * Settle a finished hand and post its card for the sales log. Safe to call again if the coins did not land: it returns the
 * error and leaves `settled` false until they do.
 */
export async function settleTable({ player, table, town }, io = null) {
  io ??= await handIo();
  if (table.settled) return { ok: true, table, over: true, lines: [], result: null, net: 0 };
  const { hand } = table;
  const { net, result, payBack } = settleHand(hand, town.edge);
  const names = { you: player.name, house: io.t("SDE.town.hand.house") };
  const posted = await payAndPost({ player, game: table.game, town, net, result, payBack, put: hand.put.you, lines: handLines(hand, names, io.t), rolls: table.rolls }, io);
  if (!posted.ok) return { ok: false, error: posted.error, table };
  return { ok: true, table: { ...table, settled: true }, over: true, lines: [...endLines(hand, names, io.t), posted.outcome], result, net };
}
