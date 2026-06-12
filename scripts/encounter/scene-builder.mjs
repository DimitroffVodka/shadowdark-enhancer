/**
 * Shadowdark Enhancer - Hexcrawl scene builder (Phase 17, REQ-37).
 *
 * Pure geometry helpers stay at the top of this module so it can be imported
 * directly by node:test. Foundry-bound deployment functions are added below
 * and must not touch Foundry globals at module evaluation time.
 */
import { MODULE_ID } from "../module-id.mjs";

export const DEFAULT_CALIBRATION = Object.freeze({
  x0: 110.8,
  dx: 126.9,
  yOdd0: 98,
  yEven0: 171.25,
  dy: 146.5,
  rowOffset: 0,
});

function parseHexKey(key) {
  const match = /^(\d+),(\d+)$/.exec(String(key ?? "").trim());
  if (!match) throw new TypeError(`Invalid hex key "${key}"`);
  return { col: Number(match[1]), row: Number(match[2]) };
}

/**
 * Compute a keyed hex center using the flat-top Cursed Scroll lattice.
 * @param {string} key - normalized "col,row" key from hexIdKey()
 * @param {object} [calib]
 * @returns {{x:number,y:number}}
 */
export function hexCenter(key, calib = DEFAULT_CALIBRATION) {
  const { col, row } = parseHexKey(key);
  const effectiveRow = row - Number(calib.rowOffset ?? 0);
  if (effectiveRow < 1) {
    throw new RangeError(`Hex key "${key}" has effective row ${effectiveRow}`);
  }
  const y0 = col % 2 === 0 ? Number(calib.yEven0) : Number(calib.yOdd0);
  return {
    x: Number(calib.x0) + Number(calib.dx) * col,
    y: y0 + Number(calib.dy) * (effectiveRow - 1),
  };
}

/**
 * Partition normalized keys for a standard 11-row north map and optional
 * rows 12-22 south map. Keys are not rewritten.
 * @param {string[]} keys
 * @returns {{north:string[],south:string[]}}
 */
export function splitNorthSouth(keys) {
  const north = [];
  const south = [];
  for (const key of keys ?? []) {
    const { row } = parseHexKey(key);
    (row > 11 ? south : north).push(key);
  }
  return { north, south };
}

/**
 * Solve an axis-aligned affine transform from two clicked points while
 * preserving the template lattice proportions and stagger.
 * @param {{x:number,y:number}} p1
 * @param {{x:number,y:number}} p2
 * @param {string} ref1
 * @param {string} ref2
 * @returns {object}
 */
export function solveCalibration(p1, p2, ref1, ref2) {
  const d1 = hexCenter(ref1, DEFAULT_CALIBRATION);
  const d2 = hexCenter(ref2, DEFAULT_CALIBRATION);
  const refDx = d2.x - d1.x;
  const refDy = d2.y - d1.y;
  if (refDx === 0 || refDy === 0) {
    throw new RangeError("Reference hexes must differ on both axes");
  }

  const sx = (Number(p2.x) - Number(p1.x)) / refDx;
  const sy = (Number(p2.y) - Number(p1.y)) / refDy;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0) {
    throw new RangeError("Reference clicks do not produce a usable calibration");
  }

  const ox = Number(p1.x) - d1.x * sx;
  const oy = Number(p1.y) - d1.y * sy;
  return {
    x0: ox + DEFAULT_CALIBRATION.x0 * sx,
    dx: DEFAULT_CALIBRATION.dx * sx,
    yOdd0: oy + DEFAULT_CALIBRATION.yOdd0 * sy,
    yEven0: oy + DEFAULT_CALIBRATION.yEven0 * sy,
    dy: DEFAULT_CALIBRATION.dy * sy,
    rowOffset: 0,
  };
}

/**
 * Build a Foundry Note payload from a deployed world JournalEntryPage.
 * @param {object} page
 * @param {string} key
 * @param {object} [calib]
 * @returns {{entryId:string,pageId:string,x:number,y:number}}
 */
export function buildNoteData(page, key, calib = DEFAULT_CALIBRATION) {
  const entryId = page?.parent?.id;
  const pageId = page?.id;
  if (!entryId || !pageId) throw new TypeError("A deployed world journal page is required");
  return { entryId, pageId, ...hexCenter(key, calib) };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Point same-crawl page links at the deployed world JournalEntry. Other UUIDs
 * are left untouched.
 * @param {string} content
 * @param {string} packEntryUuid
 * @param {string} worldEntryId
 * @returns {string}
 */
export function rewriteCrawlLinksForWorld(content, packEntryUuid, worldEntryId) {
  const source = `${packEntryUuid}.JournalEntryPage.`;
  const target = `JournalEntry.${worldEntryId}.JournalEntryPage.`;
  return String(content ?? "").replace(
    new RegExp(`@UUID\\[${escapeRegExp(source)}`, "g"),
    `@UUID[${target}`,
  );
}

function worldPageData(page, packEntry) {
  const data = page.toObject();
  if (data.text?.content) {
    data.text.content = rewriteCrawlLinksForWorld(data.text.content, packEntry.uuid, packEntry.id);
  }
  return data;
}

/**
 * Deploy a crawl JournalEntry from sde-journal into the world. keepId preserves
 * the entry and embedded page IDs used by Notes. Re-deploy updates matching
 * pages and appends missing pages; world-only pages are never deleted.
 * @param {JournalEntry} packEntry
 * @returns {Promise<JournalEntry>}
 */
export async function deployCrawlJournal(packEntry) {
  if (!packEntry?.id || packEntry.flags?.[MODULE_ID]?.crawl !== true) {
    throw new TypeError("A managed crawl JournalEntry is required");
  }

  const entryData = packEntry.toObject();
  entryData.folder = null;
  entryData.pages = packEntry.pages.contents.map((page) => worldPageData(page, packEntry));

  let worldEntry = game.journal.get(packEntry.id);
  if (!worldEntry) {
    worldEntry = await JournalEntry.create(entryData, { keepId: true });
    return worldEntry;
  }
  if (worldEntry.flags?.[MODULE_ID]?.crawl !== true) {
    throw new Error(`World JournalEntry id ${packEntry.id} belongs to another document`);
  }

  await worldEntry.update({
    name: entryData.name,
    flags: entryData.flags,
  });

  const updates = [];
  const creates = [];
  for (const pageData of entryData.pages) {
    if (worldEntry.pages.has(pageData._id)) updates.push(pageData);
    else creates.push(pageData);
  }
  if (updates.length) {
    await worldEntry.updateEmbeddedDocuments("JournalEntryPage", updates);
  }
  if (creates.length) {
    await worldEntry.createEmbeddedDocuments("JournalEntryPage", creates, { keepId: true });
  }
  return worldEntry;
}

async function imageDimensions(imagePath) {
  const textureLoader = globalThis.loadTexture;
  if (typeof textureLoader !== "function") throw new Error("loadTexture is unavailable");
  const texture = await textureLoader(imagePath);
  const width = Number(texture?.baseTexture?.realWidth ?? texture?.width);
  const height = Number(texture?.baseTexture?.realHeight ?? texture?.height);
  if (!(width > 0) || !(height > 0)) {
    throw new Error(`Could not determine image dimensions for "${imagePath}"`);
  }
  return { width, height };
}

function uniqueWorldSceneName(base) {
  const names = new Set((game.scenes?.contents ?? []).map((scene) => scene.name));
  if (!names.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base} (${n})`;
    if (!names.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})`;
}

async function backupScene(scene, source) {
  const { findSuitePack, ensureSuite, ensureSourceFolder } = await import("./compendium-suite.mjs");
  let pack = findSuitePack("sde-scenes");
  if (!pack) pack = (await ensureSuite())?.scenes;
  if (!pack) throw new Error("sde-scenes pack not found");
  if (pack.locked) {
    try { await pack.configure({ locked: false }); } catch (_) {}
  }

  const existing = pack.index.get(scene.id);
  if (existing) return pack.getDocument(scene.id);

  const folder = await ensureSourceFolder(pack, source);
  const data = scene.toObject();
  data.folder = folder;
  data.flags ??= {};
  data.flags[MODULE_ID] = {
    ...(data.flags[MODULE_ID] ?? {}),
    backup: true,
  };
  return Scene.create(data, { pack: pack.collection, keepId: true });
}

async function createSceneForPages({
  crawlName,
  source,
  imagePath,
  worldJournal,
  packPages,
  calib,
  side,
  split,
}) {
  const { width, height } = await imageDimensions(imagePath);
  const baseName = split ? `${crawlName} - ${side === "south" ? "South" : "North"}` : crawlName;
  const scene = await Scene.create({
    name: uniqueWorldSceneName(baseName),
    width,
    height,
    grid: { type: 0 },
    flags: {
      [MODULE_ID]: {
        crawl: crawlName,
        source,
        imported: true,
        deployed: true,
        side,
        journalId: worldJournal.id,
      },
    },
  });

  const level = scene.levels.get("defaultLevel0000") ?? scene.levels.contents[0];
  if (!level) throw new Error(`Scene "${scene.name}" has no Level document`);
  await level.update({ "background.src": imagePath });

  const notes = [];
  for (const packPage of packPages) {
    const key = packPage.flags?.[MODULE_ID]?.key;
    const worldPage = worldJournal.pages.get(packPage.id);
    if (!key || !worldPage) continue;
    notes.push({
      ...buildNoteData(worldPage, key, calib),
      flags: { [MODULE_ID]: { key, crawl: crawlName, source } },
    });
  }
  if (notes.length) await scene.createEmbeddedDocuments("Note", notes);

  let tickerUpdated = false;
  if (globalThis.canvas?.app?.ticker?.update) {
    globalThis.canvas.app.ticker.update(globalThis.performance?.now?.() ?? Date.now());
    tickerUpdated = true;
  }

  const backup = await backupScene(scene, source);
  return { scene, backup, notes: notes.length, tickerUpdated };
}

async function findCrawlEntry({ crawlId, crawlName, source }) {
  const { findSuitePack } = await import("./compendium-suite.mjs");
  const pack = findSuitePack("sde-journal");
  if (!pack) return null;
  if (crawlId) return pack.getDocument(crawlId);

  const index = await pack.getIndex({ fields: ["flags"] });
  const match = [...index].find((entry) =>
    entry.flags?.[MODULE_ID]?.crawl === true &&
    String(entry.name ?? "").toLowerCase() === String(crawlName ?? "").trim().toLowerCase() &&
    String(entry.flags?.[MODULE_ID]?.source ?? "") === String(source ?? ""));
  return match ? pack.getDocument(match._id) : null;
}

/**
 * Deploy a managed crawl into the world and create one gridless Scene per map.
 * A north/south crawl requires `southImagePath`; south coordinates use
 * rowOffset 11. Each finished Scene is copied into sde-scenes with keepId.
 *
 * @param {object} opts
 * @param {string} opts.crawlName
 * @param {string} [opts.crawlId]
 * @param {string} [opts.source]
 * @param {string} opts.imagePath
 * @param {string} [opts.southImagePath]
 * @param {object} [opts.calib]
 * @returns {Promise<{journal:JournalEntry,scenes:Array<object>,notes:number}>}
 */
export async function buildCrawlScene({
  crawlName,
  crawlId = null,
  source = "",
  imagePath,
  southImagePath = null,
  calib = DEFAULT_CALIBRATION,
} = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can deploy a crawl scene.");
    return null;
  }
  if (!imagePath) throw new Error("A map image is required");

  const packEntry = await findCrawlEntry({ crawlId, crawlName, source });
  if (!packEntry) throw new Error(`Crawl "${crawlName}" was not found in sde-journal`);
  const finalSource = String(packEntry.flags?.[MODULE_ID]?.source ?? source ?? "");

  const pagePairs = packEntry.pages.contents
    .map((page) => ({ page, key: page.flags?.[MODULE_ID]?.key }))
    .filter((pair) => pair.key);
  if (!pagePairs.length) {
    throw new Error(`Crawl "${packEntry.name}" has no keyed journal pages`);
  }
  const split = splitNorthSouth(pagePairs.map((pair) => pair.key));
  const northSet = new Set(split.north);
  const southSet = new Set(split.south);
  if (southSet.size && !southImagePath) {
    throw new Error("This crawl has rows 12-22 and requires a South map image");
  }

  const worldJournal = await deployCrawlJournal(packEntry);
  const results = [];
  if (northSet.size) {
    results.push(await createSceneForPages({
      crawlName: packEntry.name,
      source: finalSource,
      imagePath,
      worldJournal,
      packPages: pagePairs.filter((pair) => northSet.has(pair.key)).map((pair) => pair.page),
      calib: { ...calib, rowOffset: 0 },
      side: "north",
      split: southSet.size > 0,
    }));
  }
  if (southSet.size) {
    results.push(await createSceneForPages({
      crawlName: packEntry.name,
      source: finalSource,
      imagePath: southImagePath,
      worldJournal,
      packPages: pagePairs.filter((pair) => southSet.has(pair.key)).map((pair) => pair.page),
      calib: { ...calib, rowOffset: 11 },
      side: "south",
      split: true,
    }));
  }

  return {
    journal: worldJournal,
    scenes: results,
    notes: results.reduce((sum, result) => sum + result.notes, 0),
  };
}

export const SceneBuilder = {
  DEFAULT_CALIBRATION,
  hexCenter,
  splitNorthSouth,
  solveCalibration,
  buildNoteData,
  rewriteCrawlLinksForWorld,
  deployCrawlJournal,
  buildCrawlScene,
};
