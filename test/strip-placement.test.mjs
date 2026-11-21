// PR 596 review thread 4655164705: a right-edge column must not fall back to
// the stylesheet's `left: 0`, or it stretches between both insets and renders
// on the left.
import test from "node:test";
import assert from "node:assert/strict";
import { stripBoxStyle } from "../scripts/crawl-strip/strip-layout-core.mjs";

const box = { leftEdge: 412, rightEdge: 1140, ifaceWidth: 1500, height: 900 };

test("right column: left inset is auto, right inset hugs the sidebar", () => {
  const s = stripBoxStyle("right", box);
  assert.equal(s.left, "auto");
  assert.equal(s.right, "360px");
  assert.equal(s.height, "900px");
});

test("left column and top strip keep their placement", () => {
  assert.deepEqual(stripBoxStyle("left", box), { left: "412px", right: "", width: "", height: "900px" });
  assert.deepEqual(stripBoxStyle("top", box), { left: "412px", right: "", width: "728px", height: "" });
});
