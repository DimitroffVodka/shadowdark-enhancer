/**
 * Explicit legacy SDX feed compatibility and downtime overlap read.
 * Native carousing pushes SessionRecap.logCarousing directly. No hidden
 * journal watcher is registered; old capture calls do not apply actor effects.
 */

import { carousingUnderway, normalizeCarousingSession } from "./carousing-feed-core.mjs";

const SDX_ID = "shadowdark-extras";
/** SDX finds this journal by name, so the name is the reliable identifier. */
const SYNC_JOURNAL_NAME = "__sdx_carousing_sync__";
const SESSION_FLAG = "carousingSession";
const DROPS_FLAG = "carousingDrops";

export const CarousingFeed = {
  /** logId → JSON of the last captured carouse, to skip no-op re-writes. */
  _seen: new Map(),

  /**
   * The recap singleton, handed in by `init` rather than imported. SessionRecap
   * owns this feed, so importing it back would make a cycle; injection also
   * lets the capture path be exercised against a stub.
   */
  _recap: null,

  /**
   * Carousing has to be both installed and switched on. A world that disabled
   * SDX's carousing mid-campaign should stop feeding the recap, not keep
   * mirroring a stale overlay.
   */
  isEnabled() {
    if (!game.modules.get(SDX_ID)?.active) return false;
    // Reading an unregistered setting throws; an SDX version without this key
    // is treated as off rather than crashing the hook.
    try {
      return !!game.settings.get(SDX_ID, "enableCarousing");
    } catch {
      return false;
    }
  },

  /**
   * SDX's hidden sync journal. Matched on the name it is created and looked up
   * by, with the creation flag as a second chance in case a GM renames it.
   */
  _isSyncJournal(doc) {
    if (!doc || doc.documentName !== "JournalEntry") return false;
    return doc.name === SYNC_JOURNAL_NAME
      || doc.getFlag?.(SDX_ID, "isCarousingJournal") === true;
  },

  /** Whether a carouse is under way in SDX, so downtime must wait (#198). */
  isOpen() {
    if (game.shadowdarkEnhancer?.carousing?.isOpen?.()) return true;
    if (!this.isEnabled()) return false;
    const journal = game.journal.find((doc) => this._isSyncJournal(doc));
    return !!journal && carousingUnderway(journal.getFlag(SDX_ID, SESSION_FLAG), journal.getFlag(SDX_ID, DROPS_FLAG));
  },

  /**
   * `{ player, actorName }` for one SDX participant id.
   *
   * The id is a user id when a player dropped their own character onto the
   * overlay, or `"actor-<actorId>"` when the GM added one. Player attribution
   * matches the rest of the recap, which groups by the controlling player.
   */
  resolveParticipant(participantId, journal) {
    const id = String(participantId ?? "");

    if (id.startsWith("actor-")) {
      const actor = game.actors.get(id.slice(6));
      return { player: this._ownerName(actor), actorName: actor?.name ?? "" };
    }

    const user = game.users.get(id);
    if (!user) return { player: "GM", actorName: "" };
    // The overlay's drop map is where a player's chosen character lives. It is
    // cleared when the GM resets the overlay, which is exactly why the captured
    // name is preserved on re-capture (see `_mergeEntries`).
    const actorId = journal?.getFlag?.(SDX_ID, DROPS_FLAG)?.[id];
    const actor = actorId ? game.actors.get(actorId) : null;
    return { player: user.name, actorName: actor?.name ?? "" };
  },

  /** The first non-GM owner of a GM-added character, else "GM". */
  _ownerName(actor) {
    if (!actor) return "GM";
    for (const [userId, level] of Object.entries(actor.ownership ?? {})) {
      if (userId === "default") continue;
      if (level < CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) continue;
      const user = game.users.get(userId);
      if (user && !user.isGM) return user.name;
    }
    return "GM";
  },

  /**
   * Read the journal's current carousing session and mirror it into the recap.
   * Safe to call redundantly: unchanged payloads are dropped before any write.
   */
  async capture(journal) {
    const session = journal?.getFlag?.(SDX_ID, SESSION_FLAG);
    const carouse = normalizeCarousingSession(
      session,
      (participantId) => this.resolveParticipant(participantId, journal),
    );
    if (!carouse) return;

    const fingerprint = JSON.stringify(carouse);
    if (this._seen.get(carouse.logId) === fingerprint) return;
    this._seen.set(carouse.logId, fingerprint);

    return this._recap?.logCarousing(carouse);
  },

  init(recap) {
    this._recap = recap;
    // Native nights push logCarousing directly. Legacy capture remains an
    // explicit compatibility call, never a hidden journal watcher.
  },
};
