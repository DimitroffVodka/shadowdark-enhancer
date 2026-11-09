/**
 * Shadowdark Enhancer — Importer Hub tools (Foundry-bound).
 *
 * The Tools-menu handlers extracted from ImporterHubApp (review 2026-07-11
 * maintainability). Each function takes the hub `app` instance and touches it
 * only to re-render; heavy lifting stays in the dedicated modules they
 * dynamic-import (bundle-io, source-pdf-registry).
 *
 * The old Maintenance-strip actions are gone (2026-07-14, user direction —
 * automatic over repair buttons): table re-link now fires from the import
 * primitives (table-enrich.scheduleRelinkSweep), the monster backfill runs
 * automatically on module update (shadowdark-enhancer.mjs ready hook), and
 * the pre-suite legacy migrations (world tables / "Loot" pack / world actors)
 * were retired outright — git history has them if an old world ever needs one.
 *
 * All GM-gated.
 */

import { CHAR_SOURCES } from "./char-content/char-content-manifest.mjs";
import { t } from "./importer-hub-shared.mjs";

/** Export the entire suite as one JSON bundle download (REQ-25, A-04). */
export async function exportSuiteBundle(_app) {
  if (!game.user?.isGM) return;
  const { exportBundle } = await import("./bundle-io.mjs");
  let bundle;
  try {
    bundle = await exportBundle();
  } catch (err) {
    console.error("shadowdark-enhancer | bundle export: unexpected error:", err);
    ui.notifications?.error(t("SDE.importer.bundle.exportFailed"));
    return;
  }
  if (!bundle) return;
  const s = bundle.stats;
  const parts = Object.entries(s)
    .filter(([, v]) => v && typeof v === "object" && v.docs)
    .map(([k, v]) => `${k} ${v.docs}`);
  const warn = bundle.warnings.length ? t("SDE.importer.bundle.unresolved", { n: bundle.warnings.length }) : "";
  if (bundle.warnings.length) console.warn("shadowdark-enhancer | bundle warnings:", bundle.warnings);
  ui.notifications?.info(t("SDE.importer.bundle.exported", { parts: parts.join(" · "), warn }));
}

/**
 * Import a bundle file: pick file → validate → per-pack summary confirm →
 * applyBundle (keepId, skip-existing, never overwrites) → report (REQ-25).
 */
export async function importSuiteBundle(app) {
  if (!game.user?.isGM) return;
  const { validateBundle, applyBundle } = await import("./bundle-io.mjs");

  // File picker dialog.
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["sde-ui", "sde-dialog"],
    window: { title: t("SDE.importer.bundle.title") },
    content: `<p>${t("SDE.importer.bundle.pick")}</p>
      <input type="file" name="bundle-file" accept=".json,application/json">`,
    buttons: [
      {
        action: "load", label: t("SDE.importer.btn.load"), default: true,
        callback: (ev, button, dialog) => {
          const el = (dialog.element ?? dialog)?.querySelector?.("input[name='bundle-file']");
          return el?.files?.[0] ?? null;
        },
      },
      { action: "cancel", label: t("SDE.importer.btn.cancel") },
    ],
    rejectClose: false,
  }).catch(() => null);
  if (!picked || picked === "cancel") return;

  let bundle;
  try {
    bundle = JSON.parse(await picked.text());
  } catch {
    ui.notifications?.error(t("SDE.importer.bundle.badJson"));
    return;
  }
  const check = validateBundle(bundle);
  if (!check.ok) {
    ui.notifications?.error(t("SDE.importer.bundle.invalid", { errors: check.errors.join("; ") }));
    return;
  }

  // Per-pack summary confirm before touching anything.
  const rows = Object.entries(bundle.packs)
    .map(([k, p]) => `<li>${t("SDE.importer.bundle.packRow", { pack: foundry.utils.escapeHTML(k), docs: p.docs.length, folders: p.folders.length })}</li>`)
    .join("");
  const choice = await foundry.applications.api.DialogV2.wait({
    classes: ["sde-ui", "sde-dialog"],
    window: { title: t("SDE.importer.bundle.title") },
    content: `<p>${t("SDE.importer.bundle.from", {
      world: foundry.utils.escapeHTML(bundle.world ?? "?"),
      version: foundry.utils.escapeHTML(bundle.moduleVersion ?? "?"),
      exported: foundry.utils.escapeHTML((bundle.exported ?? "").slice(0, 10)),
    })}</p>
      <ul>${rows}</ul>
      <p>${t("SDE.importer.bundle.skipNote")}</p>`,
    buttons: [
      { action: "import", label: t("SDE.importer.btn.import"), default: true },
      { action: "cancel", label: t("SDE.importer.btn.cancel") },
    ],
    rejectClose: false,
  }).catch(() => "cancel");
  if (!choice || choice === "cancel") return;

  let report;
  try {
    report = await applyBundle(bundle);
  } catch (err) {
    console.error("shadowdark-enhancer | bundle import: unexpected error:", err);
    ui.notifications?.error(t("SDE.importer.bundle.importFailed"));
    return;
  }
  if (!report) return;
  if (!report.ok) {
    ui.notifications?.error(t("SDE.importer.bundle.rejected", { errors: report.errors.join("; ") }));
    return;
  }
  const summary = [
    t("SDE.importer.bundle.created", { n: report.created }),
    t("SDE.importer.bundle.skipped", { n: report.skippedExisting }),
    report.failures ? t("SDE.importer.bundle.failures", { n: report.failures }) : "",
  ].filter(Boolean).join(" · ");
  ui.notifications?.info(t("SDE.importer.bundle.importDone", { summary }));
  app.render();
}

/** Pages per extractPdfText call when reading a whole book, so the progress bar moves. */
const READ_CHUNK = 10;

/**
 * Read every page of a book the importer has no recipe for (a third-party
 * adventure, homebrew) and show what it holds on the Preview tab. The parse is
 * the paste box's own Auto pass, so nothing is saved until the GM confirms
 * there, and the text is left in the box for a second try. Pages are joined
 * with a form feed, which is how that pass knows where each one ends.
 *
 * @param {object} app    the hub
 * @param {string} file   resolved PDF path
 * @param {string} label  the book's name: the Source the drafts are filed under
 * @param {object} [pdf]  pdf-text-extract.mjs (injected by the Node test)
 * @returns {Promise<boolean>} whether the Preview tab has something to show
 */
export async function readWholeBook(app, file, label, pdf) {
  pdf ??= await import("./pdf-text-extract.mjs");
  const pageTexts = [];   // every page, empty ones too, so an index is a page number
  const warnings = [];
  // Opening is the long part of a big book: the whole file comes down before page 1 can be read.
  const note = ui.notifications?.info(t("SDE.importer.srcpdf.opening", { book: label }), { permanent: true, progress: true, console: false });
  try {
    let numPages = 1;
    for (let from = 1; from <= numPages; from += READ_CHUNK) {
      const pages = Array.from({ length: READ_CHUNK }, (_, i) => from + i);   // past the last page is dropped by the extractor
      const r = await pdf.extractPdfText(file, { pages, columns: "auto" });
      numPages = r.numPages;
      pageTexts.push(...r.pages.map((p) => p.lines.join("\n")));
      warnings.push(...(r.warnings ?? []));
      const page = Math.min(from + READ_CHUNK - 1, numPages);
      note?.update?.({ message: t("SDE.importer.srcpdf.reading", { book: label, page, pages: numPages }), pct: page / numPages });
    }
  } catch (err) {
    console.error("Shadowdark Enhancer | PDF text extraction failed", err);
    ui.notifications?.error(t("SDE.importer.pdf.readFailed", { error: err?.message || err }));
    return false;
  } finally {
    note?.remove?.();
  }
  const text = pageTexts.join("\n\f\n");
  if (!pageTexts.some(Boolean)) { ui.notifications?.warn(t("SDE.importer.srcpdf.noText", { book: label })); return false; }

  app._importSeed = null;
  app._importType = "auto";
  app._importItemSubtype = "auto";
  app._importSource = label;
  app._importText = text;
  // _onHubParse reads the paste box back, so an open box must hold the book too.
  const box = app.element?.querySelector?.("textarea[data-import-text]");
  if (box) box.value = text;
  await app._onHubParseAndShow();
  pdf.notifyGutterWarnings({ warnings });
  return app._hasPreview();
}

/**
 * A book's name from its file name: no folder or extension, no trailing version
 * ("_1.2", " V1-2", "-v4-3"), no leading download id, and underscores (plus the
 * hyphens of a name with no spaces) as spaces. A guess the GM can type over.
 */
export function bookNameFromFile(fileName) {
  let s = String(fileName ?? "").split("/").pop();
  try { s = decodeURIComponent(s); } catch (_e) { /* a literal % in the name */ }
  s = s.replace(/\.pdf$/i, "")
    .replace(/[\s_-]+(?:v\d+(?:[.-]\d+)*[a-z]?|\d+(?:[.-]\d+)+[a-z]?)$/i, "")   // "Issue 1" stays: a bare number is part of the title
    .replace(/_/g, " ");
  if (!/\s/.test(s)) s = s.replace(/-/g, " ");
  return s.replace(/^\d{6,}\s+/, "").replace(/\s+/g, " ").trim();
}

/**
 * The one-step way in for a book that isn't a Shadowdark book: choose the PDF,
 * from this computer or already on the server, and it is linked under its own
 * name, the file's unless the GM types another.
 * @returns {Promise<{path:string, label:string}|null>} null when nothing was chosen
 */
export async function pickThirdPartyBook() {
  if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.notify.gmOnlyPdfs")); return null; }
  const read = (dialog) => {
    const root = dialog.element ?? dialog;
    return { file: root.querySelector("input[name='pdf']")?.files?.[0] ?? null, label: root.querySelector("input[name='label']")?.value?.trim() ?? "" };
  };
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["sde-ui", "sde-dialog"],
    window: { title: t("SDE.importer.thirdParty.button"), icon: "fas fa-book-open" },
    position: { width: 560 },
    content: `
      <p>${t("SDE.importer.thirdParty.lead")}</p>
      <div class="sde-srcpdf-upload">
        <input type="file" name="pdf" accept="application/pdf,.pdf">
        <label>${t("SDE.importer.thirdParty.name")} <input type="text" name="label" placeholder="${t("SDE.importer.thirdParty.namePlaceholder")}"></label>
      </div>`,
    buttons: [
      { action: "read", label: t("SDE.importer.thirdParty.read"), icon: "fas fa-book-open", default: true, callback: (ev, button, dialog) => read(dialog) },
      { action: "browse", label: t("SDE.importer.srcpdf.linkExisting"), callback: (ev, button, dialog) => ({ ...read(dialog), browse: true }) },
      { action: "cancel", label: t("SDE.importer.btn.cancel") },
    ],
    rejectClose: false,
    render: (_event, dialog) => {
      const root = dialog?.element ?? dialog;
      const file = root?.querySelector?.("input[name='pdf']");
      const name = root?.querySelector?.("input[name='label']");
      const go = root?.querySelector?.("[data-action='read']");
      if (!file || !name) return;
      let typed = false;
      name.addEventListener("input", () => { typed = true; });
      const sync = () => {
        if (go) go.disabled = !file.files.length;
        if (file.files.length && !typed) name.value = bookNameFromFile(file.files[0].name);
      };
      file.addEventListener("change", sync);
      sync();
      // Straight to the file chooser: the click that opened this window still counts as the GM's.
      try { file.click(); } catch (_e) { /* the browser wants its own click: Choose file is right there */ }
    },
  }).catch(() => null);
  if (!picked || picked === "cancel") return null;

  const { uploadSourcePdf, registerSourcePdf, customSourceKey } = await import("./source-pdf-registry.mjs");
  const { file } = picked;
  let path = "";
  if (picked.browse) {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    // ponytail: never settles if the browser is closed without a pick; nothing waits on it but this call.
    path = String(await new Promise((resolve) => new FP({ type: "any", current: "assets", callback: resolve }).browse()) ?? "");
  }
  if (picked.browse ? !/\.pdf$/i.test(path) : !file || (file.type && file.type !== "application/pdf")) {
    ui.notifications.warn(t("SDE.importer.srcpdf.notPdf"));
    return null;
  }
  const label = picked.label || bookNameFromFile(picked.browse ? path : file.name);
  const src = customSourceKey(label);
  if (!src) { ui.notifications.warn(t("SDE.importer.srcpdf.needName")); return null; }
  if (picked.browse) {
    await registerSourcePdf(src, path, label);
    return { path, label };
  }
  try {
    return { path: await uploadSourcePdf(src, file, label), label };
  } catch (err) {
    // A host that refuses the upload still has the file in this browser, and
    // reading it is all the import needs.
    console.warn("[SDE] source PDF upload failed; reading it from this computer", err);
    const { useSessionPdf, sessionPdfPath } = await import("./session-pdf.mjs");
    useSessionPdf(src, file);
    ui.notifications.info(t("SDE.importer.thirdParty.notKept", { book: label }));
    return { path: sessionPdfPath(src), label };
  }
}

/** Import a third-party book: choose it, read all of it, land on Preview. */
export async function importThirdPartyBook(app) {
  const book = await pickThirdPartyBook();
  if (!book) return false;
  app._invalidateManageTree?.();   // the new link changes what the tree can run
  return readWholeBook(app, book.path, book.label);
}

/**
 * Manage the source-PDF library: show which books are linked, and upload +
 * link a PDF for a source. Uploads land in worlds/<id>/source-pdfs and are
 * recorded as flagged pdf pages in the "Shadowdark Source PDFs" journal, so
 * the importer's Open-PDF deep-links resolve to them. Reopens after each
 * upload so the GM can link several books in a row. GM-gated.
 */
/** Sentinel value of the "Another book…" option in the Book selector. */
const NEW_BOOK = "__new";

export async function manageSourcePdfs(app) {
  if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.notify.gmOnlyPdfs")); return; }
  const { listSourcePdfs, uploadSourcePdf, registerSourcePdf, sourcePdfBookHref, customSourceKey, sourceLabel, isCustomSource } =
    await import("./source-pdf-registry.mjs");
  const { useSessionPdf, onTheForge, FORGE_UPLOAD_LIMIT_MB } = await import("./session-pdf.mjs");

  const rows = await listSourcePdfs();
  const statusList = rows.map((r) => {
    const file = r.file ? foundry.utils.escapeHTML(r.file.split("/").pop()) : "—";
    const icon = r.linked ? "fa-file-pdf" : "fa-file-circle-xmark";
    // A verified upload, the shared default path (HEAD-checked), or a default
    // that points at nothing on this deployment. (review 2026-07-12 #5)
    const note = r.origin === "session" ? t("SDE.importer.srcpdf.sessionRow")
      : r.origin === "fallback"
        ? t(r.linked ? "SDE.importer.srcpdf.defaultPath" : "SDE.importer.srcpdf.defaultMissing")
        : "";
    // `data-src` + the open hint only on rows that actually resolve to a file.
    const open = r.linked
      ? ` data-src="${foundry.utils.escapeHTML(r.src)}" title="${t("SDE.importer.srcpdf.openTip")}"`
      : "";
    return `<li class="sde-srcpdf-row ${r.linked ? "linked" : "missing"}"${open}><i class="fas ${icon}"></i>
      <strong>${foundry.utils.escapeHTML(r.label)}</strong>
      <span class="sde-srcpdf-file">${file}${note}</span></li>`;
  }).join("");
  const options = rows.map((r) =>
    `<option value="${foundry.utils.escapeHTML(r.src)}">${foundry.utils.escapeHTML(r.label)}${r.linked ? t("SDE.importer.srcpdf.replace") : ""}</option>`).join("")
    // Anything that isn't a Shadowdark book — third-party adventures, homebrew.
    + `<option value="${NEW_BOOK}">${t("SDE.importer.srcpdf.anotherBook")}</option>`;

  const readPick = (dialog, extra = {}) => {
    const root = dialog.element ?? dialog;
    const src = root.querySelector("select[name='src']")?.value;
    const file = root.querySelector("input[name='pdf']")?.files?.[0] ?? null;
    const newLabel = root.querySelector("input[name='newlabel']")?.value?.trim() ?? "";
    return file ? { src, file, newLabel, ...extra } : null;
  };

  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["sde-ui", "sde-dialog"],
    // Without a width DialogV2 sizes to content, and the intro paragraph is one
    // long line — the dialog came out nearly as wide as the screen.
    window: { title: t("SDE.importer.srcpdf.title"), icon: "fas fa-file-pdf", resizable: true },
    position: { width: 620 },
    content: `
      <p>${t("SDE.importer.srcpdf.lead")}</p>
      ${onTheForge() ? `<p class="sde-srcpdf-tip"><i class="fas fa-circle-info"></i> ${t("SDE.importer.srcpdf.forgeNote", { limit: FORGE_UPLOAD_LIMIT_MB })}</p>` : ""}
      <p class="sde-srcpdf-tip"><i class="fas fa-hand-pointer"></i>
      ${t("SDE.importer.srcpdf.tip")}</p>
      <ul class="sde-srcpdf-list">${statusList}</ul>
      <div class="sde-srcpdf-upload">
        <label>${t("SDE.importer.downtime.book")} <select name="src">${options}</select></label>
        <input type="text" name="newlabel" placeholder="${t("SDE.importer.srcpdf.namePlaceholder")}" class="sde-srcpdf-newlabel" hidden>
        <input type="file" name="pdf" accept="application/pdf,.pdf">
      </div>`,
    buttons: [
      {
        // The default. Most people only need the book for one import, and a host may refuse
        // a book-sized upload (The Forge: 50 MB a file). Nothing is uploaded; the importer
        // reads the file from this computer and lets it go when the import is done
        // (session-pdf.mjs).
        action: "session", label: t("SDE.importer.srcpdf.useHere"), default: true,
        callback: (ev, button, dialog) => readPick(dialog, { session: true }),
      },
      {
        action: "upload", label: t("SDE.importer.srcpdf.upload"),
        callback: (ev, button, dialog) => readPick(dialog),
      },
      {
        // For a book the upload route cannot take: a proxy in front of Foundry
        // caps request size (nginx defaults to 1 MB, Cloudflare to 100), and a
        // full-colour rulebook is hundreds. Put the file on the server by any
        // other means and link it where it already is — no upload at all.
        action: "browse", label: t("SDE.importer.srcpdf.linkExisting"),
        callback: (ev, button, dialog) => {
          const root = dialog.element ?? dialog;
          return {
            src: root.querySelector("select[name='src']")?.value,
            browse: true,
            newLabel: root.querySelector("input[name='newlabel']")?.value?.trim() ?? "",
          };
        },
      },
      { action: "close", label: t("SDE.importer.btn.done") },
    ],
    rejectClose: false,
    // Double-click a linked row to just read the book — the Open-PDF buttons
    // elsewhere all need a page cite, so the library had no way to open one.
    render: (_event, dialog) => {
      const root = dialog?.element ?? dialog;
      // "Another book…" needs a name to file it under; only ask when picked.
      const sel = root?.querySelector?.("select[name='src']");
      const newLabel = root?.querySelector?.("input[name='newlabel']");
      const sessionBtn = root?.querySelector?.("[data-action='session']");
      const pdf = root?.querySelector?.("input[name='pdf']");
      // The book's name comes from its file unless the GM has typed one.
      const nameIt = () => { if (!newLabel.hidden && !newLabel.value && pdf?.files?.[0]) newLabel.value = bookNameFromFile(pdf.files[0].name); };
      pdf?.addEventListener("change", nameIt);
      sel?.addEventListener("change", () => {
        if (sessionBtn) sessionBtn.hidden = sel.value === NEW_BOOK;   // only the known books can come from this computer
        newLabel.hidden = sel.value !== NEW_BOOK;
        nameIt();
        if (!newLabel.hidden) newLabel.focus();
      });
      root?.querySelectorAll?.(".sde-srcpdf-row.linked[data-src]").forEach((li) => {
        li.addEventListener("dblclick", () => {
          const src = li.dataset.src;
          const href = sourcePdfBookHref(src);
          if (!href) { ui.notifications.warn(t("SDE.importer.srcpdf.notFound")); return; }
          app._showSourcePdf(href, sourceLabel(src));
        });
      });
    },
  }).catch(() => null);

  if (!picked || picked === "close" || (!picked.file && !picked.browse)) return;
  if (picked.file?.type && picked.file.type !== "application/pdf") {
    ui.notifications.warn(t("SDE.importer.srcpdf.notPdf"));
    return manageSourcePdfs(app);
  }

  // "Another book…": file it under a key derived from the name the GM gave it.
  let { src } = picked;
  let label = "";
  if (src === NEW_BOOK) {
    label = picked.newLabel || bookNameFromFile(picked.file?.name);
    src = customSourceKey(label);
    if (!src) {
      ui.notifications.warn(t("SDE.importer.srcpdf.needName"));
      return manageSourcePdfs(app);
    }
  }

  const book = label || CHAR_SOURCES[src]?.label || src;
  // A book with no recipe is read whole as soon as it is linked, and the GM is
  // left on what it found instead of back in this dialog.
  const afterLink = (path) => {
    app._invalidateManageTree?.();   // the new link changes what the tree can run
    app.render();
    return isCustomSource(src) ? readWholeBook(app, path, label || sourceLabel(src)) : manageSourcePdfs(app);
  };

  // Link where it lies: Foundry's own browser over the server's files, so the
  // book never travels through an upload the host might refuse.
  if (picked.browse) {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({
      type: "any", current: "assets",
      callback: async (path) => {
        if (!/\.pdf$/i.test(String(path ?? ""))) {
          ui.notifications.warn(t("SDE.importer.srcpdf.notPdf"));
          return manageSourcePdfs(app);
        }
        await registerSourcePdf(src, path, label);
        ui.notifications.info(t("SDE.importer.srcpdf.linked", { book, file: path.split("/").pop() }));
        return afterLink(path);
      },
    }).browse();
    return;
  }

  const fromHere = () => {
    useSessionPdf(src, picked.file);
    ui.notifications.info(t("SDE.importer.srcpdf.sessionLinked", { book }));
    app._invalidateManageTree?.();
    app.render();
    return manageSourcePdfs(app);
  };
  if (picked.session) return fromHere();

  let path;
  try {
    path = await uploadSourcePdf(src, picked.file, label);
    ui.notifications.info(t("SDE.importer.srcpdf.linked", { book, file: path.split("/").pop() }));
  } catch (err) {
    console.error("[SDE] source PDF upload failed", err);
    // The file is already in the browser: offer to use it from there instead of making them start over.
    const useHere = !label && await foundry.applications.api.DialogV2.confirm({   // a new custom book cannot come from here
      classes: ["sde-ui", "sde-dialog"],
      window: { title: t("SDE.importer.srcpdf.title"), icon: "fas fa-file-pdf" },
      content: `<p>${t("SDE.importer.srcpdf.uploadFailed")}</p><p>${t("SDE.importer.srcpdf.useInstead", { file: foundry.utils.escapeHTML(picked.file.name) })}</p>`,
      rejectClose: false,
    }).catch(() => false);
    if (useHere) return fromHere();
    return manageSourcePdfs(app);
  }
  return afterLink(path);   // a known book: reopen with refreshed status for the next one
}
