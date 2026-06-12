/**
 * Shadowdark Enhancer - Hexcrawl scene builder (Phase 17, REQ-37).
 *
 * Pure geometry helpers stay at the top of this module so it can be imported
 * directly by node:test. Foundry-bound deployment functions are added below
 * and must not touch Foundry globals at module evaluation time.
 */
import { MODULE_ID } from "../module-id.mjs";
import {
  locationNoteData,
  updateLocationProgress,
} from "./location-keyer.mjs";

export const DEFAULT_CALIBRATION = Object.freeze({
  x0: 110.8,
  dx: 126.9,
  yOdd0: 98,
  yEven0: 171.25,
  dy: 146.5,
  rowOffset: 0,
});

/**
 * Build a square-grid scene profile from an image's pixel dimensions and its
 * known row/column count. Foundry stores square grid size as an integer, so
 * the scene is expanded by a few pixels when necessary and the Level texture
 * is stretched to the resulting scene rectangle.
 */
export function squareGridProfile({
  imageWidth,
  imageHeight,
  columns,
  rows,
  distance = 5,
  units = "ft",
} = {}) {
  const values = [imageWidth, imageHeight, columns, rows].map(Number);
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new TypeError("Image dimensions, columns, and rows must be positive numbers");
  }
  const [width, height, columnCount, rowCount] = values;
  const size = Math.max(1, Math.round(((width / columnCount) + (height / rowCount)) / 2));
  return {
    width: Math.round(columnCount * size),
    height: Math.round(rowCount * size),
    grid: {
      type: 1,
      size,
      distance: Number(distance) > 0 ? Number(distance) : 5,
      units: String(units ?? "ft"),
    },
    textureFit: "fill",
  };
}

/** Convert a canvas-local point to integer Scene coordinates within bounds. */
export function clampScenePoint(point, width, height) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  const maxX = Number(width);
  const maxY = Number(height);
  if (![x, y, maxX, maxY].every(Number.isFinite) || maxX < 0 || maxY < 0) {
    throw new TypeError("A finite point and non-negative scene dimensions are required");
  }
  return {
    x: Math.min(maxX, Math.max(0, Math.round(x))),
    y: Math.min(maxY, Math.max(0, Math.round(y))),
  };
}

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
  const textureLoader =
    globalThis.foundry?.canvas?.loadTexture ??
    globalThis.loadTexture;
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

function embeddedSyncPlan(existingDocs, sourceDocs) {
  const existingIds = new Set(existingDocs.map((doc) => doc.id));
  return {
    updates: sourceDocs
      .filter((doc) => existingIds.has(doc.id))
      .map((doc) => doc.toObject()),
    creates: sourceDocs
      .filter((doc) => !existingIds.has(doc.id))
      .map((doc) => doc.toObject()),
  };
}

/**
 * Create or refresh the exact-ID sde-scenes backup for a managed world Scene.
 * Notes and Levels are upserted; backup-only embedded documents are not
 * deleted.
 */
export async function backupScene(scene, source) {
  const { findSuitePack, ensureSuite, ensureSourceFolder } = await import("./compendium-suite.mjs");
  let pack = findSuitePack("sde-scenes");
  if (!pack) pack = (await ensureSuite())?.scenes;
  if (!pack) throw new Error("sde-scenes pack not found");
  if (pack.locked) {
    try { await pack.configure({ locked: false }); } catch (_) {}
  }

  const folder = await ensureSourceFolder(pack, source);
  const data = scene.toObject();
  data.folder = folder;
  data.flags ??= {};
  data.flags[MODULE_ID] = {
    ...(data.flags[MODULE_ID] ?? {}),
    backup: true,
  };

  const existing = pack.index.get(scene.id) ? await pack.getDocument(scene.id) : null;
  if (!existing) return Scene.create(data, { pack: pack.collection, keepId: true });
  if (existing.flags?.[MODULE_ID]?.backup !== true) {
    throw new Error(`sde-scenes id ${scene.id} belongs to another document`);
  }

  await existing.update({
    name: data.name,
    width: data.width,
    height: data.height,
    padding: data.padding,
    backgroundColor: data.backgroundColor,
    grid: data.grid,
    flags: data.flags,
  });

  for (const documentName of ["Level", "Note"]) {
    const collectionName = Scene.metadata.embedded[documentName];
    const sourceDocs = scene[collectionName]?.contents ?? [];
    const existingDocs = existing[collectionName]?.contents ?? [];
    const { updates, creates } = embeddedSyncPlan(existingDocs, sourceDocs);
    if (updates.length) await existing.updateEmbeddedDocuments(documentName, updates);
    if (creates.length) {
      await existing.createEmbeddedDocuments(documentName, creates, { keepId: true });
    }
  }
  return existing;
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

async function updateLevelBackground(scene, imagePath, textureFit = "fill") {
  const level = scene.levels.get("defaultLevel0000") ?? scene.levels.contents[0];
  if (!level) throw new Error(`Scene "${scene.name}" has no Level document`);
  await level.update({
    "background.src": imagePath,
    "textures.fit": textureFit,
  });
  return level;
}

function refreshCanvasTicker() {
  if (!globalThis.canvas?.app?.ticker?.update) return false;
  globalThis.canvas.app.ticker.update(globalThis.performance?.now?.() ?? Date.now());
  return true;
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

/**
 * Deploy a numbered-location journal and create its empty map Scene. Notes are
 * added interactively by placeLocationNote().
 */
export async function createLocationScene({
  crawlId,
  crawlName,
  source = "",
  imagePath,
  gridMode = "gridless",
  columns = null,
  rows = null,
  distance = 5,
  units = "ft",
} = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can deploy a location scene.");
    return null;
  }
  if (!imagePath) throw new Error("A map image is required");
  if (gridMode !== "gridless" && gridMode !== "square") {
    throw new TypeError(`Unsupported location grid mode "${gridMode}"`);
  }

  const packEntry = await findCrawlEntry({ crawlId, crawlName, source });
  if (!packEntry) throw new Error(`Journal "${crawlName}" was not found in sde-journal`);
  if (String(packEntry.flags?.[MODULE_ID]?.keyMode ?? "hex") !== "location") {
    throw new Error(`Journal "${packEntry.name}" is not a numbered-location journal`);
  }
  const keyedPages = packEntry.pages.contents.filter((page) =>
    String(page.flags?.[MODULE_ID]?.key ?? "").startsWith("loc:"));
  if (!keyedPages.length) throw new Error(`Journal "${packEntry.name}" has no location pages`);

  const finalSource = String(packEntry.flags?.[MODULE_ID]?.source ?? source ?? "");
  const worldJournal = await deployCrawlJournal(packEntry);
  const image = await imageDimensions(imagePath);
  const profile = gridMode === "square"
    ? squareGridProfile({
        imageWidth: image.width,
        imageHeight: image.height,
        columns,
        rows,
        distance,
        units,
      })
    : {
        width: image.width,
        height: image.height,
        grid: { type: 0 },
        textureFit: "fill",
      };

  const scene = await Scene.create({
    name: uniqueWorldSceneName(packEntry.name),
    width: profile.width,
    height: profile.height,
    grid: profile.grid,
    flags: {
      [MODULE_ID]: {
        crawl: packEntry.name,
        source: finalSource,
        imported: true,
        deployed: true,
        keyMode: "location",
        gridMode,
        journalId: worldJournal.id,
        locationProgress: { placed: [], skipped: [] },
      },
    },
  });
  await updateLevelBackground(scene, imagePath, profile.textureFit);
  const backup = await backupScene(scene, finalSource);
  refreshCanvasTicker();
  return {
    scene,
    backup,
    journal: worldJournal,
    pages: keyedPages.length,
    gridMode,
  };
}

function assertLocationScene(scene) {
  if (!scene?.id || scene.flags?.[MODULE_ID]?.keyMode !== "location") {
    throw new TypeError("A managed numbered-location Scene is required");
  }
}

/** Place or move one keyed Note and persist resumable progress + backup. */
export async function placeLocationNote({ scene, page, key, point } = {}) {
  assertLocationScene(scene);
  if (!String(key ?? "").startsWith("loc:")) {
    throw new TypeError(`Invalid location key "${key}"`);
  }
  const noteData = {
    ...locationNoteData(page, clampScenePoint(point, scene.width, scene.height)),
    flags: {
      [MODULE_ID]: {
        key,
        crawl: scene.flags[MODULE_ID].crawl,
        source: scene.flags[MODULE_ID].source ?? "",
      },
    },
  };
  const existing = scene.notes.contents.find((note) =>
    note.flags?.[MODULE_ID]?.key === key);
  let note;
  if (existing) {
    [note] = await scene.updateEmbeddedDocuments("Note", [{ _id: existing.id, ...noteData }]);
  } else {
    [note] = await scene.createEmbeddedDocuments("Note", [noteData]);
  }

  const progress = updateLocationProgress(
    scene.flags?.[MODULE_ID]?.locationProgress,
    key,
    "placed",
  );
  await scene.update({ [`flags.${MODULE_ID}.locationProgress`]: progress });
  const backup = await backupScene(scene, scene.flags?.[MODULE_ID]?.source ?? "");
  refreshCanvasTicker();
  return { note, progress, backup };
}

/** Mark one location skipped and persist resumable progress + backup. */
export async function skipLocation({ scene, key } = {}) {
  assertLocationScene(scene);
  if (!String(key ?? "").startsWith("loc:")) {
    throw new TypeError(`Invalid location key "${key}"`);
  }
  const progress = updateLocationProgress(
    scene.flags?.[MODULE_ID]?.locationProgress,
    key,
    "skipped",
  );
  await scene.update({ [`flags.${MODULE_ID}.locationProgress`]: progress });
  const backup = await backupScene(scene, scene.flags?.[MODULE_ID]?.source ?? "");
  return { progress, backup };
}

export const SceneBuilder = {
  DEFAULT_CALIBRATION,
  squareGridProfile,
  clampScenePoint,
  hexCenter,
  splitNorthSouth,
  solveCalibration,
  buildNoteData,
  rewriteCrawlLinksForWorld,
  deployCrawlJournal,
  backupScene,
  buildCrawlScene,
  createLocationScene,
  placeLocationNote,
  skipLocation,
};
