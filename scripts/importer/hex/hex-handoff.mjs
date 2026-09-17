/**
 * Shadowdark Enhancer — hex crawl hand-off (Foundry-bound).
 *
 * Turns a committed crawl entry (hex-commit) back into the dataset Shadowdark
 * Extras' hexcrawl builder consumes, then hands it over when Extras exposes
 * the entry point (shadowdark-extras#141) or downloads it as JSON otherwise.
 * Mirrors the renown delegation the other way round: Extras is detected by
 * namespace, never required. Nothing from a book ships with the module; the
 * downloaded file is the GM's own extraction.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { HEX_FLAG } from "./hex-commit.mjs";
import { buildHexDataset } from "./hex-dataset.mjs";

/** Extras' hex API when it carries the builder entry point, else null. */
export function extrasHexApi() {
  const api = globalThis.game?.shadowdarkExtras?.hex;
  return typeof api?.buildHexcrawl === "function" ? api : null;
}

/**
 * Dataset from a crawl entry: its pages are the keyed hexes (name, description
 * with links intact), its flag carries the summary rows (zone, terrain, feature).
 * @param {JournalEntry} entry
 * @returns {object} dataset (hex-dataset.mjs)
 */
export function datasetFromEntry(entry) {
  const flag = entry?.getFlag?.(MODULE_ID, HEX_FLAG) ?? {};
  const drafts = [];
  for (const p of entry?.pages?.contents ?? []) {
    const f = p.getFlag?.(MODULE_ID, HEX_FLAG);
    if (!f?.key) continue;
    drafts.push({ hexId: f.num, key: f.key, name: String(p.name ?? "").replace(/^\d{3,4}\s*/, ""), html: p.text?.content ?? "" });
  }
  return buildHexDataset({ name: flag.crawl ?? entry?.name ?? "", source: flag.source ?? "", drafts, summaryRows: flag.keyed ?? [] });
}

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "hexcrawl";

/**
 * Hand a dataset to Extras, or download it. GM-gated by the callers.
 * @param {object} dataset
 * @returns {Promise<{via:"extras", summary:object}|{via:"download", filename:string}|{via:"none"}>}
 */
export async function handoffDataset(dataset) {
  const api = extrasHexApi();
  if (api) {
    const summary = await api.buildHexcrawl(dataset);
    return { via: "extras", summary };
  }
  const save = foundry.utils?.saveDataToFile ?? globalThis.saveDataToFile;
  if (typeof save !== "function") {
    ui.notifications?.error("saveDataToFile unavailable — cannot download the hex dataset.");
    return { via: "none" };
  }
  const filename = `${slug(dataset.name)}-hexcrawl.json`;
  save(JSON.stringify(dataset, null, 2), "text/json", filename);
  return { via: "download", filename };
}
