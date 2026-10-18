/**
 * Stage places: the GM's window for their own backdrops (add, rename, show, replace the picture, delete).
 * The list and its edits are places-core.mjs / places.mjs; this file is the window only.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { L } from "../shared/i18n.mjs";
import { esc } from "../shared/esc.mjs";
import { fileRoute } from "../shared/file-route.mjs";
import { MAX_PLACES, PLACE_KINDS } from "./places-core.mjs";
import { addPlaceToList, readPlaces, removePlaceAndHide, setPlacesWindow, showPlace, updatePlaceInList, uploadPlacePicture } from "./places.mjs";
import { normalizeStage } from "./stage-core.mjs";
import { hideStage } from "./stage.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const KIND_KEYS = {
  town: "SDE.stage.places.kindTown",
  tavern: "SDE.stage.places.kindTavern",
  camp: "SDE.stage.places.kindCamp",
  custom: "SDE.stage.places.kindCustom",
};
const kindLabel = (kind) => KIND_KEYS[kind];
const warn = (key, data) => ui.notifications?.warn(L(key, data));
/** A rejected write must not vanish as an unhandled rejection: log it and tell the GM. */
const safely = async (fn) => {
  try { return await fn(); } catch (err) {
    console.error(`${MODULE_ID} | stage: places write failed`, err);
    warn("SDE.stage.places.saveFailed");
    return null;
  }
};

export class StagePlacesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-stage-places",
    classes: ["sde-ui", "sde-stage-places"],
    window: { title: "SDE.stage.places.title", icon: "fa-solid fa-images", resizable: true },
    position: { width: 560, height: 680 },
    actions: {
      showPlace: StagePlacesApp.prototype._onShow,
      hidePlace: StagePlacesApp.prototype._onHide,
      replacePicture: StagePlacesApp.prototype._onReplace,
      deletePlace: StagePlacesApp.prototype._onDelete,
      addPlace: StagePlacesApp.prototype._onAdd,
    },
  };

  // Two parts so a list redraw (a setting change) never wipes the Add form the GM is filling in.
  static PARTS = {
    add: { template: `modules/${MODULE_ID}/templates/stage/places-add.hbs` },
    list: { template: `modules/${MODULE_ID}/templates/stage/places-list.hbs`, scrollable: [".ui-body"] },
  };

  static _current = null;

  /** GM only. An open window is redrawn and raised rather than opened twice. */
  static async open() {
    if (!game.user?.isGM) return null;
    const app = (StagePlacesApp._current ??= new StagePlacesApp());
    setPlacesWindow(app);
    // Awaited: bringToFront needs the window element, which a first render creates asynchronously.
    await app.render(app.rendered ? { parts: ["list"] } : { force: true });
    if (app.element) app.bringToFront?.();
    return app;
  }

  _busy = false;

  async close(options = {}) {
    if (StagePlacesApp._current === this) StagePlacesApp._current = null;
    setPlacesWindow(null);
    return super.close(options);
  }

  _prepareContext() {
    const stage = normalizeStage(game.settings.get(MODULE_ID, "stage"));
    const kinds = PLACE_KINDS.map((value) => ({ value, label: kindLabel(value) }));
    const places = readPlaces().places.map((p) => ({
      ...p,
      image: fileRoute(p.image),
      shown: stage.shown && stage.place === p.id,
      kinds: kinds.map((k) => ({ ...k, selected: k.value === p.kind })),
    }));
    return { places, kinds, busy: this._busy };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // Only the part that was replaced has fresh elements; binding a kept part again would double every handler.
    if (options?.parts && !options.parts.includes("list")) return;
    for (const el of this.element.querySelectorAll("[data-place-field]")) el.addEventListener("change", () => this._onField(el));
    for (const el of this.element.querySelectorAll("[data-replace-file]")) el.addEventListener("change", () => this._onReplaceFile(el));
  }

  _setBusy(on) {
    this._busy = on;
    const add = this.element?.querySelector?.("[data-action=addPlace]");
    if (add) add.disabled = on;
    const note = this.element?.querySelector?.("[data-busy-note]");
    if (note) note.hidden = !on;
  }

  /** A name or kind edit. An empty name keeps the old one. */
  _onField(el) { return safely(() => this._saveField(el)); }

  async _saveField(el) {
    const id = el.dataset.placeId;
    if (el.dataset.placeField === "kind") return updatePlaceInList(id, { kind: el.value });
    const name = el.value.trim();
    if (!name) { el.value = el.defaultValue; return null; }
    return updatePlaceInList(id, { name });
  }

  _onShow(event, target) { return safely(() => showPlace(target.dataset.placeId)); }

  _onHide() { return safely(() => hideStage()); }

  _onReplace(event, target) {
    const id = target.dataset.placeId;
    for (const el of this.element.querySelectorAll("[data-replace-file]")) if (el.dataset.replaceFile === id) el.click();
  }

  _onReplaceFile(el) { return safely(() => this._replaceFile(el)); }

  async _replaceFile(el) {
    const file = el.files?.[0];
    const id = el.dataset.replaceFile;
    if (!file) return;
    const name = readPlaces().places.find((p) => p.id === id)?.name ?? "";
    const image = await uploadPlacePicture(file, name);
    el.value = "";
    if (image) await updatePlaceInList(id, { image });
  }

  _onDelete(event, target) { return safely(() => this._deletePlace(target)); }

  async _deletePlace(target) {
    const id = target.dataset.placeId;
    const place = readPlaces().places.find((p) => p.id === id);
    if (!place) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      classes: ["sde-ui", "sde-dialog"],
      window: { title: "SDE.stage.places.confirmTitle" },
      content: `<p>${esc(L("SDE.stage.places.confirmBody", { name: place.name }))}</p>`,
      yes: { label: L("SDE.stage.places.confirmYes") },
      rejectClose: false,
    });
    if (ok) await removePlaceAndHide(id);
  }

  _onAdd() { return safely(() => this._addPlace()); }

  async _addPlace() {
    if (this._busy) return;
    const root = this.element;
    if (readPlaces().places.length >= MAX_PLACES) return warn("SDE.stage.places.capReached", { max: MAX_PLACES });
    const fileEl = root.querySelector("[data-add-file]");
    const file = fileEl?.files?.[0];
    if (!file) return warn("SDE.stage.places.noPicture");
    const nameEl = root.querySelector("[data-add-name]");
    const kindEl = root.querySelector("[data-add-kind]");
    const kind = PLACE_KINDS.includes(kindEl?.value) ? kindEl.value : "custom";
    const name = nameEl.value.trim() || L(kindLabel(kind));
    this._setBusy(true);
    try {
      const image = await uploadPlacePicture(file, name);
      if (!image) return;
      await addPlaceToList({ id: foundry.utils.randomID(), kind, name, image });
      nameEl.value = "";
      fileEl.value = "";
    } finally {
      this._setBusy(false);
    }
  }
}
