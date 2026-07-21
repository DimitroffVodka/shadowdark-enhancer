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
  return raw.split(/[,\n;]/).map((f) => f.trim().replace(/\/+$/, "")).filter(Boolean);
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
 * Show the gallery and resolve to the chosen image path, or null if the player
 * cancelled / closed the dialog / the folder yielded nothing.
 *
 * @param {string|null} current  Currently-selected path, highlighted in the grid.
 */
export async function pickGalleryArt(current = null) {
  const files = await listGalleryArt();
  if (!files.length) {
    ui.notifications.warn(game.i18n.format("SDE.charBuilder.art.galleryEmpty", { folder: galleryFolderLabel() }));
    return null;
  }

  const esc = foundry.utils.escapeHTML;
  const label = (p) => esc(p.split("/").pop().replace(/\.\w+$/, "").replace(/[_-]+/g, " "));
  const items = files.map((f) => `
    <button type="button" class="sde-cb-gallery-item${f === current ? " active" : ""}"
      data-action="gallery-pick" data-src="${esc(f)}" title="${esc(f)}">
      <img src="${esc(f)}" alt=""><span>${label(f)}</span>
    </button>`).join("");

  return new Promise((resolve) => {
    const dlg = new foundry.applications.api.DialogV2({
      window: { title: game.i18n.localize("SDE.charBuilder.art.galleryTitle"), icon: "fa-solid fa-images" },
      classes: ["shadowdark", "sde-cb-gallery-dialog"],
      position: { width: 620, height: 520 },
      content: `<div class="sde-cb-gallery">${items}</div>`,
      buttons: [{ action: "cancel", label: game.i18n.localize("SDE.charBuilder.art.galleryCancel"), icon: "fa-solid fa-xmark" }],
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
    dlg.render({ force: true });
  });
}
