/**
 * Shadowdark Enhancer — a spin of the roulette at a town table: the money and the record (the board is in
 * roulette-core.mjs). Like the other games it runs on the player's own client with no GM connected and only ever changes
 * the PLAYER'S character. Nothing is taken until the wheel has spun: a loss is charged and a win paid as one change, so
 * a write that does not land leaves everything as it was and posts nothing.
 *
 * `io` is the Foundry side of `playGame` (`t`, `roll`, `charge`, `pay`, `chat`); tests pass their own. Returns
 * `{ ok: true, out, lines, result, net }` or `{ ok: false, error }` with the error already localized.
 */
import { formatPrice, fromCopper, spendFromPurse, toCopper } from "../shared/coins.mjs";
import { MIN_WAGER, WAGER_KEYS, checkWager } from "./games-core.mjs";
import { boardStake, spinBoard, validBoard } from "./roulette-core.mjs";
import { rouletteLines } from "./roulette-view.mjs";
import { liveIo } from "./town-games.mjs";
import { payAndPost } from "./town-table.mjs";

const fail = (error) => ({ ok: false, error });

/** Spin the wheel on `bets` (`{ pick: chips }`, each chip `chip` copper). */
export async function spinWheel({ player, bets, chip, town }, io = null) {
  io ??= await liveIo();
  if (!player?.isOwner) return fail(io.t("SDE.merchant.notify.actorNotFound"));
  if (!town?.on) return fail(io.t("SDE.town.games.closed"));
  if (!validBoard(bets)) return fail(io.t("SDE.town.games.noBet"));
  if (!Number.isInteger(chip) || chip < MIN_WAGER) return fail(io.t(WAGER_KEYS.min));
  const stake = boardStake(bets, chip);
  const check = checkWager(stake, { maxBetGp: town.maxBet, purse: toCopper(player.system.coins) });
  if (!check.ok) return fail(io.t(WAGER_KEYS[check.why], { max: formatPrice(fromCopper(town.maxBet * 100)) }));

  const spin = await io.roll("1d20");
  const out = spinBoard({ bets, chip, d20: spin.total, edge: town.edge });
  if (out.net < 0 && !(await io.charge(player, spendFromPurse(player.system.coins, -out.net)))) return fail(io.t("SDE.town.games.notSaved"));
  const lines = rouletteLines(out, player.name, io.t);
  const posted = await payAndPost({ player, game: "roulette", town, net: out.net, result: out.result, payBack: Math.max(out.net, 0), put: stake, lines, rolls: [spin.roll] }, io);
  if (!posted.ok) return posted;
  return { ok: true, out, lines: [...lines, posted.outcome], result: out.result, net: out.net };
}

