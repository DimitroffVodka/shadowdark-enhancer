/**
 * Quench batch: settings contract — every registered module setting is sane.
 *
 * Read-only. Walks game.settings.settings for this module's namespace and
 * asserts what a bad registration would break on a GM's world:
 *   - every setting reads without throwing (a broken field or type);
 *   - a default satisfies its own type / choices (a stale default after a
 *     choice was renamed);
 *   - visible settings show real text, not a raw "SDE.settings.x.name" key.
 *
 * Registered only via quenchReady (see shadowdark-enhancer.mjs); test/ never
 * ships in the release zip.
 */
import { MODULE_ID } from "../../scripts/shared/module-id.mjs";

const PRIMITIVES = new Map([
  [Boolean, "boolean"],
  [String, "string"],
  [Number, "number"],
]);

function ownSettings() {
  return [...game.settings.settings.entries()]
    .filter(([key]) => key.startsWith(`${MODULE_ID}.`))
    .map(([key, cfg]) => ({ key, id: key.slice(MODULE_ID.length + 1), cfg }));
}

function defaultProblem({ cfg }) {
  const { type, choices } = cfg;
  const value = cfg.default;
  if (choices && !Object.hasOwn(choices, value)) return `default ${JSON.stringify(value)} is not a choice`;
  if (type instanceof foundry.data.fields.DataField) {
    const failure = type.validate(value);
    return failure ? String(failure.message ?? failure) : null;
  }
  const expected = PRIMITIVES.get(type);
  if (expected && value !== undefined && value !== null && typeof value !== expected) {
    return `default is ${typeof value}, type is ${expected}`;
  }
  return null;
}

export function registerSettingsContractBatch(quench) {
  quench.registerBatch("shadowdark-enhancer.settings-contract", (context) => {
    const { describe, it, assert } = context;

    describe("module settings", function () {
      it("registers a plausible number of settings", function () {
        assert.isAbove(ownSettings().length, 50);
      });

      it("every setting reads without throwing", function () {
        const bad = [];
        for (const { id } of ownSettings()) {
          try { game.settings.get(MODULE_ID, id); }
          catch (err) { bad.push(`${id}: ${err.message}`); }
        }
        assert.deepEqual(bad, []);
      });

      it("every default satisfies its own type and choices", function () {
        const bad = ownSettings()
          .map((s) => [s.id, defaultProblem(s)])
          .filter(([, why]) => why)
          .map(([id, why]) => `${id}: ${why}`);
        assert.deepEqual(bad, []);
      });

      it("every visible setting has a real name", function () {
        const bad = ownSettings()
          .filter(({ cfg }) => cfg.config)
          .filter(({ cfg }) => !cfg.name || (/^SDE\./.test(cfg.name) && !game.i18n.has(cfg.name)))
          .map(({ id }) => id);
        assert.deepEqual(bad, []);
      });
    });
  });
}
