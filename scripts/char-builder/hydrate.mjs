import { ABILITY_ORDER } from "./constants.mjs";
import { CharBuilderState } from "./state.mjs";

/**
 * Hydration: turn an EXISTING Player actor into a Character Builder state, so
 * the builder can edit it instead of rebuilding it. Nothing calls this yet;
 * `describeActor` is the read-only console helper for dry-running it.
 *
 * Two halves. `loadActorSnapshot(actor)` is the thin Foundry reader; it reads
 * `actor._source` (the BASE values) and never `actor.system`, because the
 * derived system data already includes talent and Effect bonuses (STR 15 shows
 * as 17) and hydrating those would bake the bonuses in twice.
 * `hydrateState(snapshot, resolved)` is pure: plain data in, a state out.
 */

/** Item types the system treats as physical gear (`system.isPhysical`). */
export const PHYSICAL_TYPES = new Set(["Armor", "Basic", "Gem", "Potion", "Scroll", "Wand", "Weapon"]);

/** The compendium entry an embedded item came from, when it says so. */
const sourceUuidOf = (item) => item?._stats?.compendiumSource || item?.flags?.core?.sourceId || null;

/** Last segment of a uuid: the only name an unresolvable reference has. */
const uuidTail = (uuid) => String(uuid).split(".").pop();

const asArray = (v) => (Array.isArray(v) ? v : (v ? [v] : []));

/** Slots a stack of `qty` takes, the way the shop's cart counts them. */
function slotsFor(system, qty) {
  const s = system?.slots || {};
  const per = s.per_slot || 1;
  const free = s.free_carry || 0;
  const used = s.slots_used || 0;
  return Math.max(0, Math.ceil(Math.max(0, qty - free) / per)) * used;
}

/** `{ uuid, name, item }` for a stored UUID; unresolved keeps the string. */
function chip(uuid, doc) {
  if (!uuid) return null;
  if (!doc) return { uuid, name: uuidTail(uuid), item: null, unresolved: true };
  return { uuid, name: doc.name, item: doc };
}

/**
 * Read an actor into plain data plus the compendium documents it points at.
 *
 * @param {Actor} actor
 * @param {object} [deps]  test seams: `fromUuid`, `loadSpells` (the spell index)
 * @returns {Promise<{snapshot: object, resolved: object}>}
 */
export async function loadActorSnapshot(actor, deps = {}) {
  const resolveUuid = deps.fromUuid ?? ((u) => globalThis.fromUuid(u));
  const load = (uuid) => (uuid ? Promise.resolve(resolveUuid(uuid)).catch(() => null) : Promise.resolve(null));

  const sys = structuredClone(actor._source.system ?? {});
  const items = structuredClone(actor.toObject().items ?? []);

  const [ancestry, cls, background, deity, patron] = await Promise.all(
    [sys.ancestry, sys.class, sys.background, sys.deity, sys.patron].map(load),
  );

  // The spell index is only needed to give held spells a compendium entry.
  let spellPool = [];
  if (items.some((i) => i.type === "Spell")) {
    const loadSpells = deps.loadSpells ?? (() => globalThis.shadowdark.compendiums.spells());
    spellPool = Array.from(await Promise.resolve(loadSpells()).catch(() => []))
      .map((s) => ({ uuid: s.uuid, name: s.name, tier: s.system?.tier, class: asArray(s.system?.class) }));
  }

  const defaultArt = deps.defaultArt ?? [
    globalThis.Actor?.implementation?.DEFAULT_ICON,
    globalThis.CONST?.DEFAULT_TOKEN,
    ...Object.values(globalThis.CONFIG?.SHADOWDARK?.DEFAULTS?.ACTOR_IMAGES ?? {}),
  ].filter(Boolean);

  return {
    snapshot: {
      actorId: actor.id,
      name: actor.name ?? "",
      img: actor.img ?? null,
      tokenImg: actor.prototypeToken?.texture?.src ?? null,
      defaultArt,
      system: sys,
      items,
    },
    resolved: { ancestry, class: cls, background, deity, patron, spellPool },
  };
}

/**
 * A fresh id for one builder session. Foundry's own randomID, never
 * crypto.randomUUID: that only exists in secure contexts and this world is served
 * over plain http. The Math.random fallback is for Node tests; it only has to
 * differ between opens, not be unguessable.
 */
const newSessionId = () => globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2, 10);

/** Match a held spell to a compendium entry; null when nothing fits. */
function matchSpell(item, spellPool, classUuids) {
  const linked = sourceUuidOf(item);
  if (linked) return linked;
  const wanted = String(item.name ?? "").toLowerCase();
  const byName = spellPool.filter((s) => String(s.name).toLowerCase() === wanted);
  const ofClass = byName.filter((s) => s.class.some((c) => classUuids.includes(c)));
  return (ofClass[0] ?? null)?.uuid ?? null;
}

/**
 * Build a CharBuilderState from a snapshot. Returns null for a BLANK actor (no
 * class, no ancestry, no items): that keeps today's fresh-build-onto-actor flow.
 *
 * @param {object} snapshot  from loadActorSnapshot
 * @param {object} [resolved]  the documents the snapshot's UUIDs resolve to
 *   (missing or null = the compendium is gone; the UUID string is kept)
 * @returns {CharBuilderState|null}
 */
export function hydrateState(snapshot, resolved = {}) {
  const sys = snapshot.system ?? {};
  const items = snapshot.items ?? [];
  if (!sys.class && !sys.ancestry && items.length === 0) return null;

  const level = Number(sys.level?.value) || 0;
  const st = new CharBuilderState({ level0: level === 0 && !sys.class });
  st.level = Math.max(1, level);
  st.name = snapshot.name ?? "";
  st.alignment = sys.alignment || "neutral";

  const isDefault = (src) => !src || (snapshot.defaultArt ?? []).includes(src);
  st.art = {
    portrait: isDefault(snapshot.img) ? null : snapshot.img,
    token: isDefault(snapshot.tokenImg) ? null : snapshot.tokenImg,
  };

  // Base values from _source; a 'manual' method keeps the stats step from
  // resetting them to a legal spread.
  const abilities = Object.fromEntries(ABILITY_ORDER.map((k) => [k, Number(sys.abilities?.[k]?.value ?? 10)]));
  st.stats = {
    method: "manual",
    pool: [],
    values: { ...abilities },
    assignment: Object.fromEntries(ABILITY_ORDER.map((k) => [k, null])),
  };

  st.ancestry = chip(sys.ancestry, resolved.ancestry);
  st.class = chip(sys.class, resolved.class);
  st.background = chip(sys.background, resolved.background);
  st.deity = chip(sys.deity, resolved.deity);
  st.patron = chip(sys.patron, resolved.patron);

  // Base max only: talent HP bonuses re-apply from the embedded talents, and
  // the dice were never stored.
  const hpMax = Number(sys.attributes?.hp?.max) || 0;
  st.hp = { max: hpMax, bonus: 0, hydrated: true };

  // Current wealth, not starting gold: the gold step must not roll over it.
  const coins = { gp: Number(sys.coins?.gp) || 0, sp: Number(sys.coins?.sp) || 0, cp: Number(sys.coins?.cp) || 0 };
  st.coins = { ...coins };
  st.goldRolled = true;
  st.languages = [...asArray(sys.languages)];

  const spellClass = resolved.class?.system?.spellcasting?.class;
  const classUuids = [sys.class, spellClass].filter((c) => c && c !== "__not_spellcaster__");

  const gearRows = [];
  const spellRows = [];
  const kept = [];
  for (const item of items) {
    const id = item._id;
    if (!id) { kept.push({ id: null, type: item.type, name: item.name }); continue; }
    if (PHYSICAL_TYPES.has(item.type)) {
      const qty = Number(item.system?.quantity) || 1;
      gearRows.push({
        rowId: id, itemId: id, owned: true,
        uuid: sourceUuidOf(item), name: item.name, img: item.img, type: item.type,
        qty, costCp: 0, magic: !!item.system?.magicItem, slots: slotsFor(item.system, qty),
      });
    } else if (item.type === "Spell") {
      spellRows.push({
        itemId: id, uuid: matchSpell(item, resolved.spellPool ?? [], classUuids),
        name: item.name, tier: Number(item.system?.tier) || 1,
      });
    } else {
      kept.push({ id, type: item.type, name: item.name });
    }
  }
  st.gear = gearRows;
  st.spells = spellRows.map((s) => ({ ...s }));

  st.existing = {
    actorId: snapshot.actorId,
    sessionId: snapshot.sessionId ?? newSessionId(),
    baseline: {
      name: st.name,
      alignment: st.alignment,
      background: sys.background || null,
      deity: sys.deity || null,
      ancestry: sys.ancestry || null,
      class: sys.class || null,
      patron: sys.patron || null,
      level,
      xp: Number(sys.level?.xp) || 0,
      abilities,
      hp: { max: hpMax, value: Number(sys.attributes?.hp?.value) || 0 },
      coinsCp: coins.gp * 100 + coins.sp * 10 + coins.cp,
      languages: [...st.languages],
      art: { ...st.art },
    },
    gearRows: gearRows.map((g) => ({ itemId: g.itemId, name: g.name, type: g.type, qty: g.qty })),
    spellRows: spellRows.map((s) => ({ ...s })),
    kept,
    frozenLevel: level,
  };
  return st;
}

/** Plain summary of what a state hydrated and what stays untouched. */
export function summarizeHydration(st) {
  if (!st) return null;
  const chipName = (c) => (c ? `${c.name}${c.unresolved ? " (unresolved)" : ""}` : null);
  return {
    name: st.name,
    level: st.existing.baseline.level,
    level0: st.level0,
    alignment: st.alignment,
    ancestry: chipName(st.ancestry),
    class: chipName(st.class),
    background: chipName(st.background),
    deity: chipName(st.deity),
    patron: chipName(st.patron),
    abilities: { ...st.stats.values },
    hpMax: st.hp.max,
    coinsCp: st.existing.baseline.coinsCp,
    languages: st.languages.length,
    gear: st.gear.map((g) => `${g.name} x${g.qty} [${g.type}]`),
    spells: st.spells.map((s) => `${s.name} (tier ${s.tier})${s.uuid ? "" : " [no compendium match]"}`),
    kept: st.existing.kept.map((k) => `${k.name} [${k.type}]`),
  };
}

/**
 * Read-only console helper: prints what the builder would hydrate from `actor`
 * and what it would keep as-is. Writes nothing.
 *
 * @returns {Promise<object|null>} the summary; null for a blank actor
 */
export async function describeActor(actor) {
  const { snapshot, resolved } = await loadActorSnapshot(actor);
  const summary = summarizeHydration(hydrateState(snapshot, resolved));
  if (!summary) {
    console.log(`shadowdark-enhancer | ${actor.name}: blank actor, the builder would start a fresh build.`);
    return null;
  }
  console.group(`shadowdark-enhancer | ${actor.name}: what the builder would hydrate`);
  console.log(summary);
  console.groupEnd();
  return summary;
}
