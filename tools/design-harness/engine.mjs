// Where the design-harness engine lives: foundry-mcp-live/tools/design-harness (FOUNDRY_DESIGN_HARNESS overrides).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const candidates = [
  process.env.FOUNDRY_DESIGN_HARNESS,
  path.join(os.homedir(), "FoundryVTT-Projects/foundry-mcp-live/tools/design-harness"),
  path.join(os.homedir(), "git/foundry-mcp-live/tools/design-harness"),
].filter(Boolean);
const dir = candidates.find((d) => fs.existsSync(path.join(d, "shot.mjs")));
if (!dir) {
  console.error(`design harness engine not found. It ships with foundry-mcp-live (tools/design-harness); set FOUNDRY_DESIGN_HARNESS to that folder. Looked in:\n  ${candidates.join("\n  ")}`);
  process.exit(2);
}

export const engineUrl = (file) => pathToFileURL(path.join(dir, file)).href;
// Render this module unless the caller is standing in another module's root or set MODULE_DIR.
process.env.MODULE_DIR ??= fs.existsSync(path.join(process.cwd(), "module.json")) ? process.cwd() : path.resolve(import.meta.dirname, "../..");
