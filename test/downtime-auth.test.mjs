/**
 * Downtime authorization tests — the GM-side "may this person do this, with
 * this roll?" decisions, pinned against the three ways they were broken.
 *
 * The bugs these exist for (found in review, reproduced live on Foundry 14.365
 * before the fix):
 *
 *   1. REPLAY. `_handleRolled` fetched the ChatMessage named in the payload and
 *      took `rolls[0].total` as authoritative, checking only the author. Any
 *      earlier high roll the player made — an initiative roll, an attack —
 *      settled a downtime attempt. Live: a 25 on an "Initiative" message with
 *      no downtime flags at all resolved a DC 12 attempt as a success.
 *
 *   2. FORGED IDENTITY. Authorization read `payload.userId`, which is whatever
 *      the sending client typed. `game.socket.emit` authenticates nothing, so
 *      naming the GM's id passed every ownership check. Live: a Player-role
 *      user resolved another character's pending reward by doing exactly that.
 *
 *   3. NO OWNERSHIP CHECK AT ALL on the roll path.
 *
 * Also covers the free-text training name, which reaches an Item name and a
 * chat card and so is cleaned before either.
 *
 * Pure layer only: plain objects, no Foundry globals at import.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  FREE_TEXT_MAX_LENGTH,
  authorizeActorRequest,
  sanitizeFreeTextName,
  validateRollClaim,
} from "../scripts/downtime/downtime-core.mjs";
import { normalizeSession, settledMessageIds } from "../scripts/downtime/downtime-session.mjs";

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const NONCE = "n0nc3n0nc3n0nc31";
const ACTOR = "actorAAA";
const SLOT = "d6-new-weapon";
const MSG = "msg111";
const OWNER = "userOwner";

/** A claim that passes every check, for one-axis mutation in each test. */
const goodClaim = (over = {}) => ({
  actorId: ACTOR,
  slotKey: SLOT,
  messageId: MSG,
  pick: { slotKey: SLOT, nonce: NONCE, advantage: "normal" },
  rollFlag: { actorId: ACTOR, slotKey: SLOT, nonce: NONCE },
  hasRoll: true,
  messageAuthorId: OWNER,
  messageActorId: ACTOR,
  requesterId: OWNER,
  consumedNonces: [],
  settledMessageIds: [],
  ...over,
});

/* ── Who may act for a character ──────────────────────────────────────────── */

describe("authorizeActorRequest", () => {
  test("the character's owner may act for it", () => {
    assert.deepEqual(
      authorizeActorRequest({ actorExists: true, requesterIsGM: false, requesterOwnsActor: true }),
      { ok: true },
    );
  });

  test("a GM may act for anyone — they roll for absent players", () => {
    assert.equal(
      authorizeActorRequest({ actorExists: true, requesterIsGM: true, requesterOwnsActor: false }).ok,
      true,
    );
  });

  test("a non-owner, non-GM requester is refused", () => {
    const out = authorizeActorRequest({ actorExists: true, requesterIsGM: false, requesterOwnsActor: false });
    assert.equal(out.ok, false);
    assert.match(out.error, /don't own that character/);
  });

  test("a missing character is refused before ownership is even asked", () => {
    const out = authorizeActorRequest({ actorExists: false, requesterIsGM: true, requesterOwnsActor: true });
    assert.equal(out.ok, false);
    assert.match(out.error, /no longer exists/);
  });

  test("an absent facts object fails closed", () => {
    assert.equal(authorizeActorRequest().ok, false);
    assert.equal(authorizeActorRequest({}).ok, false);
  });
});

/* ── Is this roll message actually this attempt's roll? ───────────────────── */

describe("validateRollClaim", () => {
  test("a well-formed, unspent claim passes", () => {
    assert.deepEqual(validateRollClaim(goodClaim()), { ok: true });
  });

  test("REPLAY: a message carrying no downtime flag is refused", () => {
    // This is the shape of the live exploit: a real roll, really authored by the
    // player, really high — and nothing whatsoever to do with downtime.
    const out = validateRollClaim(goodClaim({ rollFlag: null }));
    assert.equal(out.ok, false);
    assert.match(out.error, /isn't a downtime roll/);
  });

  test("REPLAY: a flag for a different character is refused", () => {
    const out = validateRollClaim(goodClaim({
      rollFlag: { actorId: "someoneElse", slotKey: SLOT, nonce: NONCE },
    }));
    assert.equal(out.ok, false);
    assert.match(out.error, /different character/);
  });

  test("REPLAY: a flag for a different slot is refused", () => {
    const out = validateRollClaim(goodClaim({
      rollFlag: { actorId: ACTOR, slotKey: "minor-crime", nonce: NONCE },
    }));
    assert.equal(out.ok, false);
    assert.match(out.error, /different activity/);
  });

  test("REPLAY: a downtime roll from an EARLIER attempt is refused", () => {
    // Same character, same slot, correctly flagged — but last session's nonce.
    const out = validateRollClaim(goodClaim({
      rollFlag: { actorId: ACTOR, slotKey: SLOT, nonce: "staleNonce000001" },
    }));
    assert.equal(out.ok, false);
    assert.match(out.error, /doesn't belong to this attempt/);
  });

  test("REPLAY: a nonce already spent this session is refused", () => {
    const out = validateRollClaim(goodClaim({ consumedNonces: [NONCE] }));
    assert.equal(out.ok, false);
    assert.match(out.error, /already been used/);
  });

  test("REPLAY: a message id already settled this session is refused", () => {
    const out = validateRollClaim(goodClaim({ settledMessageIds: [MSG] }));
    assert.equal(out.ok, false);
    assert.match(out.error, /already been used/);
  });

  test("a message authored by somebody else is refused", () => {
    const out = validateRollClaim(goodClaim({ messageAuthorId: "otherUser" }));
    assert.equal(out.ok, false);
    assert.match(out.error, /isn't yours/);
  });

  test("a message spoken by a different character is refused", () => {
    const out = validateRollClaim(goodClaim({ messageActorId: "otherActor" }));
    assert.equal(out.ok, false);
    assert.match(out.error, /different character/);
  });

  test("a claim against a slot the pick doesn't name is refused", () => {
    const out = validateRollClaim(goodClaim({ slotKey: "minor-crime" }));
    assert.equal(out.ok, false);
    assert.match(out.error, /locked pick/);
  });

  test("no pick at all is refused", () => {
    const out = validateRollClaim(goodClaim({ pick: null }));
    assert.equal(out.ok, false);
    assert.match(out.error, /haven't chosen/);
  });

  test("a message with no evaluated roll is refused", () => {
    const out = validateRollClaim(goodClaim({ hasRoll: false }));
    assert.equal(out.ok, false);
    assert.match(out.error, /Couldn't find that roll/);
  });

  test("a pick minted before nonces existed fails closed, with the way out", () => {
    const out = validateRollClaim(goodClaim({ pick: { slotKey: SLOT } }));
    assert.equal(out.ok, false);
    assert.match(out.error, /reopen picks/);
  });

  test("nonce equality is exact — a prefix does not pass", () => {
    const out = validateRollClaim(goodClaim({
      rollFlag: { actorId: ACTOR, slotKey: SLOT, nonce: NONCE.slice(0, 8) },
    }));
    assert.equal(out.ok, false);
  });

  test("a claim with nothing in it fails closed", () => {
    assert.equal(validateRollClaim().ok, false);
    assert.equal(validateRollClaim({}).ok, false);
  });
});

/* ── The session's replay bookkeeping ─────────────────────────────────────── */

describe("session replay bookkeeping", () => {
  test("normalizeSession carries consumed nonces and drops non-strings", () => {
    const s = normalizeSession({ active: true, consumed: ["a", 7, null, "b"] });
    assert.deepEqual(s.consumed, ["a", "b"]);
  });

  test("a session predating the field normalizes to an empty ledger", () => {
    assert.deepEqual(normalizeSession({ active: true }).consumed, []);
    assert.deepEqual(normalizeSession(null).consumed, []);
  });

  test("settledMessageIds lists every message a result already spent", () => {
    const state = normalizeSession({
      results: {
        a1: { messageId: "m1" },
        a2: { messageId: "m2" },
        a3: { messageId: null },
      },
    });
    assert.deepEqual(settledMessageIds(state).sort(), ["m1", "m2"]);
  });
});

/* ── The typed training name ──────────────────────────────────────────────── */

describe("sanitizeFreeTextName", () => {
  test("keeps an ordinary name, collapsing stray whitespace", () => {
    assert.deepEqual(sanitizeFreeTextName("  Boar   spear "), { ok: true, name: "Boar spear" });
  });

  test("keeps ampersands and apostrophes — those are real answers", () => {
    assert.equal(sanitizeFreeTextName("Bow & Arrow").name, "Bow & Arrow");
    assert.equal(sanitizeFreeTextName("Warden's maul").name, "Warden's maul");
  });

  test("strips angle brackets so a markup payload can't survive as an item name", () => {
    const out = sanitizeFreeTextName('<img src=x onerror="alert(1)">');
    assert.equal(out.ok, true);
    assert.equal(out.name.includes("<"), false);
    assert.equal(out.name.includes(">"), false);
  });

  test("strips control characters rather than carrying them into a document", () => {
    const raw = `Great${String.fromCharCode(0)}sword${String.fromCharCode(27)}[31m`;
    const out = sanitizeFreeTextName(raw);
    assert.equal(out.ok, true);
    assert.equal(/\p{Cc}/u.test(out.name), false);
    assert.equal(out.name, "Great sword [31m");
  });

  test("caps the length", () => {
    assert.equal(sanitizeFreeTextName("z".repeat(500)).name.length, FREE_TEXT_MAX_LENGTH);
  });

  test("refuses an empty or whitespace-only name", () => {
    assert.equal(sanitizeFreeTextName("").ok, false);
    assert.equal(sanitizeFreeTextName("   ").ok, false);
    assert.equal(sanitizeFreeTextName(null).ok, false);
    assert.equal(sanitizeFreeTextName(undefined).ok, false);
  });
});
