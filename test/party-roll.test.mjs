import test from "node:test";
import assert from "node:assert/strict";

const MOD = "shadowdark-enhancer";
const GM = { id: "gm", isGM: true };
const OWNER = { id: "p1", isGM: false };

// A chat message whose update lands a tick later, as a server round-trip does: two results sent together both read
// the card before either write is back.
function card(request) {
  const message = { id: "m1", flags: { [MOD]: { partyRoll: request } } };
  message.update = async (changes) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    message.flags[MOD].partyRoll = changes[`flags.${MOD}.partyRoll`];
  };
  return message;
}

test("two players rolling on one card at once both stay on it, and a fail hits once", async () => {
  const actors = { "Actor.a": { name: "a", testUserPermission: () => true }, "Actor.b": { name: "b", testUserPermission: () => true } };
  const message = card({ stat: "dex", dc: 12, damage: "1d6", source: "Pit", targets: [{ uuid: "Actor.a", name: "a" }, { uuid: "Actor.b", name: "b" }] });
  let hits = 0;
  globalThis._replace = (v) => v;
  globalThis.CONFIG = { queries: {} };
  globalThis.Hooks = { on: () => 1 };
  globalThis.game = {
    user: GM, users: { activeGM: GM }, messages: { get: (id) => (id === message.id ? message : null) },
    i18n: { localize: (k) => k, format: (k) => k },
  };
  globalThis.fromUuid = async (uuid) => actors[uuid] ?? null;
  globalThis.ChatMessage = { getSpeaker: () => ({}) };
  globalThis.Roll = class { async evaluate() { return { total: 3, toMessage: async () => {} }; } };
  for (const a of Object.values(actors)) a.applyDamage = async () => { hits += 1; };

  const { registerPartyRoll, PARTY_ROLL_QUERY } = await import("../scripts/party/party-roll.mjs");
  registerPartyRoll();
  const ask = (uuid, outcome) => globalThis.CONFIG.queries[PARTY_ROLL_QUERY]({ messageId: "m1", uuid, total: 5, outcome }, { user: OWNER });
  await Promise.all([ask("Actor.a", "fail"), ask("Actor.b", "pass")]);

  assert.deepEqual(message.flags[MOD].partyRoll.results.map((r) => [r.uuid, r.outcome]), [["Actor.a", "fail"], ["Actor.b", "pass"]]);
  await ask("Actor.a", "fail");
  assert.equal(hits, 1, "a result already on the card does not hit again");
});
