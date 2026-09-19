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
  const { listSourcePdfs, uploadSourcePdf, sourcePdfBookHref, customSourceKey, sourceLabel } =
    await import("./source-pdf-registry.mjs");

  const rows = await listSourcePdfs();
  const statusList = rows.map((r) => {
    const file = r.file ? foundry.utils.escapeHTML(r.file.split("/").pop()) : "—";
    const icon = r.linked ? "fa-file-pdf" : "fa-file-circle-xmark";
    // A verified upload, the shared default path (HEAD-checked), or a default
    // that points at nothing on this deployment. (review 2026-07-12 #5)
    const note = r.origin === "fallback"
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

  const picked = await foundry.applications.api.DialogV2.wait({
    // Without a width DialogV2 sizes to content, and the intro paragraph is one
    // long line — the dialog came out nearly as wide as the screen.
    window: { title: t("SDE.importer.srcpdf.title"), icon: "fas fa-file-pdf", resizable: true },
    position: { width: 620 },
    content: `
      <p>${t("SDE.importer.srcpdf.lead")}</p>
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
        action: "upload", label: t("SDE.importer.srcpdf.upload"), default: true,
        callback: (ev, button, dialog) => {
          const root = dialog.element ?? dialog;
          const src = root.querySelector("select[name='src']")?.value;
          const file = root.querySelector("input[name='pdf']")?.files?.[0] ?? null;
          const newLabel = root.querySelector("input[name='newlabel']")?.value?.trim() ?? "";
          return file ? { src, file, newLabel } : null;
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
      sel?.addEventListener("change", () => {
        newLabel.hidden = sel.value !== NEW_BOOK;
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

  if (!picked || picked === "close" || !picked.file) return;
  if (picked.file.type && picked.file.type !== "application/pdf") {
    ui.notifications.warn(t("SDE.importer.srcpdf.notPdf"));
    return manageSourcePdfs(app);
  }

  // "Another book…": file it under a key derived from the name the GM gave it.
  let { src } = picked;
  let label = "";
  if (src === NEW_BOOK) {
    label = picked.newLabel;
    src = customSourceKey(label);
    if (!src) {
      ui.notifications.warn(t("SDE.importer.srcpdf.needName"));
      return manageSourcePdfs(app);
    }
  }

  try {
    const path = await uploadSourcePdf(src, picked.file, label);
    ui.notifications.info(t("SDE.importer.srcpdf.linked", { book: label || CHAR_SOURCES[src]?.label || src, file: path.split("/").pop() }));
  } catch (err) {
    console.error("[SDE] source PDF upload failed", err);
    ui.notifications.error(t("SDE.importer.srcpdf.uploadFailed"));
    return;
  }
  app._invalidateManageTree?.();   // the new link changes what the tree can run
  app.render();
  return manageSourcePdfs(app);   // reopen with refreshed status for the next book
}
