/**
 * Shadowdark Enhancer — Sealed Content
 *
 * Ships finished, verified content documents inside the module WITHOUT
 * shipping readable rules text: each unit (a class + its talents + tables)
 * is AES-GCM encrypted with a key derived from anchor phrases of the book
 * section it came from. Pasting that section proves ownership: the anchors
 * are located in the normalized paste (the module stores only their hashes
 * and token lengths), the key is derived from the paste's own words, and the
 * pre-authored documents decrypt and import with links remapped.
 *
 * See .planning/CHAR-CONTENT-UNLOCK-SPEC.md ("sealed content" pivot).
 *
 * Payload doc conventions:
 *   - intra-unit links are "@@LOCAL:<index>@@" tokens (index into payload.docs)
 *   - system-compendium links (shadowdark.*) are kept literal — those uuids
 *     are identical in every world.
 */

import { MODULE_ID } from "../module-id.mjs";

/** Registry of sealed units shipped under data/locked/. Metadata only. */
export const SEALED_UNITS = [
  {
    id: "wr-delver",
    name: "Delver",
    type: "Class",
    source: "WR",
    pages: "38",
    file: `modules/${MODULE_ID}/data/locked/wr-delver.json`,
    // anchor token-lengths + SHA-256 of each normalized anchor (order matters)
    anchors: [
      { len: 11, hash: "a99a161644209c94688a2bc968ce6450e74413afc27567ebc635c25f9bc27d63" },
      { len: 12, hash: "b0aacdd776112ed7b16aeb69eace790dde0346a2b99f0cb1e3eccc8fd22762b5" },
      { len: 7, hash: "d46408f4dd1c0960517626e1fafbef61ed882bd608bf4c7b09f8952d843d3b39" },
      { len: 6, hash: "21e31306b130f26170c8da2e44f10ff1d7c72722bb148a84cac25c86859983fe" },
      { len: 9, hash: "b9fdf3afe3044e08bbc0fb3f40b0fe699ddbcb530b4e8b65b5d8b7d4b4fdd6e6" },
    ],
  },
  {
    id: "wr-duelist",
    name: "Duelist",
    type: "Class",
    source: "WR",
    pages: "42",
    file: `modules/${MODULE_ID}/data/locked/wr-duelist.json`,
    anchors: [
      { len: 12, hash: "d208c9722e48fddc4e5dbe709f40e6e8ac565497b8033f0e07cdeb06077ecfcd" },
      { len: 11, hash: "3ce37ffc717f139667049874524a7b3a7a41cf6c3acda2163c17bad22262feab" },
      { len: 12, hash: "451eb03c5d82075f03ac2e4ee017511dc883b6a9ba48f643256383abaf50d0c1" },
      { len: 9, hash: "8aa2b4560f59c20c932a31e86a14d5e2ac38423af6f84b344bcc0a62859cdd9a" },
      { len: 10, hash: "c9254b5b8305cf081884afef847480fe961e20840d211398b68b1c79a86caeb6" },
    ],
  },
  {
    id: "wr-green-knight",
    name: "Green Knight",
    type: "Class",
    source: "WR",
    pages: "44",
    file: `modules/${MODULE_ID}/data/locked/wr-green-knight.json`,
    anchors: [
      { len: 7, hash: "30a7b58e7705e27d088c077e7bcf71b8f95ccdb0b9081cf94ad2c12209870609" },
      { len: 5, hash: "b8e815d50b3da2ed0c7a3aecb1a45f86eaa443c880563b5a26619783ebacc565" },
      { len: 10, hash: "a8fdfdcf1e7a409108349afa956076b83d118c9fb644f48b89bd7e83b21e55ba" },
      { len: 7, hash: "5a9fdbb7c8c6bb5ac4a874d4789e07392f92d4980a15e9aaa71eec69b94c9b53" },
      { len: 8, hash: "b50949c34d7925102a736e201d1d26c65a7ddb43bc450ec3e6a11ee60e753fdf" },
    ],
  },
  {
    id: "wr-kyzian-archer",
    name: "Kyzian Archer",
    type: "Class",
    source: "WR",
    pages: "49",
    file: `modules/${MODULE_ID}/data/locked/wr-kyzian-archer.json`,
    anchors: [
      { len: 11, hash: "0aad93075cf732a56d10da8284df97a5e72ebad39e5794c98f4fde4254a0a4c3" },
      { len: 7, hash: "5f5c14a02c978fbf2fa46606669e6d1ffe79369cc125a60c45e48539024696e7" },
      { len: 11, hash: "7d1ce44ad407ec3dd3fa92819357ab36cb575324a1057c39f542c2d72ce3535d" },
      { len: 8, hash: "f1caa604d3c38633b167bf123f53627dd688596befdc0c05bb284521ef99f977" },
      { len: 11, hash: "a01600dfaaa7c7407802be0f8119260901af814f8856d90b24bad587e1ea3c19" },
    ],
  },
  {
    id: "wr-monk-of-yag-kesh",
    name: "Monk of Yag-Kesh",
    type: "Class",
    source: "WR",
    pages: "50",
    file: `modules/${MODULE_ID}/data/locked/wr-monk-of-yag-kesh.json`,
    anchors: [
      { len: 7, hash: "792aed03547d561004b4bbda41b3e49aae14da0c1e7e9924c29c6772efdbbd29" },
      { len: 8, hash: "243a6bcad6447f380cbcfc987e30781d05a29517af2d712f8ad04d2a757fa7d0" },
      { len: 11, hash: "f495da375611655ae23d57e486a876a4f4a60754f744eb64163f22e46527298a" },
      { len: 11, hash: "b34ad28094a742a91ae9018200905f72a06b7a372a19b09bd2f6ccab2dcb90ff" },
      { len: 13, hash: "4d2b82a2a1f20274db1d64f18cff9a534ed855b66b83a5c962fc913c1caac546" },
    ],
  },
  {
    id: "wr-paladin",
    name: "Paladin",
    type: "Class",
    source: "WR",
    pages: "54",
    file: `modules/${MODULE_ID}/data/locked/wr-paladin.json`,
    anchors: [
      { len: 10, hash: "46b132bcbf5124b083d48010a2e5c53659f965bfa225baebe5fcedf81b9da91a" },
      { len: 9, hash: "94b6afba371a5b75dffef8e9a4aadcecf6a192ec47b0ef5aa48d8eb8c5f90c82" },
      { len: 14, hash: "4f06d60e363f50308fe50c30b45bbcfe63db0c1d696c3972497367ba928f93e5" },
      { len: 10, hash: "d7a5ef3315fc146a4f83eb3c97f6eb8341e251bcad903eb359e4dd617e6d3578" },
      { len: 10, hash: "bf9ec58c033f4ab9c23ec3aad1161c33dc143739cb64ae92521bd8fd2954419d" },
    ],
  },
  {
    id: "wr-roustabout",
    name: "Roustabout",
    type: "Class",
    source: "WR",
    pages: "63",
    file: `modules/${MODULE_ID}/data/locked/wr-roustabout.json`,
    anchors: [
      { len: 6, hash: "63be1ffc7c3709ce796fd8cc0c0781dc9bfabdb235beb36c0c2d43a52469c8ad" },
      { len: 13, hash: "629005fb3b71afa31b1d1885309a2e3a95a533b26c2c4b133e78c42d89a76551" },
      { len: 13, hash: "2020a09ddf6bdc377719ff088f0cab6471084e2aaf88fcab84d26317e475eb4d" },
      { len: 14, hash: "3fbf75911bed462211c1afe16aa5703f323c682bc5b0096a3af0153944954b84" },
      { len: 17, hash: "099c3c348baac1f4220395fc0323b8b9d905136e78c602e7d002bfc2ba82085c" },
    ],
  },
  {
    id: "wr-wyrdling",
    name: "Wyrdling",
    type: "Class",
    source: "WR",
    pages: "72",
    file: `modules/${MODULE_ID}/data/locked/wr-wyrdling.json`,
    anchors: [
      { len: 9, hash: "8a36464d56bc23b6a8333aedc747e9fa00e504a73ff65f728dc96cd48e9e927e" },
      { len: 8, hash: "319c39db7d81c385d41469b2b84c09b7c098f4e04433d9657c2c5e1a34baecc2" },
      { len: 12, hash: "34c7890b06908c66ddc055ea25cab63dc54a0bf5707f65d465f936bdf3ab1856" },
      { len: 10, hash: "9baa39946b5a2daa3f8f25fe9ec0acfd61e67c5b708f210776ef16f9432d0c87" },
      { len: 5, hash: "65135647e1c0173491c0c9e739ebb88fa8a874709ed6758db656dc460b4341e4" },
    ],
  },
  {
    id: "wr-necromancer",
    name: "Necromancer",
    type: "Class",
    source: "WR",
    pages: "52",
    file: `modules/${MODULE_ID}/data/locked/wr-necromancer.json`,
    anchors: [
      { len: 11, hash: "b1f8d610985b36527710710dfd291b9a5e31bee40a17ef5680ee1b49358e1ca4" },
      { len: 10, hash: "fe85f193b73b198b07a402ec2de7cdf5dd60723f3db2bfa234b9b2e067b6c54b" },
      { len: 13, hash: "5c7dc31a32988153fbbbf50ba71cadfab27c7179f9a9026ac053cbf0e430c50a" },
      { len: 16, hash: "68270a65181ba455cac6d5676fa858f6f100dbcdc046229d47503b2fefdf8f3f" },
      { len: 7, hash: "7cccbeb7627b388fcda0cd4b3283e13383e4fa95bf5dcb2b8432577bba459812" },
    ],
  },
  {
    id: "wr-backgrounds",
    name: "Backgrounds",
    type: "Background",
    coversType: "Background",   // any locked Background entry unlocks the whole set
    source: "WR",
    pages: "74",
    file: `modules/${MODULE_ID}/data/locked/wr-backgrounds.json`,
    anchors: [
      { len: 10, hash: "f232a295cb82f417f8da7de2fd89d5b62870d63e64e445e7d358d97cf7c69925" },
      { len: 9, hash: "ab2bac79ca6fe2ee9e9d7f674a02a20b30242e4e1f76a02a38a05ef9a9ba198d" },
      { len: 10, hash: "58eaf31d452d2108f30803c2a9c2f131789afbeda80305fd3fc9be5557256dad" },
      { len: 10, hash: "aa791fd181a872c02c92a17c7714a82a6c9d570f52f79057bcde17424a25e21e" },
      { len: 7, hash: "cbd3d57706de5a16368eceed905bd88a118da375d1f5a55ea39c35cff5826dc4" },
    ],
  },
  {
    id: "cs4-spells",
    name: "Cursed Scroll 4 Spells",
    type: "Spell",
    coversType: "Spell",   // any locked CS4 Spell (src CS4) unlocks the set
    source: "CS4",
    pages: "14-16",
    file: `modules/${MODULE_ID}/data/locked/cs4-spells.json`,
    anchors: [
      { len: 7, hash: "6032dc8108c9729a98f8e32bd676b5d3da1998aa882421c6e341ba29d69e3017" },
      { len: 7, hash: "f0fa9c50001ff77f58bdd10ddad6cce81ee2b074d5c8c4e84d266878a4333f30" },
      { len: 7, hash: "cd0e0f87c84f4dce7f14a410ee92d68e443cd4b3d6217c75163e7a3e45b5a965" },
      { len: 7, hash: "11af0c0d1f5f22f87d76334edf78ea65b7d4afe508df1a7174852c758f18428a" },
      { len: 7, hash: "355aeb783456399c0af530783f943aadf69be50c660b7e0e225945db13435216" },
    ],
  },
  {
    id: "cs4-monsters",
    name: "Cursed Scroll 4 Monsters",
    type: "Actor",
    coversType: "Actor",   // any locked CS4 monster (src CS4) unlocks the set
    source: "CS4",
    pages: "55-66",
    file: `modules/${MODULE_ID}/data/locked/cs4-monsters.json`,
    anchors: [
      { len: 6, hash: "61571c81871a28a228884bf4d19dabe540001d581c67261b26aa721dc0903714" },
      { len: 5, hash: "68d41c325e3eedab17d731a277226b61b9b6af4f02b992e0f6c61bea12f786a2" },
      { len: 3, hash: "9aab0ff6eb1f4eb3ca980d1137af12de9c88fb330236840bac723b02d039a0b3" },
      { len: 4, hash: "d3fc9f46d0000276c6a47d493638021716836101c1bc1287b4114f35092106a5" },
      { len: 6, hash: "37e543421290c6f4b862f2f4f370ee92bbf72981a6f9cc5dc2cf5ca3289dfe27" },
    ],
  },
  {
    id: "cs5-spells",
    name: "Cursed Scroll 5 Spells",
    type: "Spell",
    coversType: "Spell",
    source: "CS5",
    pages: "12-15",
    file: `modules/${MODULE_ID}/data/locked/cs5-spells.json`,
    anchors: [
      { len: 6, hash: "cadf810517d04c663b0ab2c5eea748a2221e8ed4254db7f9d8b207f12af97250" },
      { len: 7, hash: "a573dd514cdb6d16fc75909279965c86b4773108225a0137011b4b48fcaab39e" },
      { len: 6, hash: "ca75a0d27939d349a2d1eaac130710320af098d7045a8deb0b6847bb20c35b70" },
      { len: 7, hash: "94960812a8c800085094ea9fce697e3b3c5011ddf9efe1a18241751e3a225b02" },
      { len: 7, hash: "495951998cda41ad4057f8e8c562cb23da2d8ceada27086813dcd1e5ed3e17af" },
    ],
  },
  {
    id: "cs5-gear",
    name: "Cursed Scroll 5 Gear",
    type: "Basic",
    coversType: "Basic",
    source: "CS5",
    pages: "16-17",
    file: `modules/${MODULE_ID}/data/locked/cs5-gear.json`,
    anchors: [
      { len: 7, hash: "78c5520e4523d68951b49cbfc4f156a3e6d714e7cca1f25e27c4b1b95674ce92" },
      { len: 6, hash: "a0b74885d8fa41530e41516b7d3d5c82014b748e4fd56ecf4b2d8af50a5d428a" },
      { len: 6, hash: "c9359b2d2085a2962d76545ae43453cb063544f9e14fbf851b3b07045a342de7" },
      { len: 3, hash: "9fd57b5f18ffd1b7217edda5e9a40a7e15b81807f193f4c6c6af8b0245f9c6e1" },
      { len: 7, hash: "12ae6da53be838d8a6882f49ae0431580551ec7f3d715853fce798448e10b6ae" },
    ],
  },
  {
    id: "cs5-monsters",
    name: "Cursed Scroll 5 Monsters",
    type: "Actor",
    coversType: "Actor",
    source: "CS5",
    pages: "18-24",
    file: `modules/${MODULE_ID}/data/locked/cs5-monsters.json`,
    anchors: [
      { len: 4, hash: "9f08fda630ff1385129b1dbe4902d42929ceab2c6cec8623c90be95deca9e94c" },
      { len: 5, hash: "8a6eec83b17a14216c7dd15c6f264ba5c55d3907b31ea1233949e12f8c5aa39d" },
      { len: 6, hash: "cf4b62b525248bf3df48c275039cf8568b125656b986b41889fcd08c8b811aa6" },
      { len: 6, hash: "1fb2e8d89600f3053f5d62a6dd7647a7fbc0e8771158259244706fc51addd423" },
      { len: 5, hash: "e658ac152b6b3230292b01a14c71d35ee292f92fb44777ec608e4738f15be8ad" },
    ],
  },
];

/** Lowercase, strip everything but letters/digits, collapse spaces. */
export function normalizeKeyText(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

async function _sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function _aesKey(material, usage) {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, [usage]);
}

const _b64 = (u8) => btoa(String.fromCharCode(...u8));
const _unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Locate the unit's anchors inside a paste. The module knows only each
 * anchor's token length + hash; we slide a token window over the normalized
 * paste and hash candidates. Returns { found, total, material } — material
 * (the recovered plaintext anchors, joined) only when all are found.
 */
export async function findAnchors(unit, pasteText) {
  const tokens = normalizeKeyText(pasteText).split(" ");
  const recovered = [];
  let found = 0;
  for (const a of unit.anchors) {
    let hit = null;
    for (let i = 0; i + a.len <= tokens.length; i++) {
      const cand = tokens.slice(i, i + a.len).join(" ");
      // eslint-disable-next-line no-await-in-loop
      if (await _sha256Hex(cand) === a.hash) { hit = cand; break; }
    }
    if (hit) { found++; recovered.push(hit); } else recovered.push(null);
  }
  return { found, total: unit.anchors.length, material: found === unit.anchors.length ? recovered.join("|") : null };
}

/** Try to decrypt a unit with a paste. → { ok, payload?, found, total } */
export async function tryUnseal(unit, pasteText) {
  const { found, total, material } = await findAnchors(unit, pasteText);
  if (!material) return { ok: false, found, total };
  try {
    // .enc files are base64 text (repo-friendly); iv is the first 12 bytes.
    const u8 = _unb64((await (await fetch(unit.file)).text()).trim());
    const iv = u8.slice(0, 12);
    const key = await _aesKey(material, "decrypt");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, u8.slice(12));
    return { ok: true, payload: JSON.parse(new TextDecoder().decode(plain)), found, total };
  } catch (err) {
    console.error(`${MODULE_ID} | unseal ${unit.id} failed:`, err);
    return { ok: false, found, total, error: "decrypt" };
  }
}

/**
 * DEV: seal a payload. anchors = plaintext phrases (normalized internally).
 * Returns { encBase64, anchorsMeta } — write the file + registry entry by hand.
 */
export async function sealUnit(payload, anchorPhrases) {
  const norm = anchorPhrases.map(normalizeKeyText);
  const anchorsMeta = [];
  for (const a of norm) anchorsMeta.push({ len: a.split(" ").length, hash: await _sha256Hex(a) });
  const material = norm.join("|");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await _aesKey(material, "encrypt");
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key,
    new TextEncoder().encode(JSON.stringify(payload))));
  const out = new Uint8Array(iv.length + enc.length);
  out.set(iv); out.set(enc, iv.length);
  return { encBase64: _b64(out), anchorsMeta };
}

/** Compendium folder path ("Class/Roustabout") for a live doc, or null. */
function _sealFolderPath(doc) {
  const pack = doc.compendium ?? game.packs.get(doc.pack);
  let fid = doc.folder?.id ?? doc.folder ?? null;
  const parts = [];
  while (fid && pack) {
    const f = pack.folders.get(fid);
    if (!f) break;
    parts.unshift(f.name);
    fid = f.folder?.id ?? f.folder ?? null;
  }
  return parts.length ? parts.join("/") : null;
}

const _WORLD_REF = /Compendium\.world\.[\w-]+\.[A-Za-z]+\.[A-Za-z0-9]{16}/g;

/**
 * DEV: capture a unit's CURRENT live docs into a seal payload. Starts from
 * `roots` (uuids — usually a class), follows every world-pack reference to a
 * transitive closure, then topologically sorts so a referenced doc always
 * precedes its referencer (import creates in order, remapping @@LOCAL tokens as
 * uuids become known). Intra-unit refs → @@LOCAL:n@@; system/other refs stay
 * literal. Folder paths are captured from the live structure. Pass
 * `bundleSpellsForClass` (a class uuid) to also pull in every world.spells doc
 * that lists that class — spells reference the class, not vice-versa, so they
 * aren't reachable by traversal (Necromancer's own list; Green Knight's druid
 * list). Returns { docs } for sealUnit — never leaves prose in the caller.
 */
export async function captureUnitPayload({ roots = [], bundleSpellsForClass = null, rootsOnly = false } = {}) {
  const isWorld = (u) => typeof u === "string" && /^Compendium\.world\./.test(u);
  const docs = new Map();       // uuid -> live doc
  const refs = new Map();       // uuid -> Set(world refs inside it)
  const queue = [...roots];
  if (bundleSpellsForClass) {
    // Spells live in the sde-items suite pack (type:"Spell"), not a dedicated
    // "world.spells" collection — the old hardcoded pack no longer exists.
    const { findSuitePack } = await import("./compendium-suite.mjs");
    const pack = findSuitePack("sde-items") ?? game.packs.get("world.spells");
    for (const s of (pack ? await pack.getDocuments() : [])) {
      if (s.type !== "Spell") continue;
      let c = s.system.class; c = Array.isArray(c) ? c : (c ? [c] : []);
      if (c.includes(bundleSpellsForClass)) queue.push(s.uuid);
    }
  }
  while (queue.length) {
    const u = queue.shift();
    if (!isWorld(u) || docs.has(u)) continue;
    // eslint-disable-next-line no-await-in-loop
    const d = await fromUuid(u).catch(() => null);
    if (!d) continue;
    docs.set(u, d);
    const found = new Set();
    // rootsOnly: capture just the given docs, don't follow world refs. Needed
    // for spell units — a spell references its class(es), and traversal would
    // otherwise pull the whole (separately-sealed) class into the spell unit.
    if (!rootsOnly) for (const m of JSON.stringify(d.toObject()).matchAll(_WORLD_REF)) { found.add(m[0]); queue.push(m[0]); }
    refs.set(u, found);
  }

  // Topological order (refs first). A cycle just stops recursing — import's
  // token remap tolerates a not-yet-created target by leaving it empty.
  const inSet = new Set(docs.keys());
  const order = [];
  const state = new Map();
  const visit = (u) => {
    if (state.get(u)) return;                 // visiting(1) or done(2)
    state.set(u, 1);
    for (const r of (refs.get(u) || [])) if (inSet.has(r) && r !== u) visit(r);
    state.set(u, 2); order.push(u);
  };
  for (const u of docs.keys()) visit(u);

  const idx = new Map(order.map((u, i) => [u, i]));
  const out = [];
  for (const u of order) {
    const d = docs.get(u);
    const data = d.toObject();
    for (const k of ["_id", "_stats", "ownership", "sort", "folder"]) delete data[k];
    let json = JSON.stringify(data);
    for (const [refU, refI] of idx) if (refU !== u) json = json.split(refU).join(`@@LOCAL:${refI}@@`);
    const kind = d.documentName === "RollTable" ? "RollTable"
      : d.documentName === "Actor" ? "Actor" : "Item";
    out.push({ kind, data: JSON.parse(json), folder: _sealFolderPath(d) });
  }
  return { docs: out };
}

/** Rewrite "@@LOCAL:n@@" tokens using the created-uuid map. */
function _remap(value, uuids) {
  if (typeof value === "string") return value.replace(/@@LOCAL:(\d+)@@/g, (_, n) => uuids[Number(n)] ?? "");
  if (Array.isArray(value)) return value.map((v) => _remap(v, uuids));
  if (value && typeof value === "object") {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = _remap(v, uuids);
    return o;
  }
  return value;
}

/**
 * Import an unsealed payload: create docs in dependency order (payload.docs
 * are topologically ordered at seal time), remapping local links as uuids
 * become known. Items → sde-items pack, RollTables → sde-tables pack (with
 * folder). Returns created doc uuids.
 */
/**
 * Item document type → suite pack descriptor id. Character-builder content is
 * routed to its own pack (mirroring the reorg'd world); gear (Basic/Weapon/
 * Armor/…) falls back to sde-items.
 */
const SEALED_ITEM_PACK = {
  Class: "classes",
  Talent: "talents",
  "Class Ability": "class-abilties",
  Spell: "spells",
  Background: "background",
  Ancestry: "ancestries",
};

export async function importSealedPayload(payload) {
  const { ensureSuite, findSuitePack } = await import("./compendium-suite.mjs");
  await ensureSuite();
  const itemPack = findSuitePack("sde-items") ?? game.packs.get("world.shadowdark-enhancer--items");
  const tablePack = findSuitePack("sde-tables") ?? game.packs.get("world.shadowdark-enhancer--roll-tables");
  const actorPack = findSuitePack("sde-actors") ?? game.packs.get("world.shadowdark-enhancer--actors");
  // Route an Item to its type-specific pack (falls back to sde-items for gear).
  const packForItem = (type) => (SEALED_ITEM_PACK[type] && findSuitePack(SEALED_ITEM_PACK[type])) || itemPack;
  const uuids = [];
  const created = [];
  // Folder paths ("Talents/Class") recreate the user's compendium taxonomy —
  // documents are NEVER left at pack root (standing user directive).
  const ensureFolder = async (pack, path, type) => {
    let parent = null;
    for (const part of String(path).split("/")) {
      let fo = pack.folders.find((x) => x.name === part && (x.folder?.id ?? null) === (parent?.id ?? null));
      if (!fo) fo = await Folder.create({ name: part, type, folder: parent?.id ?? null }, { pack: pack.collection });
      parent = fo;
    }
    return parent;
  };
  for (const entry of payload.docs) {
    const data = _remap(entry.data, uuids);
    // Idempotent: a doc of the same name/type already in the pack is reused,
    // so re-unlocks and units sharing docs (e.g. two classes, one weapon)
    // never duplicate.
    let doc;
    if (entry.kind === "Item") {
      const pack = packForItem(data.type);
      const idx = await pack.getIndex({ fields: ["type"] });
      const e = idx.find((x) => x.name === data.name && x.type === data.type);
      if (e) { uuids.push(`Compendium.${pack.collection}.Item.${e._id}`); created.push({ kind: entry.kind, name: data.name, uuid: uuids.at(-1), reused: true }); continue; }
      if (entry.folder) data.folder = (await ensureFolder(pack, entry.folder, "Item")).id;
      [doc] = await Item.createDocuments([data], { pack: pack.collection });
    } else if (entry.kind === "RollTable") {
      const idx = await tablePack.getIndex();
      const e = idx.find((x) => x.name === data.name);
      if (e) { uuids.push(`Compendium.${tablePack.collection}.RollTable.${e._id}`); created.push({ kind: entry.kind, name: data.name, uuid: uuids.at(-1), reused: true }); continue; }
      const folderId = entry.folder ? (await ensureFolder(tablePack, entry.folder, "RollTable")).id : null;
      [doc] = await RollTable.createDocuments([{ ...data, folder: folderId }], { pack: tablePack.collection });
    } else if (entry.kind === "Actor") {
      const idx = await actorPack.getIndex();
      const e = idx.find((x) => x.name === data.name);
      if (e) { uuids.push(`Compendium.${actorPack.collection}.Actor.${e._id}`); created.push({ kind: entry.kind, name: data.name, uuid: uuids.at(-1), reused: true }); continue; }
      const folderId = entry.folder ? (await ensureFolder(actorPack, entry.folder, "Actor")).id : null;
      [doc] = await Actor.createDocuments([{ ...data, folder: folderId }], { pack: actorPack.collection });
    }
    uuids.push(doc?.uuid ?? "");
    created.push({ kind: entry.kind, name: doc?.name, uuid: doc?.uuid });
  }
  return created;
}

/** Sealed unit matching a manifest/census entry: by name, or by a set-level
 *  unit covering the entry's document type (e.g. any Background → the full
 *  backgrounds set). */
export function sealedUnitFor(name, type = null) {
  return SEALED_UNITS.find((u) => u.anchors.length && u.name.toLowerCase() === String(name).toLowerCase())
    ?? (type ? SEALED_UNITS.find((u) => u.anchors.length && u.coversType === type) ?? null : null);
}

/**
 * Ordered candidate units for a census/manifest entry — a paste is tried
 * against each until one unseals. Handles MULTIPLE set-level units of the same
 * type (e.g. per-book Spell units CS4/CS5/CS6/WR) that `sealedUnitFor` can't
 * disambiguate: exact name (classes) → same coversType AND same source (the
 * right book) → same coversType any source (single-set types / src fallback).
 * The anchors guarantee correctness — only the matching book's paste satisfies
 * a unit's phrases — so trying extra candidates is safe.
 */
export function sealedUnitsFor({ name = "", type = null, source = null } = {}) {
  const live = SEALED_UNITS.filter((u) => u.anchors.length);
  const out = [];
  const push = (u) => { if (u && !out.includes(u)) out.push(u); };
  push(live.find((u) => u.name.toLowerCase() === String(name).toLowerCase()));
  if (type) {
    if (source) for (const u of live) if (u.coversType === type && u.source === source) push(u);
    for (const u of live) if (u.coversType === type) push(u);
  }
  return out;
}
