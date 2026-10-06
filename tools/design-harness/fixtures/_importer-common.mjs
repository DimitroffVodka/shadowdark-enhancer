// Shared by the importer-family fixtures. The Importer Hub's Manage tree calls the partial `sdeTreeNode`, which the
// module registers at runtime (shadowdark-enhancer.mjs); the harness registers partials by path only. This wraps
// Handlebars.create() once so every fresh render environment also knows `sdeTreeNode`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FOUNDRY = process.env.FOUNDRY_APP ?? path.join(os.homedir(), "FoundryV14", "app");
const H = createRequire(path.join(FOUNDRY, "x.js"))("handlebars");

if (!H.__sdeTreePatched) {
  const create = H.create.bind(H);
  H.create = (...a) => {
    const hb = create(...a);
    hb.registerPartial("sdeTreeNode", fs.readFileSync(path.join(ROOT, "templates/partials/tree-node.hbs"), "utf8"));
    hb.registerPartial("sdeTreeNodeUi", fs.readFileSync(path.join(ROOT, "tools/design-harness/proposed/templates/tree-node-ui.hbs"), "utf8"));
    return hb;
  };
  H.__sdeTreePatched = true;
}
export const ready = true;
