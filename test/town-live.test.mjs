/** The serialized page writer: writes on a scene go one at a time, each on the page as it is live right then. */
import test from "node:test";
import assert from "node:assert/strict";
import { addMerchant, restockAll, setShown, normalizeLanding } from "../scripts/town/town-core.mjs";

// town-live reaches the party and carousing modules, which read Foundry's app classes when they load.
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (base) => base } }, utils: { randomID: () => "id" } };
const { updateLanding } = await import("../scripts/town/town-live.mjs");

const MOD = "shadowdark-enhancer";
class Replacement { constructor(value) { this.value = value; } }
globalThis._replace = (value) => new Replacement(value);
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A scene whose update lands after a delay, like a round trip to the server. */
function fakeScene(page, { fail = 0 } = {}) {
  const scene = { id: "s1", flags: { [MOD]: { landing: page } }, writes: 0 };
  scene.update = async (data) => {
    const value = data[`flags.${MOD}.landing`].value;
    await tick();
    if (scene.fail-- > 0) throw new Error("refused");
    scene.flags[MOD].landing = structuredClone(value);
    scene.writes++;
  };
  scene.fail = fail;
  return scene;
}
const base = () => addMerchant(undefined, "a1", () => "m1");

test("a restock and a switch started together both land, in order, on the page the other left", async () => {
  const scene = fakeScene(base());
  await Promise.all([
    updateLanding(scene, (page) => restockAll(page, 10)),
    updateLanding(scene, (page) => setShown(page, false)),
  ]);
  const page = normalizeLanding(scene.flags[MOD].landing);
  assert.equal(page.shown, false);
  assert.equal(page.merchants[0].rev, 1);
  assert.equal(page.merchants[0].restockedDay, 10);
});

test("two ticks of the same restock raise the revision once when the transform checks the live page", async () => {
  const scene = fakeScene(base());
  const tickOnDay = (day) => (page) => (page.merchants[0].restockedDay === day ? null : restockAll(page, day));
  await Promise.all([updateLanding(scene, tickOnDay(5)), updateLanding(scene, tickOnDay(5))]);
  assert.equal(scene.flags[MOD].landing.merchants[0].rev, 1);
  assert.equal(scene.writes, 1);
});

test("a transform that returns null writes nothing, and a failed write does not block the ones after it", async () => {
  const scene = fakeScene(base(), { fail: 1 });
  const none = await updateLanding(scene, () => null);
  assert.equal(scene.writes, 0);
  assert.equal(none.merchants.length, 1);
  await assert.rejects(updateLanding(scene, (page) => restockAll(page, 1)), /refused/);
  await updateLanding(scene, (page) => restockAll(page, 2));
  assert.equal(scene.flags[MOD].landing.merchants[0].rev, 1);
  assert.equal(scene.flags[MOD].landing.merchants[0].restockedDay, 2);
});

test("a restock stamps the day it is given and leaves the stamp when it is given none", () => {
  const page = base();
  assert.equal(restockAll(page, 40).merchants[0].restockedDay, 40);
  assert.equal(restockAll(restockAll(page, 40)).merchants[0].restockedDay, 40);
});
