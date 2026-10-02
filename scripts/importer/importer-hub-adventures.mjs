/**
 * Importer Hub — Tools → Adventures and Adventure map.
 *
 * Adventures: read every numbered-location adventure of a Cursed Scroll (or all
 * six) out of the GM's own PDF and file one journal entry per adventure, a page
 * per location (adventure/adventure-book-import.mjs).
 *
 * Adventure map: build the Scene for a filed adventure from the GM's own map
 * image and open the placer, which drops a numbered Note for each location with
 * one click apiece (adventure/adventure-placer.mjs). Pins and skips live on the
 * scene, so the same button picks a half-placed map up again.
 *
 * Installed onto ImporterHubApp.prototype by installHubAdventures(cls); `this`
 * is the live hub.
 */

import { installMethods, t } from "./importer-hub-shared.mjs";
import { CHAR_SOURCES } from "./char-content/char-content-manifest.mjs";
import { resolveSourcePdf } from "./source-pdf-registry.mjs";
import { adventureBooks, allSites, findSite } from "./adventure/adventure-manifest.mjs";
import { hasKnownPositions } from "./adventure/adventure-layouts.mjs";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const ALL = "*";

class HubAdventureMethods {

  /** Tools → Adventures: file a book's adventures as journals. */
  async _onAdventures() {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.gm.adventure")); return; }
    const { importAdventures } = await import("./adventure/adventure-book-import.mjs");
    const books = adventureBooks();
    const options = [`<option value="${ALL}">${esc(t("SDE.importer.adventure.allBooks"))}</option>`,
      ...books.map((src) => `<option value="${src}">${esc(CHAR_SOURCES[src]?.label ?? src)}</option>`)].join("");
    const picked = await foundry.applications.api.DialogV2.wait({
      window: { title: t("SDE.importer.adventure.title"), icon: "fas fa-dungeon" },
      content: `
        <p>${t("SDE.importer.adventure.lead")}</p>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:0.4rem 0.6rem;align-items:center;">
          <label for="sde-adv-src"><strong>${t("SDE.importer.downtime.book")}</strong></label>
          <select id="sde-adv-src" name="src">${options}</select>
        </div>
        <p class="notes">${t("SDE.importer.adventure.notes")}</p>`,
      buttons: [
        { action: "import", label: t("SDE.importer.adventure.import"), icon: "fas fa-book-open", default: true,
          callback: (event, button) => button.form.elements.src.value },
        { action: "cancel", label: t("SDE.importer.btn.cancel"), icon: "fas fa-xmark" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (!picked || picked === "cancel") return;

    const wanted = picked === ALL ? books : [picked];
    const linked = wanted.filter((src) => resolveSourcePdf(src));
    if (!linked.length) { ui.notifications.warn(t("SDE.importer.pdf.bookNotLinked")); return; }
    const unlinked = wanted.length - linked.length;

    // The run is one long await; a permanent notification is its progress bar.
    const note = ui.notifications.info(t("SDE.importer.adventure.working"), { permanent: true, progress: true, console: false });
    const reports = [];
    try {
      for (const src of linked) {
        reports.push(await importAdventures(src, {
          onSite: (title, i, n) => note?.update?.({ message: t("SDE.importer.adventure.progress", { title, i, n }), pct: (i - 1) / n }),
        }));
      }
    } finally {
      note?.remove?.();
    }
    const sites = reports.flatMap((r) => r.sites);
    ui.notifications.info(t("SDE.importer.adventure.done", {
      locations: sites.reduce((n, s) => n + s.locations, 0), sites: sites.length,
    }));
    if (unlinked) ui.notifications.warn(t("SDE.importer.adventure.unlinked", { n: unlinked }));
    const short = sites.filter((s) => s.missing.length);
    if (short.length) {
      ui.notifications.warn(t("SDE.importer.adventure.missing", { n: short.length, first: short[0].title, what: short[0].missing.join(", ") }));
    }
    const failed = reports.flatMap((r) => r.failed);
    if (failed.length) ui.notifications.warn(t("SDE.importer.adventure.failed", { n: failed.length, first: failed[0].title }));
  }

  /**
   * Tools → Adventure map: pick the map image that came with the book and the rest
   * is done. The adventure is recognised from the file's name (or chosen), its
   * journal is imported from the linked PDF when it has not been yet, the scene is
   * built from the image, and every location whose position is known is pinned.
   * Whatever is left, and any adventure whose positions are not known yet, is
   * placed by clicking in the placer window. An adventure that already has a scene
   * is picked up where it was left.
   */
  async _onAdventureMap() {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.adventure.notify.gmOnly")); return; }
    const { filedSiteIds, findSiteScene, buildSiteScene } = await import("./adventure/adventure-scene.mjs");
    const { AdventurePlacer } = await import("./adventure/adventure-placer.mjs");
    const { siteForImage } = await import("./adventure/map-detect.mjs");
    const filed = await filedSiteIds();
    const sites = allSites();

    const groups = adventureBooks().map((src) => {
      const rows = sites.filter((s) => s.src === src).map((s) => {
        const note = findSiteScene(s.id) ? t("SDE.adventure.map.hasScene") : (filed.has(s.id) ? "" : t("SDE.adventure.map.notImported"));
        return `<option value="${s.id}">${esc(s.title)}${note ? ` (${esc(note)})` : ""}</option>`;
      }).join("");
      return `<optgroup label="${esc(CHAR_SOURCES[src]?.label ?? src)}">${rows}</optgroup>`;
    }).join("");
    const answer = await foundry.applications.api.DialogV2.wait({
      window: { title: t("SDE.adventure.map.title"), icon: "fas fa-map-location-dot" },
      content: `
        <p>${t("SDE.adventure.map.lead")}</p>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:0.4rem 0.6rem;align-items:center;">
          <label for="sde-advmap-img"><strong>${t("SDE.adventure.map.image")}</strong></label>
          <span style="display:flex;gap:0.3rem;"><input id="sde-advmap-img" name="img" type="text" style="flex:1;" placeholder="${esc(t("SDE.adventure.map.imageHint"))}">
            <button type="button" data-advmap-browse title="${esc(t("SDE.adventure.map.browse"))}"><i class="fas fa-file-image"></i></button></span>
          <label for="sde-advmap-site"><strong>${t("SDE.adventure.map.site")}</strong></label>
          <select id="sde-advmap-site" name="site"><option value="">${esc(t("SDE.adventure.map.choose"))}</option>${groups}</select>
        </div>
        <p class="notes" data-advmap-detected>${t("SDE.adventure.map.notes")}</p>`,
      render: (event, dialog) => {
        const root = dialog.element;
        const img = root.querySelector("#sde-advmap-img"), pick = root.querySelector("#sde-advmap-site"), note = root.querySelector("[data-advmap-detected]");
        // The file's name says which adventure it is; say so, and select it.
        const detect = () => {
          const site = siteForImage(img.value, sites);
          if (site) { pick.value = site.id; note.textContent = t("SDE.adventure.map.recognized", { title: site.title }); }
          else if (img.value.trim()) note.textContent = t("SDE.adventure.map.notRecognized");
        };
        img.addEventListener("input", detect);
        img.addEventListener("change", detect);
        root.querySelector("[data-advmap-browse]")?.addEventListener("click", () => {
          new foundry.applications.apps.FilePicker.implementation({
            type: "image",
            callback: (path) => { img.value = path; detect(); },
          }).render(true);
        });
      },
      buttons: [
        { action: "build", label: t("SDE.adventure.map.build"), icon: "fas fa-map", default: true,
          callback: (event, button) => Object.fromEntries(new FormData(button.form)) },
        { action: "cancel", label: t("SDE.importer.btn.cancel"), icon: "fas fa-xmark" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (!answer || answer === "cancel") return;

    const src = String(answer.img ?? "").trim();
    const site = findSite(answer.site) ?? siteForImage(src, sites);
    if (!site) { ui.notifications.warn(t("SDE.adventure.map.needSite")); return; }
    let scene = findSiteScene(site.id);
    if (scene) {
      ui.notifications.info(t("SDE.adventure.map.alreadyBuilt", { title: site.title }));
    } else {
      if (!src) { ui.notifications.warn(t("SDE.adventure.map.needImage")); return; }
      // Not imported yet: read the journal out of the book first, so this is one step.
      if (!(await filedSiteIds()).has(site.id)) {
        const { importAdventures } = await import("./adventure/adventure-book-import.mjs");
        const note = ui.notifications.info(t("SDE.adventure.map.importing", { title: site.title }), { permanent: true, console: false });
        try { await importAdventures(site.src, { ids: [site.id] }); } finally { note?.remove?.(); }
      }
      const built = await buildSiteScene(site, src);
      if (!built) return;
      scene = built.scene;
      if (built.skewed) ui.notifications.warn(t("SDE.adventure.notify.skewed", { title: site.title }));
    }
    const placer = await AdventurePlacer.open(scene);
    // Positions saved with the module (or printed as text in the book) place the
    // pins with no clicking; the rest is the GM's to click.
    if (hasKnownPositions(site)) await placer?.placeFromBook();
    placer?._onNext();
  }
}

/** Install the Adventures tools onto the hub class. */
export function installHubAdventures(cls) {
  installMethods(cls, HubAdventureMethods);
}
