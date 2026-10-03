import test from "node:test";
import assert from "node:assert/strict";
import { offerParty } from "../scripts/party/party-create-option.mjs";

function fakeSelect(values) {
  const options = values.map(value => ({ value, textContent: value, remove() { options.splice(options.indexOf(this), 1); } }));
  return {
    options,
    querySelector: sel => options.find(o => sel === `option[value="${o.value}"]`) ?? null,
    append: o => options.push(o),
  };
}
globalThis.document = { createElement: () => ({ value: "", textContent: "", remove() { /* replaced by append */ } }) };
// An option added by append has no remove bound to the list, so rebind it the way a DOM node would.
const select = values => { const s = fakeSelect(values); const append = s.append; s.append = o => { o.remove = () => s.options.splice(s.options.indexOf(o), 1); append(o); }; return s; };

test("the Enhancer's Party is added and Extras' duplicate is dropped", () => {
  const s = select(["Player", "NPC", "Party"]);
  offerParty(s, "Party", () => {});
  assert.deepEqual(s.options.map(o => o.value), ["Player", "NPC", "sde-party"]);
});

test("Extras adding its Party after ours is dropped too", () => {
  const s = select(["Player", "NPC"]);
  let later;
  offerParty(s, "Party", (_el, fn) => { later = fn; });
  s.options.push({ value: "Party", remove() { s.options.splice(s.options.indexOf(this), 1); } });
  later();
  assert.deepEqual(s.options.map(o => o.value), ["Player", "NPC", "sde-party"]);
});

test("no Extras entry: ours alone; and a second render does not add it twice", () => {
  const s = select(["Player", "NPC"]);
  offerParty(s, "Party", () => {});
  offerParty(s, "Party", () => {});
  assert.deepEqual(s.options.map(o => o.value), ["Player", "NPC", "sde-party"]);
});

test("a select that is not the actor-type list is left alone", () => {
  const s = select(["a", "b", "Party"]);
  offerParty(s, "Party", () => {});
  assert.deepEqual(s.options.map(o => o.value), ["a", "b", "Party"]);
  assert.doesNotThrow(() => offerParty(null, "Party"));
});
