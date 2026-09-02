/**
 * GM-curated portrait/token gallery for the character builder.
 *
 * Foundry gates the FilePicker behind `FILES_BROWSE`, which the Player role does
 * not hold by default — and granting it exposes the ENTIRE data directory (maps,
 * handouts, unrevealed tokens), because core has no per-role directory restriction.
 *
 * So the player never touches the filesystem. The GM nominates one folder in
 * settings; when a permission-less player opens the gallery, the browse runs on the
 * GM's client via a v13+ query (`CONFIG.queries`) and only the resulting file list
 * comes back. The player picks a path, which is just a string — the actor is then
 * created by the GM over the system's existing `createCharacter` socket, so no
 * upload or browse permission is ever needed.
 *
 * Security: the query handler ignores everything the caller sends and reads the
 * folder from the world setting. A player cannot ask the GM's client to browse an
 * arbitrary path.
 */
import { MODULE_ID } from "../shared/module-id.mjs";

/** Query name, namespaced per Foundry's convention. */
export const ART_QUERY = `${MODULE_ID}.browseArt`;

const SETTING = "charBuilderArtFolder";
/** Optional portrait source shipped by Pathfinder Tokens: Character Gallery. */
export const PF_CHARACTER_ART_FOLDER = "modules/pf2e-tokens-characters/assets/portraits";
const FilePickerImpl = () => foundry.applications.apps.FilePicker.implementation;

const isImage = (path) => {
  const clean = String(path).toLowerCase().split("?")[0];
  return Object.keys(CONST.IMAGE_FILE_EXTENSIONS).some((ext) => clean.endsWith(`.${ext}`));
};

/**
 * The GM-configured gallery folders. The setting is a comma / newline separated
 * list so a table can point at several sources at once. Defaults to the module's
 * own bundled portrait art (`assets/portraits` + the class/ancestry portraits) so
 * the gallery is self-contained; a GM can append any other folder — including
 * Tokenizer's save locations. Empty list = feature off.
 */
export function galleryFolders() {
  let raw = "";
  try { raw = String(game.settings.get(MODULE_ID, SETTING) ?? ""); }
  catch (_e) { return []; }   // setting not registered yet
  const configured = raw.split(/[,\n;]/).map((f) => f.trim().replace(/\/+$/, "")).filter(Boolean);
  // Keep a blank setting as the explicit "gallery off" switch. When the
  // gallery is enabled, the optional PF source is additive and is probed by
  // browseLocal's per-folder try/catch, so absent/inactive/unreadable modules
  // do not affect configured custom folders.
  if (!configured.length) return [];
  return [...new Set([...configured, PF_CHARACTER_ART_FOLDER])];
}

/** Human-readable folder list, for the "nothing here" warning. */
export const galleryFolderLabel = () => galleryFolders().join(", ");

export const galleryEnabled = () => galleryFolders().length > 0;

/**
 * Browse every configured folder with THIS client's permissions (needs
 * FILES_BROWSE) and merge the results.
 *
 * A folder that does not exist yet is normal — a GM-added source (e.g. a
 * Tokenizer save dir) may not be created until first use — so a failing folder is
 * skipped rather than emptying the whole gallery. Paths are de-duplicated (folders
 * may overlap) and sorted by filename so the grid ordering is stable.
 */
async function browseLocal(folders) {
  const seen = new Set();
  for (const folder of folders) {
    let res;
    try { res = await FilePickerImpl().browse("data", folder); }
    catch (err) {
      console.debug(`${MODULE_ID} | art gallery: skipping unreadable folder "${folder}":`, err?.message ?? err);
      continue;
    }
    for (const f of (res.files ?? [])) if (isImage(f)) seen.add(f);
  }
  const base = (p) => p.split("/").pop().toLowerCase();
  return [...seen].sort((a, b) => base(a).localeCompare(base(b)));
}

/**
 * Register the GM-side handler. Called on every client at init; it only ever
 * executes on whichever client is queried (the active GM).
 */
export function registerArtGalleryQuery() {
  CONFIG.queries[ART_QUERY] = async () => {
    // Deliberately ignores the caller's payload — see the security note above.
    const folders = galleryFolders();
    if (!folders.length) return { files: [], folders: [] };
    try {
      return { files: await browseLocal(folders), folders };
    } catch (err) {
      console.error(`${MODULE_ID} | art gallery browse failed for [${folders.join(", ")}]:`, err);
      return { files: [], folders, error: String(err?.message ?? err) };
    }
  };
}

/**
 * The gallery's image list. Browses directly when we may, otherwise asks the GM.
 * Returns [] (and warns) when the folder is unset, empty, or no GM is online.
 */
export async function listGalleryArt() {
  const folders = galleryFolders();
  if (!folders.length) return [];

  if (game.user.can("FILES_BROWSE")) {
    return browseLocal(folders).catch((err) => {
      console.error(`${MODULE_ID} | art gallery browse failed:`, err);
      return [];
    });
  }

  const gm = game.users.activeGM;
  if (!gm) {
    ui.notifications.warn(game.i18n.localize("SDE.charBuilder.art.galleryNoGm"));
    return [];
  }
  const res = await gm.query(ART_QUERY, {}, { timeout: 10_000 }).catch((err) => {
    console.error(`${MODULE_ID} | art gallery query failed:`, err);
    return null;
  });
  return res?.files ?? [];
}

/**
 * Art a module publishes ABOUT its own images, rather than the images alone.
 *
 * `module.flags.galleryDatasheets` is the convention Pathfinder Tokens:
 * Character Gallery uses to point at a JSON manifest of its artwork: a label, a
 * source book, one path per slot (portrait / token / thumbnail), and free-form
 * tag groups (ancestry, category, equipment, family). Browsing the folder gives
 * 1,200 filenames in one undifferentiated wall; the datasheet is what makes them
 * searchable and filterable, which is the whole reason to install such a module.
 *
 * Read generically from EVERY active module that declares the flag — this is
 * not a Pathfinder integration, and nothing here requires that module (or any
 * module) to be present. A world with no datasheets falls back to plain folder
 * browsing exactly as before.
 */
async function readDatasheet(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch (err) {
    console.warn(`${MODULE_ID} | art gallery: unreadable datasheet "${path}":`, err?.message ?? err);
    return [];
  }
}

/** Prettify a bare filename into something worth reading in the grid. */
const fileLabel = (p) => String(p).split("/").pop().replace(/\.\w+$/, "").replace(/[_-]+/g, " ");

/**
 * One pickable image, plus whatever is known about it.
 * @typedef {object} GalleryEntry
 * @property {string} src    the path applied to the chosen slot
 * @property {string} thumb  a lighter image for the grid (falls back to `src`)
 * @property {string} label  display name
 * @property {string} source book/module the art came from, or ""
 * @property {Record<string, string[]>} tags  facet group → values
 * @property {string[]} art  every path this entry owns, across all slots
 */

/**
 * Datasheet rows as gallery entries for one slot. The token slot prefers the
 * artwork's TOKEN image — picking "Token from gallery…" and receiving a framed
 * portrait is the kind of near-miss that reads as broken.
 *
 * @param {"portrait"|"token"} slot
 * @returns {Promise<GalleryEntry[]>}
 */
export async function datasheetEntries(slot = "portrait") {
  const sheets = [];
  for (const mod of game.modules ?? []) {
    if (mod?.active === false) continue;
    for (const decl of Object.values(mod?.flags?.galleryDatasheets ?? {})) {
      if (decl?.sheet) sheets.push(decl.sheet);
    }
  }
  if (!sheets.length) return [];

  const out = [];
  for (const path of sheets) {
    for (const row of await readDatasheet(path)) {
      const art = row?.art ?? {};
      const paths = [art.portrait, art.token, art.thumb, art.subject].filter(Boolean).map(String);
      const src = slot === "token"
        ? (art.token ?? art.portrait)
        : (art.portrait ?? art.token);
      if (!src) continue;
      const tags = {};
      for (const [group, values] of Object.entries(row?.tags ?? {})) {
        const list = (Array.isArray(values) ? values : [values]).map((v) => String(v).trim()).filter(Boolean);
        if (list.length) tags[group] = list;
      }
      out.push({
        src: String(src),
        thumb: String(art.thumb ?? src),
        // Trimmed: a stray leading space in a third-party sheet otherwise sorts
        // that row to the very top of the grid, ahead of every "A".
        label: String(row?.label ?? fileLabel(src)).trim(),
        source: String(row?.source ?? "").trim(),
        tags,
        art: paths,
      });
    }
  }
  return out;
}

/**
 * Everything the gallery can offer for one slot: datasheet entries first, then
 * any browsed file no datasheet already describes.
 *
 * A datasheet row owns ALL of its paths, not just the one this slot uses —
 * otherwise the token slot would list the character twice, once as a described
 * token and once as its own bare portrait file picked up by the folder browse.
 *
 * @param {"portrait"|"token"} slot
 * @returns {Promise<GalleryEntry[]>}
 */
export async function galleryEntries(slot = "portrait") {
  const described = await datasheetEntries(slot);
  const covered = new Set(described.flatMap((e) => e.art));
  const entries = [...described];
  for (const file of await listGalleryArt()) {
    if (covered.has(file)) continue;
    entries.push({ src: file, thumb: file, label: fileLabel(file), source: "", tags: {}, art: [file] });
  }
  return entries.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Shadowdark ancestry → the datasheet `ancestry` tags that portray it.
 *
 * The raw tag list runs to a hundred values, nearly all of them Pathfinder
 * ancestries with no Shadowdark equivalent, which is not a filter so much as a
 * second wall of choices. This is the curated list: the eight ancestries a
 * character can actually be, each mapped to every tag that depicts one.
 *
 * The two-tag rows are the ones worth knowing about. Pathfinder renamed its
 * half-ancestries — a half-elf is an `aiuvarin` and a half-orc a `dromaar` —
 * so matching only "elf" and "orc" would silently drop the 54 portraits that
 * are specifically of half-ancestry characters, which are the best matches of
 * all. Both spellings are accepted.
 *
 * Anything outside this list (gnome, tengu, a homebrew ancestry) stays
 * reachable by typing it into the search box, which reads the tags too.
 */
export const ANCESTRY_TAGS = {
  dwarf:    { label: "Dwarf",     tags: ["dwarf"] },
  elf:      { label: "Elf",       tags: ["elf"] },
  goblin:   { label: "Goblin",    tags: ["goblin"] },
  halfelf:  { label: "Half-Elf",  tags: ["aiuvarin", "elf"] },
  halfling: { label: "Halfling",  tags: ["halfling"] },
  halforc:  { label: "Half-Orc",  tags: ["dromaar", "orc"] },
  human:    { label: "Human",     tags: ["human"] },
  kobold:   { label: "Kobold",    tags: ["kobold"] },
};

/** Fold an ancestry name to its ANCESTRY_TAGS key ("Half-Elf"/"Half Elf" → halfelf). */
export const ancestryKey = (name) => String(name ?? "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * The curated ancestry options for a set of entries: every mapped ancestry that
 * actually has art, with its count. An ancestry no installed module depicts is
 * left out rather than offered as a filter that yields nothing.
 */
function ancestryOptions(entries) {
  return Object.entries(ANCESTRY_TAGS)
    .map(([key, { label, tags }]) => ({
      key,
      tags,
      label,
      count: entries.filter((e) => (e.tags.ancestry ?? []).some((v) => tags.includes(v))).length,
    }))
    .filter((o) => o.count > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Facet group → its sorted distinct values, across the entries that have any.
 * `ancestry` is excluded: the curated ancestry control above replaces it.
 */
function galleryFacets(entries) {
  const facets = new Map();
  for (const entry of entries) {
    for (const [group, values] of Object.entries(entry.tags)) {
      if (group === "ancestry") continue;
      const set = facets.get(group) ?? new Set();
      for (const v of values) set.add(v);
      facets.set(group, set);
    }
  }
  // A group with a single value filters nothing — it is a control that can only
  // ever be a no-op, so it does not earn space in the bar.
  return [...facets.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([group, values]) => [group, [...values].sort((a, b) => a.localeCompare(b))])
    .sort(([a], [b]) => a.localeCompare(b));
}

/** Wire the search box and facet selects to show/hide tiles. Pure DOM, no re-render. */
function installGalleryFilter(root, onCount) {
  const grid = root.querySelector(".sde-cb-gallery");
  const search = root.querySelector(".sde-cb-gallery-search");
  const ancestry = root.querySelector(".sde-cb-gallery-ancestry");
  const selects = [...root.querySelectorAll("[data-facet]")];
  const tiles = [...grid.querySelectorAll(".sde-cb-gallery-item")];

  const apply = () => {
    const needle = (search?.value ?? "").trim().toLowerCase();
    const wanted = selects
      .filter((s) => s.value)
      .map((s) => `${s.dataset.facet}:${s.value}`);
    // One ancestry can be depicted by several tags (a half-elf is an aiuvarin
    // OR an elf), so this one control is an ANY test, not an all test.
    const anyOf = (ancestry?.selectedOptions?.[0]?.dataset.tags ?? "").split(" ").filter(Boolean);
    let shown = 0;
    for (const tile of tiles) {
      const hit = (!needle || tile.dataset.search.includes(needle))
        && wanted.every((w) => tile.dataset.tags.includes(` ${w} `))
        && (!anyOf.length || anyOf.some((t) => tile.dataset.tags.includes(` ancestry:${t} `)));
      tile.hidden = !hit;
      if (hit) shown++;
    }
    onCount(shown, tiles.length);
  };

  search?.addEventListener("input", apply);
  ancestry?.addEventListener("change", apply);
  for (const s of selects) s.addEventListener("change", apply);
  apply();
}

/**
 * Show the gallery and resolve to the chosen image path, or null if the player
 * cancelled / closed the dialog / the folder yielded nothing.
 *
 * Opens filtered to the build's own ancestry when the art supports it — a
 * dwarf's player wants the 75 dwarves, not all 1,952 pictures — and the
 * ancestry control drops back to "Any" in one click.
 *
 * @param {string|null} current  Currently-selected path, highlighted in the grid.
 * @param {{slot?: "portrait"|"token", ancestry?: string|null}} [options]
 */
export async function pickGalleryArt(current = null, { slot = "portrait", ancestry = null } = {}) {
  const entries = await galleryEntries(slot);
  if (!entries.length) {
    ui.notifications.warn(game.i18n.format("SDE.charBuilder.art.galleryEmpty", { folder: galleryFolderLabel() }));
    return null;
  }

  const esc = foundry.utils.escapeHTML;
  const L = (k) => game.i18n.localize(k);
  const facets = galleryFacets(entries);
  const ancestries = ancestryOptions(entries);
  // Only preselect an ancestry that has art; otherwise the gallery would open
  // on an empty grid and read as broken.
  const preselect = ancestries.find((o) => o.key === ancestryKey(ancestry))?.key ?? "";

  const items = entries.map((e) => {
    // Padded on both sides so a facet match is a whole-token test: "elf" must
    // not match "half-elf".
    const tags = ` ${Object.entries(e.tags)
      .flatMap(([g, vs]) => vs.map((v) => `${g}:${v}`)).join(" ")} `;
    const search = [e.label, e.source, ...Object.values(e.tags).flat()].join(" ").toLowerCase();
    return `
    <button type="button" class="sde-cb-gallery-item${e.src === current ? " active" : ""}"
      data-action="gallery-pick" data-src="${esc(e.src)}"
      data-search="${esc(search)}" data-tags="${esc(tags)}"
      title="${esc(e.source ? `${e.label} — ${e.source}` : e.label)}">
      <img src="${esc(e.thumb)}" alt="" loading="lazy"><span>${esc(e.label)}</span>
    </button>`;
  }).join("");

  const selects = facets.map(([group, values]) => `
    <select data-facet="${esc(group)}" aria-label="${esc(group)}">
      <option value="">${esc(game.i18n.format("SDE.charBuilder.art.galleryAnyFacet", { facet: group }))}</option>
      ${values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}
    </select>`).join("");

  const ancestrySelect = ancestries.length ? `
    <select class="sde-cb-gallery-ancestry" aria-label="${esc(L("SDE.charBuilder.step.ancestry"))}">
      <option value="" data-tags="">${esc(L("SDE.charBuilder.art.galleryAnyAncestry"))}</option>
      ${ancestries.map((o) => `
        <option value="${esc(o.key)}" data-tags="${esc(o.tags.join(" "))}"${o.key === preselect ? " selected" : ""}
          >${esc(o.label)} (${o.count})</option>`).join("")}
    </select>` : "";

  const content = `
    <div class="sde-cb-gallery-bar">
      <input type="search" class="sde-cb-gallery-search" placeholder="${esc(L("SDE.charBuilder.art.gallerySearch"))}">
      ${ancestrySelect}
      ${selects}
      <span class="sde-cb-gallery-count"></span>
    </div>
    <div class="sde-cb-gallery">${items}</div>`;

  return new Promise((resolve) => {
    const dlg = new foundry.applications.api.DialogV2({
      window: { title: L("SDE.charBuilder.art.galleryTitle"), icon: "fa-solid fa-images" },
      classes: ["shadowdark", "sde-cb-gallery-dialog"],
      position: { width: 720, height: 620 },
      content,
      buttons: [{ action: "cancel", label: L("SDE.charBuilder.art.galleryCancel"), icon: "fa-solid fa-xmark" }],
      actions: {
        "gallery-pick": (_event, target) => {
          resolve(target.dataset.src);
          dlg.close();
        },
      },
      submit: () => {},
    });
    // Closing by the window X (or the Cancel button) must still settle the promise.
    // The pick above resolves first; a Promise ignores the later resolve(null).
    const close = dlg.close.bind(dlg);
    dlg.close = async (options) => { resolve(null); return close(options); };
    dlg.render({ force: true }).then((app) => {
      const root = app?.element;
      if (!root) return;
      const count = root.querySelector(".sde-cb-gallery-count");
      installGalleryFilter(root, (shown, total) => {
        if (count) count.textContent = game.i18n.format("SDE.charBuilder.art.galleryCount", { shown, total });
      });
    });
  });
}
