/**
 * Shadowdark Enhancer — Importer Hub maintenance actions (Foundry-bound).
 *
 * The suite-maintenance handlers extracted from ImporterHubApp (review
 * 2026-07-11 maintainability — the hub owned parse/preview/commit AND all of
 * this). Each function takes the hub `app` instance and touches it only to
 * re-render / invalidate a census cache; all heavy lifting stays in the
 * dedicated modules they dynamic-import (table-migration, bundle-io,
 * source-pdf-registry, table-enrich, item-migration, monster-backfill,
 * actor-migration). Bodies moved verbatim from importer-hub-app.mjs — no
 * behavior change.
 *
 * All GM-gated; every destructive-sounding operation is dry-run previewed
 * and confirm-dialoged, and never deletes originals (backup/lock patterns).
 */

import { CHAR_SOURCES } from "./char-content-manifest.mjs";

/** Migrate module-imported WORLD tables into the sde-tables pack (dry-run → confirm). */
export async function migrateCompendiumTables(app) {
  if (!game.user?.isGM) return;

  const { migrateTables } = await import("./table-migration.mjs");

  const plan = await migrateTables({ dryRun: true });
  if (!plan) return;

  const bySourceLines = Object.entries(plan.bySource)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([src, n]) => `<li>${foundry.utils.escapeHTML(src || "(no source)")}: ${n}</li>`)
    .join("");
  const byCategoryLines = Object.entries(plan.byCategory)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, n]) => `<li>${foundry.utils.escapeHTML(cat || "(no category)")}: ${n}</li>`)
    .join("");

  const previewHtml = plan.total === 0
    ? `<p>No module-imported world tables found to migrate. All tables are either already in the compendium pack or are hand-made world tables.</p>`
    : `<p>Found <strong>${plan.total}</strong> module-imported world table(s) to migrate into <em>sde-tables</em>.</p>
       <p>Originals will be moved to <em>_Backup (pre-suite)</em> (never deleted).<br>
       Loot Setup bindings will be repointed to the new pack UUIDs.</p>
       ${bySourceLines ? `<p><strong>By source:</strong></p><ul>${bySourceLines}</ul>` : ""}
       ${byCategoryLines ? `<p><strong>By category:</strong></p><ul>${byCategoryLines}</ul>` : ""}`;

  if (plan.total === 0) {
    await foundry.applications.api.DialogV2.alert({
      window: { title: "Migrate to Compendium" },
      content: previewHtml,
    }).catch(() => {});
    return;
  }

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "Migrate Tables to Compendium" },
    content: previewHtml,
    buttons: [
      { action: "migrate", label: "Migrate", default: true },
      { action: "cancel",  label: "Cancel" },
    ],
    rejectClose: false,
  }).catch(() => "cancel");

  if (!choice || choice === "cancel") return;

  let result;
  try {
    result = await migrateTables({ dryRun: false });
  } catch (err) {
    console.error("shadowdark-enhancer | table-migration: unexpected error:", err);
    ui.notifications?.error("Table migration failed — see the console for details.");
    return;
  }

  if (!result) return;

  const summary = [
    `${result.copied} table(s) copied to compendium`,
    `${result.backedUp} original(s) moved to _Backup`,
    result.bindingsRepointed ? `${result.bindingsRepointed} Loot Setup binding(s) repointed` : "",
    result.failures ? `${result.failures} failure(s) — see console` : "",
  ].filter(Boolean).join(" · ");

  ui.notifications?.info(`Migration complete: ${summary}.`);
  app.render();
}

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

  const rows = listSourcePdfs();
  const statusList = rows.map((r) => {
    const file = r.file ? foundry.utils.escapeHTML(r.file.split("/").pop()) : "—";
    const icon = r.linked ? "fa-file-pdf" : "fa-file-circle-xmark";
    return `<li class="sde-srcpdf-row ${r.linked ? "linked" : "missing"}"><i class="fas ${icon}"></i>
      <strong>${foundry.utils.escapeHTML(r.label)}</strong>
      <span class="sde-srcpdf-file">${file}</span></li>`;
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

/**
 * Re-link every sde-tables doc to imported monsters/items (REQ-24 sweep).
 * Idempotent + link-preserving; DialogV2 confirm with the pack doc count.
 */
export async function relinkPackTables(_app) {
  if (!game.user?.isGM) return;

  const { TableEnricher } = await import("./table-enrich.mjs");
  const { findSuitePack } = await import("./compendium-suite.mjs");
  const pack = findSuitePack("sde-tables");
  if (!pack) {
    ui.notifications?.warn("No sde-tables compendium pack found.");
    return;
  }

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "Re-link Pack Tables" },
    content: `<p>Re-link all <strong>${pack.index.size}</strong> table(s) in <em>sde-tables</em> to your imported monsters and items.</p>
      <p>Safe to re-run — existing links and document rows are preserved; only missing links are added.</p>`,
    buttons: [
      { action: "relink", label: "Re-link", default: true },
      { action: "cancel", label: "Cancel" },
    ],
    rejectClose: false,
  }).catch(() => "cancel");
  if (!choice || choice === "cancel") return;

  let tally;
  try {
    tally = await TableEnricher.sweepPack();
  } catch (err) {
    console.error("shadowdark-enhancer | table sweep: unexpected error:", err);
    ui.notifications?.error("Re-link failed — see the console for details.");
    return;
  }
  if (!tally) return;

  const summary = [
    `${tally.encounters} encounter table(s)`,
    `${tally.treasures} treasure table(s)`,
    tally.linked ? `${tally.linked} monster link(s)` : "",
    tally.skipped ? `${tally.skipped} skipped (not enrichable)` : "",
    tally.failures ? `${tally.failures} failure(s) — see console` : "",
  ].filter(Boolean).join(" · ");
  ui.notifications?.info(`Re-link complete: ${summary}.`);
}

/**
 * Fold the legacy world "Loot" pack into sde-items (A-08).
 * Dry-run preview → DialogV2 confirm → migrateItems → LootLinker.invalidate().
 * Non-destructive: originals stay, the legacy pack is locked as backup (D6).
 */
export async function foldLegacyLoot(app) {
  if (!game.user?.isGM) return;

  const { ItemMigration } = await import("./item-migration.mjs");
  const { LootLinker } = await import("./loot-linker.mjs");

  const preview = await ItemMigration.planItemMigration();
  if (!preview) return;

  const bySourceLines = Object.entries(preview.bySource)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([src, n]) => `<li>${foundry.utils.escapeHTML(src)}: ${n}</li>`)
    .join("");

  if (preview.total === 0) {
    await foundry.applications.api.DialogV2.alert({
      window: { title: "Fold Legacy Loot Pack" },
      content: `<p>No un-migrated items found in the legacy "Loot" pack. Either it is absent or every item already carries the migrated stamp.</p>`,
    }).catch(() => {});
    return;
  }

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "Fold Legacy Loot Pack into Items" },
    content: `<p>Found <strong>${preview.total}</strong> item(s) in the legacy "Loot" pack to copy into <em>sde-items</em>.</p>
      <p>Originals are never deleted — the legacy pack is locked afterward as a backup.</p>
      ${bySourceLines ? `<p><strong>By source:</strong></p><ul>${bySourceLines}</ul>` : ""}`,
    buttons: [
      { action: "fold",   label: "Fold in", default: true },
      { action: "cancel", label: "Cancel" },
    ],
    rejectClose: false,
  }).catch(() => "cancel");

  if (!choice || choice === "cancel") return;

  let report;
  try {
    report = await ItemMigration.migrateItems({ dryRun: false });
  } catch (err) {
    console.error("shadowdark-enhancer | item-migration: unexpected error:", err);
    ui.notifications?.error("Legacy Loot fold-in failed — see the console for details.");
    return;
  }
  if (!report) return;

  LootLinker.invalidate();
  app._invalidateItemsCache();

  const summary = [
    `${report.legacyMigrated} item(s) folded into sde-items`,
    `legacy pack locked as backup`,
    report.failures ? `${report.failures} failure(s) — see console` : "",
  ].filter(Boolean).join(" · ");
  ui.notifications?.info(`Fold-in complete: ${summary}.`);
  app.render();
}

/**
 * Backfill existing imported NPCs to fresh-import fidelity.
 * Ported verbatim from MonsterImporterApp._onBackfill (D-03).
 */
export async function backfillMonsters(_app) {
  if (!game.user?.isGM) { ui.notifications.warn("Only a GM can run the monster backfill."); return; }
  const { backfillTargets } = await import("./monster-backfill.mjs");

  ui.notifications.info("Scanning imported monsters for upgrades…");
  const preview = await backfillTargets({ scope: "pack", dryRun: true });
  if (!preview) return;

  if (preview.total === 0) {
    ui.notifications.info("No imported-monsters compendium found or it contains no NPC actors.");
    return;
  }

  if (preview.changed.length === 0) {
    ui.notifications.info(`All ${preview.total} actor(s) already at full fidelity — nothing to backfill.`);
    return;
  }

  const t = preview.totals;
  const lines = [];
  if (t.descriptionsWrapped) lines.push(`${t.descriptionsWrapped} item description(s) will be HTML-wrapped`);
  if (t.namesCased)          lines.push(`${t.namesCased} attack name(s) will be Title-Cased`);
  if (t.iconsSet)            lines.push(`${t.iconsSet} item icon(s) will be set`);
  if (t.spellsConverted)     lines.push(`${t.spellsConverted} spell feature(s) will become real Spell items`);
  if (t.artAssigned)         lines.push(`${t.artAssigned} portrait/token image(s) will be resolved`);

  const actorList = preview.changed.map((r) => `<li>${foundry.utils.escapeHTML(r.actor)}</li>`).join("");
  const content = `
    <p><strong>${preview.changed.length} of ${preview.total}</strong> actor(s) need upgrading:</p>
    <ul style="max-height:160px;overflow-y:auto;margin:.4em 0">${actorList}</ul>
    <p>${lines.join("; ")}.</p>
    <p>This is non-destructive and idempotent. Proceed?</p>`;

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "Backfill Imported Monsters" },
    content,
    buttons: [
      { action: "confirm", label: "Backfill", default: true },
      { action: "cancel",  label: "Cancel" },
    ],
    rejectClose: false,
  }).catch(() => "cancel");

  if (choice !== "confirm") return;

  const result = await backfillTargets({ scope: "pack", dryRun: false });
  if (!result) return;

  const rt = result.totals;
  const parts = [];
  if (rt.descriptionsWrapped) parts.push(`${rt.descriptionsWrapped} desc wrapped`);
  if (rt.namesCased)          parts.push(`${rt.namesCased} names cased`);
  if (rt.iconsSet)            parts.push(`${rt.iconsSet} icons set`);
  if (rt.spellsConverted)     parts.push(`${rt.spellsConverted} spells converted`);
  if (rt.artAssigned)         parts.push(`${rt.artAssigned} art assigned`);
  ui.notifications.info(
    `Backfill complete: ${result.changed.length} actor(s) upgraded (${parts.join(", ") || "minor updates"}). ` +
    `${result.unchanged.length} already up to date.`
  );
}

/**
 * Migrate world-side imported monster actors into sde-actors compendium suite pack.
 * Ported verbatim from MonsterImporterApp._onMigrateSuite (D-03).
 */
export async function migrateSuiteActors(app) {
  if (!game.user?.isGM) { ui.notifications.warn("Only a GM can run the suite migration."); return; }
  const { migrateActors } = await import("./actor-migration.mjs");

  ui.notifications.info("Scanning imported monsters for suite migration…");
  const preview = await migrateActors({ dryRun: true });
  if (!preview) return;

  if (preview.total === 0) {
    ui.notifications.info("No imported-monsters actors found to migrate (all already migrated or none present).");
    return;
  }

  const sourceLines = Object.entries(preview.bySource)
    .map(([src, count]) => {
      const label = src === "" ? "Custom / (no source)" : src === "undefined" ? "(unknown)" : src;
      return `<li><strong>${foundry.utils.escapeHTML(label)}</strong>: ${count}</li>`;
    })
    .join("");

  const content = `
    <p>This will migrate <strong>${preview.total}</strong> imported monster actor(s) into the
    <em>Shadowdark Enhancer — Actors</em> compendium suite pack:</p>
    <ul style="margin:.4em 0">
      <li>World actors to copy: <strong>${preview.worldCount}</strong></li>
      <li>Legacy pack docs to fold in: <strong>${preview.legacyPackCount}</strong></li>
    </ul>
    ${sourceLines ? `<p>By source:</p><ul style="max-height:120px;overflow-y:auto;margin:.4em 0">${sourceLines}</ul>` : ""}
    <p>Each actor is backfilled to current fidelity first, then copied into
    <em>sde-actors</em> under its per-source folder. World originals are
    <strong>moved</strong> (not deleted) into a <em>_Backup (pre-suite)</em>
    folder. The legacy "Imported Monsters" pack (if any) is retired in place —
    never deleted. This operation is idempotent; re-running skips
    already-migrated actors.</p>
    <p>Proceed?</p>`;

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "Migrate to Compendium Suite" },
    content,
    buttons: [
      { action: "confirm", label: "Migrate", default: true },
      { action: "cancel",  label: "Cancel" },
    ],
    rejectClose: false,
  }).catch(() => "cancel");

  if (choice !== "confirm") return;

  const result = await migrateActors({ dryRun: false });
  if (!result) return;

  const parts = [];
  if (result.copied)         parts.push(`${result.copied} copied to sde-actors`);
  if (result.backedUp)       parts.push(`${result.backedUp} moved to _Backup`);
  if (result.legacyMigrated) parts.push(`${result.legacyMigrated} legacy pack docs folded in`);
  if (result.failures)       parts.push(`${result.failures} failed (see console)`);
  ui.notifications.info(
    `Suite migration complete: ${parts.join("; ") || "nothing to do"}.`
  );

  // Invalidate monsters cache so census reflects migrated actors
  app._invalidateMonstersCache();
  app.render();
}
