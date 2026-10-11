import test from "node:test";
import assert from "node:assert/strict";
import { ensureSceneThumb } from "../scripts/shared/scene-thumb.mjs";

// Invented data throughout.

/** A scene double: createThumbnail and update behave like Foundry's, unless told to fail. */
function fakeScene({ thumb = "", makes = "data:image/webp;base64,AAAA", fails = false } = {}) {
  const scene = {
    name: "Test Scene", thumb, created: 0, updates: [],
    async createThumbnail() {
      scene.created++;
      if (fails) throw new Error("no canvas");
      return { thumb: makes };
    },
    async update(data, options) {
      scene.updates.push({ data, options });
      Object.assign(scene, data);
    },
  };
  return scene;
}

test("ensureSceneThumb: a scene with a thumbnail is left alone", async () => {
  const scene = fakeScene({ thumb: "worlds/w/assets/scenes/thumb-x.webp" });
  assert.equal(await ensureSceneThumb(scene), true);
  assert.equal(scene.created, 0);
  assert.deepEqual(scene.updates, []);
});

test("ensureSceneThumb: a scene without one gets it made and stored without a re-render", async () => {
  const scene = fakeScene();
  assert.equal(await ensureSceneThumb(scene), true);
  assert.deepEqual(scene.updates, [{ data: { thumb: "data:image/webp;base64,AAAA" }, options: { render: false } }]);
});

test("ensureSceneThumb: a failure is swallowed and reported as no thumbnail", async (t) => {
  t.mock.method(console, "warn", () => {});
  const scene = fakeScene({ fails: true });
  assert.equal(await ensureSceneThumb(scene), false);
  assert.deepEqual(scene.updates, []);
});

test("ensureSceneThumb: an empty result stores nothing", async () => {
  const scene = fakeScene({ makes: "" });
  assert.equal(await ensureSceneThumb(scene), false);
  assert.deepEqual(scene.updates, []);
});
