// The bastion sheet's monthly roll posts every line the roll added: a natural disaster that breaches
// the walls shows the damage and the breach, not only the breach (review follow-up at 8305f8e7).
import test from "node:test";
import assert from "node:assert/strict";

/** The Foundry surface bastion-sheet.mjs touches: the two bases it extends, and the roll's inputs. */
globalThis.foundry = {
  applications: {
    api: { HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2: {} },
    sheets: { ActorSheetV2: class {} },
  },
  utils: {},
};
const posted = [];
globalThis.ChatMessage = { create: async (msg) => { posted.push(msg); return msg; } };
globalThis.ui = { notifications: { warn() {} } };
globalThis.game = { user: { isGM: true }, i18n: { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d ?? {})}` } };
const uniforms = [];
globalThis.CONFIG = { Dice: { randomUniform: () => uniforms.shift() } };

const { BastionSheet } = await import("../scripts/bastion/bastion-sheet.mjs");
const { newBastion } = await import("../scripts/bastion/bastion-core.mjs");

const ART = "modules/shadowdark-enhancer/assets/bastion/art/house.svg";
/** An actor stand-in carrying a standing bastion; update() records what was written. */
function actor() {
  const doc = {
    name: "Blackhollow", img: ART,
    system: { ...newBastion("house"), weeksLeft: 0 },
    prototypeToken: { texture: { src: ART } },
    update: async (update) => { doc.written = update; return update; },
  };
  return doc;
}
const sheetOf = (doc) => Object.assign(Object.create(BastionSheet.prototype), { document: doc });
/** Fix the dice: a 1 on the d6, a 2 on the d4 (natural), the d100's value. */
const breachingRoll = () => uniforms.splice(0, uniforms.length, 0.0, 0.3, 0.62);

test("a breaching natural disaster posts the damage and the breach", async () => {
  const doc = actor();
  breachingRoll();   // the d6 1, the d4 2 (natural), the d100 63
  await sheetOf(doc)._onRollMonth();
  assert.equal(posted.length, 1);
  const { content } = posted[0];
  assert.match(content, /SDE\.bastion\.log\.naturalDisaster/);
  assert.match(content, /naturalDisaster .*amount.*63/);   // the damage, in the card
  assert.match(content, /SDE\.bastion\.log\.breached/);    // and the breach
  assert.equal(doc.written["system.hp.value"], 0);
});

test("a quiet month posts its one line", async () => {
  const doc = actor();
  uniforms.splice(0, uniforms.length, 0.4);   // the d6 3, no disaster
  await sheetOf(doc)._onRollMonth();
  const { content } = posted.at(-1);
  assert.match(content, /SDE\.bastion\.log\.quietMonth/);
  assert.doesNotMatch(content, /breached/);
});

test("a full log still shows which lines are new", async () => {
  const doc = actor();
  doc.system.log = Array.from({ length: 60 }, (_, i) => ({ week: i, key: "SDE.bastion.log.quietMonth", data: { d6: 2 } }));
  breachingRoll();
  await sheetOf(doc)._onRollMonth();
  const { content } = posted.at(-1);
  assert.match(content, /SDE\.bastion\.log\.naturalDisaster/);
  assert.match(content, /SDE\.bastion\.log\.breached/);
  assert.doesNotMatch(content, /quietMonth/);   // the sixty old lines are not re-posted
  assert.equal(doc.written["system.log"].length, 60);
});
