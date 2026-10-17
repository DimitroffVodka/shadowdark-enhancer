/**
 * Shadowdark Enhancer — a game of chance at a town table, played on the player's own client (no GM needs to be connected).
 *
 * Like a purchase, a game only ever changes the PLAYER'S character (coins out or in), which a Player-role user may
 * write, and posts a chat card that carries the facts for the sales log. The house has no purse to run dry: the
 * town's largest bet is what bounds a run of luck. The rules are in games-core.mjs; this rolls, settles and writes.
 *
 * `io` is the Foundry side (localize, the dice, the coin writes, the chat); `liveIo()` is the real one and tests pass
 * their own. Returns `{ ok: true, ... }` or `{ ok: false, error }` with the error already localized for the player.
 * Nothing is posted and nothing is kept when the coins did not land.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { formatPrice, fromCopper, spendFromPurse, toCopper } from "../shared/coins.mjs";
import { gameCard } from "../shared/chat-cards.mjs";
import { esc } from "../shared/esc.mjs";
import { GAME_ICONS, GAME_IDS, GAME_KEYS, RESULT_KEYS, SIDES, SIDE_KEYS, SLOT_KEYS, WAGER_KEYS, cardName, cards, checkWager, coin, duel, settle, wheel } from "./games-core.mjs";
import { LOG_FLAG, logFlag } from "./town-log-core.mjs";

const fail = (error) => ({ ok: false, error });

/** Roll the game: what was rolled (for the card's dice), what came back of the wager, and the line that says what happened. */
async function roll(game, pick, who, io) {
  if (game === "coin") {
    const flip = await io.roll("1d2");
    const r = coin({ pick, flip: flip.total });
    return { mult: r.mult, rolls: [flip.roll], line: io.t(GAME_KEYS.coin.line, { who, pick: io.t(SIDE_KEYS[pick]), side: io.t(SIDE_KEYS[r.side]) }) };
  }
  if (game === "duel") {
    const [you, house] = [await io.roll("2d6"), await io.roll("2d6")];
    const r = duel({ you: you.dice, house: house.dice });
    return { mult: r.mult, rolls: [you.roll, house.roll], line: io.t(GAME_KEYS.duel.line, { who, you: r.you, house: r.house }) };
  }
  if (game === "wheel") {
    const spin = await io.roll("1d100");
    const r = wheel({ d100: spin.total });
    return { mult: r.mult, rolls: [spin.roll], line: io.t(GAME_KEYS.wheel.line, { who, n: r.d100, slot: io.t(SLOT_KEYS[r.slot]) }) };
  }
  const [a, b] = io.deck();
  const r = cards({ you: a, house: b });
  return { mult: r.mult, rolls: [], line: io.t(GAME_KEYS.cards.line, { who, you: cardName(r.you), house: cardName(r.house) }) };
}

/**
 * Play one game. `town` is the table as the landing page sets it: `{ name, sceneId, on, maxBet (gp), edge (%) }`;
 * `wager` is in copper; `pick` is the called side for the coin toss.
 */
export async function playGame({ player, game, wager, pick = "", town }, io = null) {
  io ??= await liveIo();
  if (!player?.isOwner) return fail(io.t("SDE.merchant.notify.actorNotFound"));
  if (!GAME_IDS.includes(game)) return fail(io.t("SDE.town.games.noGame"));
  if (!town?.on) return fail(io.t("SDE.town.games.closed"));
  if (game === "coin" && !SIDES.includes(pick)) return fail(io.t("SDE.town.games.noPick"));
  const check = checkWager(wager, { maxBetGp: town.maxBet, purse: toCopper(player.system.coins) });
  if (!check.ok) return fail(io.t(WAGER_KEYS[check.why], { max: formatPrice(fromCopper(town.maxBet * 100)) }));

  const played = await roll(game, pick, player.name, io);
  const { net, result } = settle(wager, played.mult, town.edge);
  // A loss is taken, a win paid; both read the purse back. A write that did not land keeps nothing and posts nothing.
  if (net < 0 && !(await io.charge(player, spendFromPurse(player.system.coins, -net)))) return fail(io.t("SDE.town.games.notSaved"));
  if (net > 0 && !(await io.pay(player, fromCopper(net)))) return fail(io.t("SDE.town.games.notSaved"));

  const outcome = io.t(RESULT_KEYS[result], { who: player.name, price: formatPrice(fromCopper(Math.abs(net))) });
  const lines = [played.line, outcome];
  const name = io.t(GAME_KEYS[game].name);
  await io.chat({
    speaker: { alias: town.name },
    content: gameCard({ title: name, who: player.name, icon: GAME_ICONS[game].replace("fa-", ""), html: lines.map(esc).join("<br>"), tone: result === "win" ? "good" : result === "lose" ? "bad" : "" }),
    rolls: played.rolls,
    flags: { [MODULE_ID]: { [LOG_FLAG]: logFlag({ kind: "game", sceneId: town.sceneId, placeId: game, place: town.name, charId: player.id, charName: player.name, what: name, net, wager, result }) } },
  });
  return { ok: true, game, result, net, wager, lines };
}

/** The real Foundry side. Imported on use, so the rules above load (and test) without a running Foundry. */
export async function liveIo() {
  const { MerchantShop } = await import("../merchant/merchant-shop.mjs");
  return {
    t: (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key)),
    async roll(formula) {
      const rolled = await new Roll(formula).evaluate({ allowInteractive: false });
      return { total: rolled.total, dice: rolled.dice.flatMap((d) => d.results.map((r) => r.result)), roll: rolled };
    },
    /** Two different places in a 52-card deck, from the dice's own random source. */
    deck() {
      const a = Math.floor(CONFIG.Dice.randomUniform() * 52);
      let b = Math.floor(CONFIG.Dice.randomUniform() * 51);
      if (b >= a) b += 1;
      return [a, b];
    },
    charge: (actor, purse) => MerchantShop._setPurse(actor, purse),
    pay: (actor, coins) => MerchantShop._pay(actor, coins),
    chat: (data) => ChatMessage.create(data),
  };
}
