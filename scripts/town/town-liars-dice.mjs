/**
 * Shadowdark Enhancer — Liar's Dice at a town table: the money and the record (the match is in liars-dice-core.mjs and the
 * table in liars-dice-table.mjs).
 *
 * Every person's own client moves their own character's coins and nobody else's, so it works with no GM connected and a
 * Player-role user may do it. Each person puts the table's wager (`ante`) in when they sit down, so it is on the table
 * and walking away from a match that is going badly costs it. The pot is the wager of every seat: the house's players
 * put theirs in out of the town's purse, which has no bottom. The winner, if a person, is paid their own wager back and
 * the other seats' wagers less the town's cut of those winnings (like the other games); a house player that wins takes the
 * pot and moves no coins. A table called off gives every person their wager back.
 *
 * `io` is the Foundry side (localize, the coin writes, the chat); `liveIo()` in town-games.mjs is the real one and tests
 * pass their own. Each returns `{ ok: true, ... }` or `{ ok: false, error }` with the error already localized.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { formatPrice, fromCopper, spendFromPurse, toCopper } from "../shared/coins.mjs";
import { gameCard } from "../shared/chat-cards.mjs";
import { esc } from "../shared/esc.mjs";
import { GAME_ICONS, GAME_KEYS, LIARS, RESULT_KEYS, WAGER_KEYS, checkWager, settle } from "./games-core.mjs";
import { eventLines, namesOf } from "./liars-dice-view.mjs";
import { LOG_FLAG, logFlag } from "./town-log-core.mjs";

const fail = (error) => ({ ok: false, error });

/**
 * Put the wager in: check it and take it from the purse. `town` is the host's landing page (`{ on, maxBet }`) when this person
 * is opening the table, which the wager must fit; a person joining someone else's table gives none and only needs the coins.
 */
export async function takeAnte({ player, ante, town = null }, io) {
  if (!player?.isOwner) return fail(io.t("SDE.merchant.notify.actorNotFound"));
  if (town && !town.on) return fail(io.t("SDE.town.games.closed"));
  const purse = toCopper(player.system.coins);
  const check = checkWager(ante, { maxBetGp: town ? town.maxBet : Infinity, purse });
  if (!check.ok) return fail(io.t(WAGER_KEYS[check.why], { max: formatPrice(fromCopper((town?.maxBet ?? 0) * 100)) }));
  // A charge that did not land starts nothing: the table is never free.
  if (!(await io.charge(player, spendFromPurse(player.system.coins, ante)))) return fail(io.t("SDE.town.games.notSaved"));
  return { ok: true };
}

/** Give the wager back (the table was called off, or this person left the lobby). */
export async function refundAnte({ player, ante }, io) {
  return (await io.pay(player, fromCopper(ante))) ? { ok: true } : fail(io.t("SDE.town.games.notSaved"));
}

/**
 * This person's part of the match is over: pay them if they won, and post their card for the sales log. `view` is the table
 * as they last saw it (over), or the match they walked away from (`forfeit`). The host's card carries every round; the
 * others' say only how it went for them. A win pays the wager back with the winnings; a loss moves nothing more.
 */
export async function settleSeat({ player, view, forfeit = false }, io) {
  const won = !forfeit && view.winner === view.me;
  const { net, result } = won ? settle(view.ante, view.total, view.town.edge) : { net: -view.ante, result: "lose" };
  if (won && !(await io.pay(player, fromCopper(view.ante + net)))) return fail(io.t("SDE.town.games.notSaved"));

  const names = namesOf(view);
  const ending = forfeit
    ? io.t("SDE.town.games.liars.walked", { who: player.name })
    : io.t("SDE.town.games.liars.won", { who: names[view.winner] });
  const outcome = io.t(RESULT_KEYS[result], { who: player.name, price: formatPrice(fromCopper(Math.abs(net))) });
  const rounds = view.isHost ? eventLines(view.log, names, io.t) : [];
  const name = io.t(GAME_KEYS[LIARS].name);
  await io.chat({
    speaker: { alias: view.town.name },
    content: gameCard({ title: name, who: player.name, icon: GAME_ICONS[LIARS].replace("fa-", ""), html: [...rounds, ending, outcome].map(esc).join("<br>"), tone: result === "win" ? "good" : result === "lose" ? "bad" : "" }),
    flags: { [MODULE_ID]: { [LOG_FLAG]: logFlag({ kind: "game", sceneId: view.town.sceneId, placeId: LIARS, place: view.town.name, charId: player.id, charName: player.name, what: name, net, wager: view.ante, result }) } },
  });
  return { ok: true, game: LIARS, result, net, wager: view.ante, lines: [ending, outcome] };
}
