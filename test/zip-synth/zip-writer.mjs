/**
 * A minimal zip writer for tests (test/import-wizard-zip.test.mjs): stored or deflated entries, folder entries,
 * UTF-8 names. Enough to build the shapes the Arcane Library downloads have, from invented bytes.
 */
import zlib from "node:zlib";

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

/**
 * @param {Array<{path:string, data?:Uint8Array|Buffer, method?:"store"|"deflate"}>} entries  a path ending in "/" is a folder
 * @returns {Buffer} the zip file
 */
export function writeZip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.path, "utf8"), raw = Buffer.from(e.data ?? []);
    const deflate = (e.method ?? "deflate") === "deflate" && !e.path.endsWith("/");
    const body = deflate ? zlib.deflateRawSync(raw) : raw;
    const crc = zlib.crc32(raw);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(deflate ? 8 : 0), u16(0), u16(0x21), u32(crc), u32(body.length), u32(raw.length), u16(name.length), u16(0), name, body]);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(deflate ? 8 : 0), u16(0), u16(0x21), u32(crc), u32(body.length), u32(raw.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    parts.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(central);
  return Buffer.concat([...parts, cd, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(offset), u16(0)]);
}
