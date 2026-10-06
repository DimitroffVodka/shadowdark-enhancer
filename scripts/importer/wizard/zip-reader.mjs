/**
 * Shadowdark Enhancer — reading a downloaded .zip in the browser.
 *
 * The books come as zips (the Cursed Scroll 4 download is one 80 MB zip holding two PDFs and eleven maps), so the
 * wizard takes the zip as it is instead of asking a new user to unzip it. No library: the browser's own
 * DecompressionStream does the inflating, and only the zip's index and the entries wanted are ever read, so a
 * 235 MB zip costs what its useful PDFs cost.
 *
 * Handles stored and deflated entries and ordinary (non-zip64) archives, which is every Arcane Library download.
 * Works on anything with Blob's slice(): a File from the picker, or a Blob in a test. No Foundry globals.
 */

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif" };

export const isZip = (file) => /\.zip$/i.test(String(file?.name ?? ""));
const baseOf = (path) => path.split("/").pop();

/** Read `length` bytes at `start` as a DataView. */
async function view(blob, start, length) {
  return new DataView(await blob.slice(start, start + length).arrayBuffer());
}

/**
 * The entries of a zip: the files in it, not the folders or the junk a Mac adds (__MACOSX, ._x, .DS_Store).
 * @returns {Promise<Array<{path:string, name:string, size:number, toFile:()=>Promise<File>}>>}
 */
export async function readZip(blob) {
  // The end-of-central-directory record is in the last 22 bytes plus a comment of up to 65535.
  const tailLen = Math.min(blob.size, 22 + 65535);
  const tail = await view(blob, blob.size - tailLen, tailLen);
  let at = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === EOCD) { at = i; break; }
  if (at < 0) throw new Error("not a zip file");
  const count = tail.getUint16(at + 10, true), cdSize = tail.getUint32(at + 12, true), cdOffset = tail.getUint32(at + 16, true);
  if (cdSize === 0xffffffff || cdOffset === 0xffffffff || count === 0xffff) throw new Error("zip64 archives are not supported");

  const cd = await view(blob, cdOffset, cdSize);
  const names = new TextDecoder();
  const entries = [];
  for (let p = 0, i = 0; i < count && p + 46 <= cdSize; i++) {
    if (cd.getUint32(p, true) !== CENTRAL) throw new Error("damaged zip index");
    const method = cd.getUint16(p + 10, true), compressed = cd.getUint32(p + 20, true), size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true), extraLen = cd.getUint16(p + 30, true), commentLen = cd.getUint16(p + 32, true);
    const offset = cd.getUint32(p + 42, true);
    const path = names.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const name = baseOf(path);
    if (!name || path.endsWith("/") || path.includes("__MACOSX/") || name.startsWith("._") || name === ".DS_Store") continue;
    entries.push({ path, name, size, toFile: () => extractEntry(blob, { name, method, compressed, offset }) });
  }
  return entries;
}

/** Inflate one entry into a File. */
async function extractEntry(blob, { name, method, compressed, offset }) {
  const head = await view(blob, offset, 30);
  if (head.getUint32(0, true) !== LOCAL) throw new Error(`damaged zip entry: ${name}`);
  const start = offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const raw = blob.slice(start, start + compressed);
  const type = TYPES[name.split(".").pop().toLowerCase()] ?? "";
  if (method === 0) return new File([raw], name, { type });
  if (method !== 8) throw new Error(`unsupported zip compression (${method}) for ${name}`);
  const inflated = await new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
  return new File([inflated], name, { type });
}

/**
 * Turn what the GM picked into the files the wizard can classify: a zip becomes the entries in it that `isUseful`
 * says the importer wants (not read yet: each carries toFile()); anything else is passed through.
 * @param {File[]} picked
 * @param {(name:string)=>boolean} isUseful  true for a PDF or image the importer knows
 * @returns {Promise<{files:Array<File|object>, zips:Array<{name:string, total:number, used:number, error?:string}>}>}
 */
export async function expandPicked(picked, isUseful) {
  const files = [], zips = [];
  for (const f of picked) {
    if (!isZip(f)) { files.push(f); continue; }
    try {
      const entries = await readZip(f);
      const used = entries.filter((e) => isUseful(e.name));
      files.push(...used);
      zips.push({ name: f.name, total: entries.length, used: used.length });
    } catch (err) {
      zips.push({ name: f.name, total: 0, used: 0, error: String(err?.message ?? err) });
    }
  }
  return { files, zips };
}

/**
 * Replace every not-yet-read zip entry held in `held` (id → file) with its File. One at a time, to keep memory down.
 * An entry that cannot be inflated is dropped from `held`.
 * @returns {Promise<string[]>} the names of the entries that could not be read
 */
export async function materialize(held) {
  const failed = [];
  for (const [id, f] of Object.entries(held)) {
    if (typeof f.toFile !== "function") continue;
    try { held[id] = await f.toFile(); } catch (_err) { delete held[id]; failed.push(f.name); }
  }
  return failed;
}
