/**
 * Shadowdark Enhancer — Liar's Dice on Foundry: this browser tab's client for the tables, wired to the world's socket, clock,
 * dice and coins (the logic is in liars-dice-net.mjs, which knows none of these).
 *
 * Everything rides the module's socket channel as `{ action: "liars", op, ... }`, which the other handlers on it ignore.
 * The listener is put in at `setup` by the entry script (Foundry replays the socket events it buffered while loading just
 * before `ready`, so a table opened while this tab loads is not missed) and reaches this file by a dynamic import, so a
 * world that never plays Liar's Dice never loads it.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { formatPrice, fromCopper } from "../shared/coins.mjs";
import { LiarsClient } from "./liars-dice-net.mjs";
import { AI_NAME_KEYS } from "./liars-dice-table.mjs";
import { liveIo } from "./town-games.mjs";
import { refundAnte, settleSeat, takeAnte } from "./town-liars-dice.mjs";

const SOCKET = `module.${MODULE_ID}`;
let client = null;

/** This tab's client (made on first use). A test or a check may set `client.io` to move no real coins. */
export function liveClient() {
  if (client) return client;
  const io = async () => (client.io ??= await liveIo());
  const others = () => game.users.filter((u) => u.active && !u.isSelf).map((u) => u.id);
  client = new LiarsClient({
    userId: game.user.id,
    // A message to nobody is not sent: an empty recipient list is not known to mean "no one".
    send: (msg, to) => {
      const recipients = to ? [to] : others();
      if (recipients.length) game.socket.emit(SOCKET, { action: "liars", ...msg }, { recipients });
    },
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    rng: () => CONFIG.Dice.randomUniform(),
    aiNames: () => AI_NAME_KEYS.map((key) => game.i18n.localize(key)),
    money: {
      take: async (player, ante, town) => takeAnte({ player, ante, town }, await io()),
      refund: async (player, ante) => refundAnte({ player, ante }, await io()),
      settle: async (args) => settleSeat(args, await io()),
    },
    newId: () => `${game.user.id}-${Date.now().toString(36)}`,
  });
  client.onTable = (t) => ui.notifications.info(game.i18n.format("SDE.town.games.liars.tableOpened", { host: t.hostName, price: formatPrice(fromCopper(t.ante)) }));
  return client;
}

/** A Liar's Dice message from `senderId` (the entry script's socket listener calls this). */
export const onLiarsMessage = (msg, senderId) => liveClient().handle(msg, senderId);

/** A user left the world (the entry script's `userConnected` hook calls this). Nothing is made if this tab has no client. */
export const onUserGone = (userId) => client?.userGone(userId);
