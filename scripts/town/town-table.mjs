/**
 * Shadowdark Enhancer — what every sit-down game at a town table does when it ends: pay the player what came back, and
 * post one card for the chat and the sales log. The hands (town-hand.mjs), the death roll (town-death.mjs) and the
 * roulette (town-roulette.mjs) each work out their own money and lines and hand them here.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { formatPrice, fromCopper } from "../shared/coins.mjs";
import { gameCard } from "../shared/chat-cards.mjs";
import { esc } from "../shared/esc.mjs";
import { GAME_ICONS, GAME_KEYS, RESULT_KEYS } from "./games-core.mjs";
import { LOG_FLAG, logFlag } from "./town-log-core.mjs";

/**
 * Pay `payBack` (copper, the player's own coins and any winnings) and post the card: `lines` then the outcome line. The
 * pay comes first and a pay that does not land posts nothing and says so, so the caller can try again. `put` is what the
 * player had in, for the sales log; `rolls` are the Foundry Rolls to attach so the dice show with the card.
 * Returns `{ ok: true, lines: [the outcome line] }` or `{ ok: false, error }`.
 */
export async function payAndPost({ player, game, town, net, result, payBack, put, lines, rolls = [] }, io) {
  if (payBack > 0 && !(await io.pay(player, fromCopper(payBack)))) return { ok: false, error: io.t("SDE.town.games.notSaved") };
  const outcome = io.t(RESULT_KEYS[result], { who: player.name, price: formatPrice(fromCopper(Math.abs(net))) });
  const name = io.t(GAME_KEYS[game].name);
  // The coins have moved: a card that does not post must not undo that or stop the table being settled.
  try {
    await io.chat({
      speaker: { alias: town.name },
      content: gameCard({ title: name, who: player.name, icon: GAME_ICONS[game].replace("fa-", ""), html: [...lines, outcome].map(esc).join("<br>"), tone: result === "win" ? "good" : result === "lose" ? "bad" : "" }),
      rolls,
      flags: { [MODULE_ID]: { [LOG_FLAG]: logFlag({ kind: "game", sceneId: town.sceneId, placeId: game, place: town.name, charId: player.id, charName: player.name, what: name, net, wager: put, result }) } },
    });
  } catch (err) { console.warn(`${MODULE_ID} | town: the table game card did not post`, err); }
  return { ok: true, outcome };
}
