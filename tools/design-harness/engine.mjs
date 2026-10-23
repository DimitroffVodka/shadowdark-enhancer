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
// A candidate must be a whole engine (both entry points) and never this wrapper's own folder: the
// latter makes the wrapper import itself and die as an unsettled top-level await, with no message.
const self = fs.realpathSync(import.meta.dirname);
const dir = candidates.find((d) => fs.existsSync(path.join(d, "shot.mjs"))
  && fs.existsSync(path.join(d, "serve.mjs"))
  && fs.realpathSync(d) !== self);
if (!dir) {
  console.error(`design harness engine not found. It ships with foundry-mcp-live (tools/design-harness); set FOUNDRY_DESIGN_HARNESS to that folder. Looked in:\n  ${candidates.join("\n  ")}`);
  process.exit(2);
}

export const engineUrl = (file) => pathToFileURL(path.join(dir, file)).href;
// Render this module unless the caller is standing in another module's root or set MODULE_DIR.
process.env.MODULE_DIR ??= fs.existsSync(path.join(process.cwd(), "module.json")) ? process.cwd() : path.resolve(import.meta.dirname, "../..");
