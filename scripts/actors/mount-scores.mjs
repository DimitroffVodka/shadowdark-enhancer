/** Mount NPC model extension and once-only score adoption. No shared NPC schema changes. */
import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { ABILITIES } from "../stat-damage/stat-damage-core.mjs";
import { mountScores, effectiveMountScores, mountModifier } from "./mount-scores-core.mjs";
import { grownSize } from "../mounted/mounted-core.mjs";
export const isMount = actor => actor?.type === `${MODULE_ID}.mount`;
export const scoresOf = actor => mountScores(actor?._source?.system?.abilities ?? actor?.system?.abilities, actor?.flags?.[MODULE_ID]?.mountScores);
export async function adoptMountScores(actor) {
  if (!isMount(actor)) return;
  const state = scoresOf(actor);
  if (JSON.stringify(state) !== JSON.stringify(actor.flags?.[MODULE_ID]?.mountScores)) await replaceModuleFlag(actor, "mountScores", state);
}
export function buildMountNpcModel(NpcModel) {
  return class MountNpcModel extends NpcModel {
    static defineSchema() {
      const schema = super.defineSchema();
      for (const key of ABILITIES) schema.abilities.fields[key].fields.value = new foundry.data.fields.NumberField({ integer: true, initial: 10 });
      return schema;
    }
    prepareBaseData() {
      super.prepareBaseData();
      const values = effectiveMountScores(scoresOf(this.parent));
      for (const key of ABILITIES) this.abilities[key].value = values[key];
    }
    prepareDerivedData() {
      super.prepareDerivedData();
      for (const key of ABILITIES) this.abilities[key].mod = mountModifier(this.abilities[key].value);
    }
  };
}
export function registerMountScores() {
  Hooks.on("preCreateActor", (doc) => {
    if (!isMount(doc)) return;
    // A new mount's token is 2x2 (#326); a bigger one stays. Existing mounts are not touched.
    const size = grownSize(doc._source.prototypeToken);
    doc.updateSource({
      [`flags.${MODULE_ID}.mountScores`]: scoresOf(doc),
      ...(size ? { "prototypeToken.width": size.width, "prototypeToken.height": size.height } : {}),
    });
  });
  // Adopt existing documents once, on the authority client, not on sheet render.
  Hooks.once("ready", async () => {
    if (game.users.activeGM?.id !== game.user.id) return;
    for (const actor of game.actors.contents.filter(isMount)) await adoptMountScores(actor);
  });
}
