/**
 * Shadowdark Enhancer — Carousing feed (Shadowdark Extras → Session Recap).
 *
 * Shadowdark Extras implements carousing; this file only mirrors its results
 * into our Session Recap so a night at the tavern lands in the session log
 * beside the loot, the XP and the downtime. Nothing here writes to SDX, to any
 * actor, or to SDX's own Carousing Log journal.
 *
 * WHY A WATCHER AND NOT A CALL. Every other recap feed is pushed by the feature
 * that owns it (`Renown.award` → `logRenown`). SDX emits no carousing hook and
 * exposes no carousing function on `module.api`, so there is nothing to call
 * us. What it does do is keep the entire live carouse in ONE journal flag —
 * `flags["shadowdark-extras"].carousingSession` on the hidden
 * `__sdx_carousing_sync__` entry — which it rewrites on every state change.
 * Watching that document is therefore a complete signal: it fires when the
 * rolls land AND again when the GM applies an outcome, and it needs no SDX
 * internals beyond a flag read.
 *
 * WHY WE COPY RATHER THAN READ THROUGH. SDX's overlay holds exactly ONE live
 * carouse; the GM resetting it for the next round erases the last one. A recap
 * that read SDX live would lose the evening's first carouse the moment a second
 * began, and would have nothing at all to archive or export. So each carouse is
 * captured into our own `carousing` array, keyed on SDX's `logId` so a later
 * apply UPDATES the captured row instead of appending a duplicate.
 */

import { normalizeCarousingSession } from "./carousing-feed-core.mjs";

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
    if (!game.user?.isGM) return;

    // `updateJournalEntry` fires on every connected GM; the primary-GM gate is
    // the same one the combat hooks use, and matters here because this world
    // runs a second always-on GM client.
    Hooks.on("updateJournalEntry", (doc) => {
      if (!recap.isActive() || !recap._isPrimaryGM()) return;
      if (!this.isEnabled() || !this._isSyncJournal(doc)) return;
      this.capture(doc);
    });
  },
};
