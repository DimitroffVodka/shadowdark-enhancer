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

import { CHAR_SOURCES } from "./char-content-manifest.mjs";

/** Export the entire suite as one JSON bundle download (REQ-25, A-04). */
export async function exportSuiteBundle(_app) {
  if (!game.user?.isGM) return;
  const { exportBundle } = await import("./bundle-io.mjs");
  let bundle;
  try {
    bundle = await exportBundle();
  } catch (err) {
    console.error("shadowdark-enhancer | bundle export: unexpected error:", err);
    ui.notifications?.error("Bundle export failed — see the console for details.");
    return;
  }
  if (!bundle) return;
  const s = bundle.stats;
  const parts = Object.entries(s)
    .filter(([, v]) => v && typeof v === "object" && v.docs)
    .map(([k, v]) => `${k} ${v.docs}`);
  const warn = bundle.warnings.length ? ` · ${bundle.warnings.length} unresolved ref(s) — see console` : "";
  if (bundle.warnings.length) console.warn("shadowdark-enhancer | bundle warnings:", bundle.warnings);
  ui.notifications?.info(`Bundle exported: ${parts.join(" · ")}${warn}.`);
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
    window: { title: "Import Bundle" },
    content: `<p>Select a Shadowdark Enhancer bundle (.json):</p>
      <input type="file" name="bundle-file" accept=".json,application/json">`,
    buttons: [
      {
        action: "load", label: "Load", default: true,
        callback: (ev, button, dialog) => {
          const el = (dialog.element ?? dialog)?.querySelector?.("input[name='bundle-file']");
          return el?.files?.[0] ?? null;
        },
      },
      { action: "cancel", label: "Cancel" },
    ],
    rejectClose: false,
  }).catch(() => null);
  if (!picked || picked === "cancel") return;

  let bundle;
  try {
    bundle = JSON.parse(await picked.text());
  } catch {
    ui.notifications?.error("That file is not valid JSON.");
    return;
  }
  const check = validateBundle(bundle);
  if (!check.ok) {
    ui.notifications?.error(`Not a valid bundle: ${check.errors.join("; ")}.`);
    return;
  }

  // Per-pack summary confirm before touching anything.
  const rows = Object.entries(bundle.packs)
    .map(([k, p]) => `<li>${foundry.utils.escapeHTML(k)}: ${p.docs.length} doc(s), ${p.folders.length} folder(s)</li>`)
    .join("");
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "Import Bundle" },
    content: `<p>Bundle from world <strong>${foundry.utils.escapeHTML(bundle.world ?? "?")}</strong>
      (module v${foundry.utils.escapeHTML(bundle.moduleVersion ?? "?")}, exported ${foundry.utils.escapeHTML((bundle.exported ?? "").slice(0, 10))}):</p>
      <ul>${rows}</ul>
      <p>Documents already in your packs (same id) are skipped — nothing is overwritten or deleted.</p>`,
    buttons: [
      { action: "import", label: "Import", default: true },
      { action: "cancel", label: "Cancel" },
    ],
    rejectClose: false,
  }).catch(() => "cancel");
  if (!choice || choice === "cancel") return;

  let report;
  try {
    report = await applyBundle(bundle);
  } catch (err) {
    console.error("shadowdark-enhancer | bundle import: unexpected error:", err);
    ui.notifications?.error("Bundle import failed — see the console for details.");
    return;
  }
  if (!report) return;
  if (!report.ok) {
    ui.notifications?.error(`Bundle rejected: ${report.errors.join("; ")}.`);
    return;
  }
  const summary = [
    `${report.created} created`,
    `${report.skippedExisting} already present (skipped)`,
    report.failures ? `${report.failures} failure(s) — see console` : "",
  ].filter(Boolean).join(" · ");
  ui.notifications?.info(`Bundle import complete: ${summary}.`);
  app.render();
}

/**
 * Manage the source-PDF library: show which books are linked, and upload +
 * link a PDF for a source. Uploads land in worlds/<id>/source-pdfs and are
 * recorded as flagged pdf pages in the "Shadowdark Source PDFs" journal, so
 * the importer's Open-PDF deep-links resolve to them. Reopens after each
 * upload so the GM can link several books in a row. GM-gated.
 */
export async function manageSourcePdfs(app) {
  if (!game.user?.isGM) { ui.notifications.warn("Only a GM can manage source PDFs."); return; }
  const { listSourcePdfs, uploadSourcePdf } = await import("./source-pdf-registry.mjs");

  const rows = await listSourcePdfs();
  const statusList = rows.map((r) => {
    const file = r.file ? foundry.utils.escapeHTML(r.file.split("/").pop()) : "—";
    const icon = r.linked ? "fa-file-pdf" : "fa-file-circle-xmark";
    // A verified upload, the shared default path (HEAD-checked), or a default
    // that points at nothing on this deployment. (review 2026-07-12 #5)
    const note = r.origin === "fallback"
      ? (r.linked ? " (default path)" : " (default path — file not found; upload your copy)")
      : "";
    return `<li class="sde-srcpdf-row ${r.linked ? "linked" : "missing"}"><i class="fas ${icon}"></i>
      <strong>${foundry.utils.escapeHTML(r.label)}</strong>
      <span class="sde-srcpdf-file">${file}${note}</span></li>`;
  }).join("");
  const options = rows.map((r) =>
    `<option value="${r.src}">${foundry.utils.escapeHTML(r.label)}${r.linked ? " (replace)" : ""}</option>`).join("");

  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: "Source PDFs", icon: "fas fa-file-pdf" },
    content: `
      <p>Upload your own PDFs of the Shadowdark books. Each is linked to a source so the
      importer's <em>Open PDF</em> buttons jump straight to the cited page. Files stay in your
      world (<code>worlds/${foundry.utils.escapeHTML(game.world.id)}/source-pdfs</code>) — nothing
      leaves your machine.</p>
      <ul class="sde-srcpdf-list">${statusList}</ul>
      <div class="sde-srcpdf-upload">
        <label>Book <select name="src">${options}</select></label>
        <input type="file" name="pdf" accept="application/pdf,.pdf">
      </div>`,
    buttons: [
      {
        action: "upload", label: "Upload & link", default: true,
        callback: (ev, button, dialog) => {
          const root = dialog.element ?? dialog;
          const src = root.querySelector("select[name='src']")?.value;
          const file = root.querySelector("input[name='pdf']")?.files?.[0] ?? null;
          return file ? { src, file } : null;
        },
      },
      { action: "close", label: "Done" },
    ],
    rejectClose: false,
  }).catch(() => null);

  if (!picked || picked === "close" || !picked.file) return;
  if (picked.file.type && picked.file.type !== "application/pdf") {
    ui.notifications.warn("That doesn't look like a PDF file.");
    return manageSourcePdfs(app);
  }
  try {
    const path = await uploadSourcePdf(picked.src, picked.file);
    ui.notifications.info(`Linked ${CHAR_SOURCES[picked.src]?.label ?? picked.src} → ${path.split("/").pop()}.`);
  } catch (err) {
    console.error("[SDE] source PDF upload failed", err);
    ui.notifications.error("Upload failed — see console.");
    return;
  }
  app.render();
  return manageSourcePdfs(app);   // reopen with refreshed status for the next book
}
