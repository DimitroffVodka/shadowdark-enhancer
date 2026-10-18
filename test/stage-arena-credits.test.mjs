/** The Arena fight art folder: the rings tile has its exact size, and every file in the folder is credited. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dir = new URL("../assets/scenes/arena-fight/", import.meta.url);
const credits = readFileSync(new URL("../CREDITS.md", import.meta.url), "utf8");

/** Width and height from a WebP header (VP8X, lossy VP8 or lossless VP8L). */
function webpSize(buf) {
  assert.equal(buf.toString("latin1", 0, 4), "RIFF");
  assert.equal(buf.toString("latin1", 8, 12), "WEBP");
  const kind = buf.toString("latin1", 12, 16);
  if (kind === "VP8X") return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (kind === "VP8 ") return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  if (kind === "VP8L") { const b = buf.readUInt32LE(21); return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]; }
  throw new Error(`unknown WebP chunk ${kind}`);
}

test("the rings tile is a 1600x1600 WebP under 300 KB", () => {
  const f = new URL("rings.webp", dir);
  assert.ok(statSync(f).size < 300 * 1024);
  assert.deepEqual(webpSize(readFileSync(f)), [1600, 1600]);
});

test("the folder holds only the rings and the three thumbs, all credited", () => {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => relative(fileURLToPath(dir), join(e.parentPath, e.name))).sort();
  assert.deepEqual(files, ["rings.webp", "thumbs/arena-coliseum.webp", "thumbs/arena-pit.webp", "thumbs/arena-ring.webp"]);
  assert.ok(credits.includes("`assets/scenes/arena-fight/`"));
  for (const f of files) assert.ok(credits.includes(`\`${f.split("/").pop()}\``), `${f} is not credited in CREDITS.md`);
  for (const f of files.filter((x) => x.startsWith("thumbs/"))) assert.ok(statSync(new URL(f, dir)).size < 100 * 1024, f);
});
