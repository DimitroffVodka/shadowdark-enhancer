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
import { installHoverPeek } from "../shared/hover-peek.mjs";

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
 * @property {string} portrait  this artwork's portrait image
 * @property {string} token     this artwork's token image
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
      // Each slot falls back to the other, so a row that ships only one image
      // still fills both rather than dropping out of the gallery.
      const portrait = art.portrait ?? art.token;
      const token = art.token ?? art.portrait;
      const src = slot === "token" ? token : portrait;
      if (!src) continue;
      const tags = {};
      for (const [group, values] of Object.entries(row?.tags ?? {})) {
        const list = (Array.isArray(values) ? values : [values]).map((v) => String(v).trim()).filter(Boolean);
        if (list.length) tags[group] = list;
      }
      out.push({
        src: String(src),
        portrait: String(portrait),
        token: String(token),
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
    // A loose file is the only image it has, so it serves as both slots.
    entries.push({
      src: file, portrait: file, token: file, thumb: file,
      label: fileLabel(file), source: "", tags: {}, art: [file],
    });
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
 *
 * TAG ORDER IS LOAD-BEARING: the first tag is the exact one, and the filter
 * promotes it to the front of the grid. Half-Elf shows all 107, but the 30
 * portraits actually drawn as half-elves come first.
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

/**
 * Wire the sidebar to show/hide tiles. Pure DOM, no re-render.
 *
 * Chips are multi-select, and the two levels combine the way a facet browser is
 * expected to: ANY within a group (humanoid OR beast), ALL across groups
 * (humanoid AND sword). One delegated listener on the sidebar rather than one
 * per chip.
 */
function installGalleryFilter(root, onCount) {
  const side = root.querySelector(".sde-cb-gallery-side");
  const grid = root.querySelector(".sde-cb-gallery");
  const search = root.querySelector(".sde-cb-gallery-search");
  const chips = [...side.querySelectorAll(".sde-cb-chip")];
  const tiles = [...grid.querySelectorAll(".sde-cb-gallery-item")];

  const apply = () => {
    const needle = (search?.value ?? "").trim().toLowerCase();
    // group → the union of every active chip's tags in that group.
    const active = new Map();
    for (const chip of chips) {
      if (!chip.classList.contains("active")) continue;
      const group = chip.dataset.group;
      const tags = active.get(group) ?? [];
      tags.push(...chip.dataset.tags.split(" ").filter(Boolean));
      active.set(group, tags);
    }
    // A derived ancestry lists its EXACT matches first: a half-elf's 32 aiuvarin
    // portraits ahead of the 75 general elf ones it also borrows. ANCESTRY_TAGS
    // puts the specific tag first, so that is the one to promote — but only when
    // exactly one ancestry is picked, since two selections have no single
    // "exact". Done with CSS `order` rather than by moving nodes: same-order
    // items keep document order, so each group stays alphabetical.
    const picked = chips.filter((c) => c.classList.contains("active") && c.dataset.group === "ancestry");
    const primary = picked.length === 1 && picked[0].dataset.tags.includes(" ")
      ? picked[0].dataset.tags.split(" ")[0] : null;

    let shown = 0;
    for (const tile of tiles) {
      let hit = !needle || tile.dataset.search.includes(needle);
      if (hit) {
        for (const [group, tags] of active) {
          if (!tags.some((t) => tile.dataset.tags.includes(` ${group}:${t} `))) { hit = false; break; }
        }
      }
      tile.hidden = !hit;
      if (hit) shown++;
      const order = primary && tile.dataset.tags.includes(` ancestry:${primary} `) ? "-1" : "";
      if (tile.style.order !== order) tile.style.order = order;
    }
    onCount(shown, tiles.length);
  };

  search?.addEventListener("input", apply);
  side.addEventListener("click", (event) => {
    const chip = event.target.closest?.(".sde-cb-chip");
    if (chip) {
      chip.classList.toggle("active");
      chip.setAttribute("aria-pressed", chip.classList.contains("active") ? "true" : "false");
      apply();
      return;
    }
    if (event.target.closest?.(".sde-cb-gallery-reset")) {
      for (const c of chips) { c.classList.remove("active"); c.setAttribute("aria-pressed", "false"); }
      if (search) search.value = "";
      apply();
    }
  });
  apply();
}

/**
 * Show the gallery and resolve to the chosen artwork, or null if the player
 * cancelled / closed the dialog / the folder yielded nothing.
 *
 * Resolves the whole matched PAIR — `{src, portrait, token}` — not just the one
 * image the slot asked for, so the caller can dress both slots from one pick.
 * A loose folder file has no pair, so it reports itself as both.
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
      data-portrait="${esc(e.portrait)}" data-token="${esc(e.token)}"
      data-search="${esc(search)}" data-tags="${esc(tags)}"
      title="${esc(e.source ? `${e.label} — ${e.source}` : e.label)}">
      <img src="${esc(e.thumb)}" alt="" loading="lazy"><span>${esc(e.label)}</span>
    </button>`;
  }).join("");

  // The label sits in a <span>. Something in this dialog's cascade owns the font
  // of every <button> — a bare `<button>` here renders in the Old Newspaper
  // flavor serif while an identical `<div>` takes the rule's Montserrat, and it
  // survives `!important`, so it is not an author declaration we can out-rank.
  // Styling a child element steps around it without giving up button semantics,
  // which is the same shape the gallery tiles already use for their captions.
  const chip = (group, tags, label, on = false) =>
    `<button type="button" class="sde-cb-chip${on ? " active" : ""}" aria-pressed="${on}"
      data-group="${esc(group)}" data-tags="${esc(tags.join(" "))}"><span>${esc(label)}</span></button>`;

  // `<details>` gives collapsible groups with no JS and no state to track —
  // the browser owns open/closed. Ancestry leads and stays open; the long
  // third-party groups start collapsed so the sidebar opens readable.
  const group = (name, label, body, open) => `
    <details class="sde-cb-gallery-group" data-group="${esc(name)}"${open ? " open" : ""}>
      <summary>${esc(label)}</summary>
      <div class="sde-cb-chips">${body}</div>
    </details>`;

  const ancestryGroup = ancestries.length ? group("ancestry", L("SDE.charBuilder.step.ancestry"),
    ancestries.map((o) => chip("ancestry", o.tags, `${o.label} (${o.count})`, o.key === preselect)).join(""),
    true) : "";

  const facetGroups = facets.map(([name, values]) => group(
    name,
    name.replace(/^./, (c) => c.toUpperCase()),
    values.map((v) => chip(name, [v], v)).join(""),
    false,
  )).join("");

  const content = `
    <div class="sde-cb-gallery-layout">
      <aside class="sde-cb-gallery-side">
        <div class="sde-cb-gallery-side-top">
          <input type="search" class="sde-cb-gallery-search" placeholder="${esc(L("SDE.charBuilder.art.gallerySearch"))}">
          <p class="sde-cb-gallery-count"></p>
          <button type="button" class="sde-cb-gallery-reset">
            <i class="fa-solid fa-arrow-rotate-left"></i><span>${esc(L("SDE.charBuilder.art.galleryReset"))}</span>
          </button>
        </div>
        <div class="sde-cb-gallery-side-scroll">${ancestryGroup}${facetGroups}</div>
      </aside>
      <div class="sde-cb-gallery">${items}</div>
    </div>`;

  return new Promise((resolve) => {
    const dlg = new foundry.applications.api.DialogV2({
      // Resizable: 1,900 tiles at 92px is a lot of scrolling in a fixed 620px
      // box, and how much of a wall of art fits on screen is the user's call.
      window: { title: L("SDE.charBuilder.art.galleryTitle"), icon: "fa-solid fa-images", resizable: true },
      classes: ["shadowdark", "sde-cb-gallery-dialog"],
      // Wider than the old top-bar layout: the sidebar takes a fixed 200px and
      // the grid needs its five columns back.
      position: { width: 920, height: 660 },
      content,
      buttons: [{ action: "cancel", label: L("SDE.charBuilder.art.galleryCancel"), icon: "fa-solid fa-xmark" }],
      actions: {
        "gallery-pick": (_event, target) => {
          resolve({
            src: target.dataset.src,
            portrait: target.dataset.portrait,
            token: target.dataset.token,
          });
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
      installHoverPeek(root, {
        grid: ".sde-cb-gallery",
        item: ".sde-cb-gallery-item",
        src: (tile) => tile.dataset.src,
      });
    });
  });
}
