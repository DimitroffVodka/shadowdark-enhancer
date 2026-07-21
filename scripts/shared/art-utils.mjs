/**
 * Shadowdark Enhancer — Art Utilities
 * Shared helpers for resolving actor portrait and token images across
 * world and compendium sources.
 */

/**
 * Heuristic: is this image path one of Foundry's built-in placeholder
 * icons (mystery-man, cowled-figure, etc.)? Used by token placement to
 * skip past placeholders when picking the best available texture from
 * compendium-actor / world-actor / portrait sources.
 *
 * Everything under `icons/svg/` in core Foundry is a monochrome line
 * icon meant as a fallback, so we treat that whole tree as
 * "placeholder" art for token-rendering purposes. CONST.DEFAULT_TOKEN
 * covers any future renamed default.
 *
 * @param {string|undefined|null} src
 * @returns {boolean}
 */
export function _isPlaceholderArt(src) {
  if (!src) return true;
  if (src === CONST.DEFAULT_TOKEN) return true;
  // Core Foundry placeholder line-icons.
  if (src.startsWith("icons/svg/")) return true;
  // Shadowdark system's "cowled hooded figure" placeholder set — used
  // as the default portrait/token for NPCs without authored art. Three
  // color variants exist (default, _red for compendium, _green for
  // players), all conveying "no real image set yet".
  if (src.startsWith("systems/shadowdark/assets/tokens/cowled_token")) return true;
  return false;
}

/**
 * Return the first non-placeholder src from the candidates list, or
 * null if every candidate is a placeholder.
 *
 * @param {Array<string|undefined|null>} candidates
 * @returns {string|null}
 */
export function _firstNonPlaceholder(candidates) {
  for (const c of candidates) {
    if (!_isPlaceholderArt(c)) return c;
  }
  return null;
}

/**
 * Look up the compendiumArt mapping for a given actor, if any module
 * provides one (e.g. shadowdark-community-tokens). Mappings are
 * applied at RENDER time by Foundry, NOT to direct property reads —
 * so `actor.img` on a mapped compendium actor still returns the raw
 * stored placeholder. This lookup gives us the mapped values
 * explicitly so we can use them for our own token-placement art.
 *
 * @param {Actor} actor — must be a compendium actor (with .pack set)
 * @returns {{actor: string, token: object} | null}
 */
export function _getCompendiumArtFor(actor) {
  if (!actor?.uuid) return null;
  // game.compendiumArt is a v12+ Map keyed by document UUID.
  const art = game.compendiumArt?.get?.(actor.uuid);
  return art ?? null;
}

/**
 * Cache for name → compendium UUID lookups. Cleared on session reload
 * since game.packs membership can change at runtime (modules
 * enabled/disabled, packs added). `null` cached for misses so we
 * don't re-scan every time the same lookup fails.
 */
const _nameToCompendiumUuid = new Map();

/**
 * Find an actor in any compendium pack by its exact name.
 * 
 * @param {string} name
 * @returns {Promise<string|null>} the actor's UUID or null
 */
export async function _findCompendiumActorByName(name) {
  if (!name) return null;
  if (_nameToCompendiumUuid.has(name)) return _nameToCompendiumUuid.get(name);

  for (const pack of game.packs) {
    if (pack.documentName !== "Actor") continue;
    try {
      const index = await pack.getIndex({ fields: ["type"] });
      // Match same name AND NPC type when type is in the index.
      // Some pack indices don't include `type` — fall back to any
      // actor with the matching name.
      const entry = index.find(e =>
        e.name === name && (e.type === "NPC" || !e.type)
      );
      if (entry) {
        const uuid = `Compendium.${pack.collection}.Actor.${entry._id}`;
        _nameToCompendiumUuid.set(name, uuid);
        return uuid;
      }
    } catch (_) {
      // Skip this pack if its index fails to load.
    }
  }
  _nameToCompendiumUuid.set(name, null);
  return null;
}

/**
 * Resolve the best available portrait + token-texture art for an
 * actor, regardless of whether it lives in the world or a compendium.
 *
 * For world actors that were imported from a compendium (Foundry
 * tracks this via `actor._stats.compendiumSource`), if the world
 * copy's `img` or `prototypeToken.texture.src` is a placeholder, we
 * fall through to the compendium source — including any
 * compendiumArtMappings (e.g. shadowdark-community-tokens). This
 * fixes the case where a pre-existing world copy was imported with
 * placeholder art (before the mapping module loaded) and the user
 * never repaired it manually.
 *
 * @param {Actor} actor
 * @returns {Promise<{img: string|null, tokenSrc: string|null}>}
 */
export async function _bestArtForActor(actor) {
  let img      = actor?.img ?? null;
  let tokenSrc = actor?.prototypeToken?.texture?.src ?? null;

  // Already non-placeholder? Nothing to look up.
  if (!_isPlaceholderArt(img) && !_isPlaceholderArt(tokenSrc)) {
    return { img, tokenSrc };
  }

  // Source lookup priority:
  //   1. actor._stats.compendiumSource (Foundry v12+ on imported-from-
  //      compendium actors)
  //   2. actor.flags.core.sourceId (v11 fallback)
  //   3. Name match against any installed Actor compendium pack —
  //      handles user-created world actors that mirror a bestiary
  //      entry by name without a formal import link.
  let sourceUuid = actor?._stats?.compendiumSource
                ?? actor?.flags?.core?.sourceId
                ?? null;
  if (!sourceUuid && actor?.name) {
    sourceUuid = await _findCompendiumActorByName(actor.name);
  }
  if (!sourceUuid) return { img, tokenSrc };

  const compendiumActor = await fromUuid(sourceUuid).catch(() => null);
  const compendiumArt   = compendiumActor ? _getCompendiumArtFor(compendiumActor) : null;

  if (_isPlaceholderArt(img)) {
    img = _firstNonPlaceholder([
      compendiumArt?.actor,
      compendiumActor?.img,
    ]) ?? img;
  }
  if (_isPlaceholderArt(tokenSrc)) {
    tokenSrc = _firstNonPlaceholder([
      compendiumArt?.token?.texture?.src,
      compendiumActor?.prototypeToken?.texture?.src,
    ]) ?? tokenSrc;
  }

  return { img, tokenSrc };
}
