const MODULE_ID = "shadowdark-enhancer";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])]),
  );
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function withoutLibraryFlags(value) {
  const flags = stableValue(value ?? {});
  if (flags?.[MODULE_ID]?.monsterSpell) {
    delete flags[MODULE_ID].monsterSpell;
    if (!Object.keys(flags[MODULE_ID]).length) delete flags[MODULE_ID];
  }
  return flags;
}

function spellContent(item) {
  return stableValue({
    name: String(item?.name ?? "").trim(),
    type: "Spell",
    img: item?.img ?? null,
    system: item?.system ?? {},
    effects: item?.effects ?? [],
    flags: withoutLibraryFlags(item?.flags),
  });
}

function spellDefinition(content) {
  return {
    name: content?.name ?? "",
    type: "Spell",
    img: content?.img ?? null,
    system: content?.system ?? {},
    effects: content?.effects ?? [],
    flags: withoutLibraryFlags(content?.flags),
  };
}

function sourceRef(actor, item) {
  const itemId = item?._id ?? item?.id ?? "";
  return {
    actorName: String(actor?.name ?? "").trim(),
    actorUuid: String(actor?.uuid ?? ""),
    itemId: String(itemId),
    itemUuid: actor?.uuid && itemId ? `${actor.uuid}.Item.${itemId}` : "",
    sourcePack: String(actor?.sourcePack ?? ""),
    sourceLabel: String(actor?.sourceLabel ?? ""),
    sourceVersion: String(actor?.sourceVersion ?? ""),
    systemVersion: String(actor?.systemVersion ?? actor?.sourceVersion ?? ""),
    coreVersion: String(actor?.coreVersion ?? ""),
    moduleVersion: String(actor?.moduleVersion ?? ""),
  };
}

export function validateMonsterSpell(item) {
  const warnings = [];
  const description = String(item?.system?.description ?? "").replace(/<[^>]*>/g, " ");
  const statedDc = description.match(/\bDC\s*(\d+)\b/i);
  const tier = Number(item?.system?.tier);
  if (statedDc && Number.isFinite(tier)) {
    const stated = Number(statedDc[1]);
    const derived = tier + 10;
    if (stated !== derived) {
      warnings.push({
        code: "dc-tier-mismatch",
        message: `Description says DC ${stated}, but tier ${tier} derives DC ${derived}.`,
      });
    }
  }

  const withoutInlineRolls = description.replace(/\[\[[^\]]+\]\]/g, " ");
  const proseDice = [...withoutInlineRolls.matchAll(/\b\d+d\d+\b/gi)].map(match => match[0]);
  if (proseDice.length) {
    warnings.push({
      code: "unenriched-dice",
      message: `Description contains non-clickable dice: ${[...new Set(proseDice)].join(", ")}.`,
    });
  }

  const statedDuration = description.match(/\b(?:for\s+)?(\d+d\d+|\d+)\s+(rounds?|turns?|days?)\b/i);
  const duration = item?.system?.duration ?? {};
  if (statedDuration) {
    const statedType = `${statedDuration[2].toLocaleLowerCase().replace(/s$/, "")}s`;
    if (duration.type !== statedType || String(duration.value) !== statedDuration[1]) {
      warnings.push({
        code: "duration-mismatch",
        message: `Description says ${statedDuration[1]} ${statedType}, but structured duration is ${duration.type || "unset"} ${duration.value ?? ""}.`.trim(),
      });
    }
  }

  if (/\bdamage\b/i.test(description) && /\b\d+d\d+\b/i.test(description) && !String(item?.system?.formula ?? "").trim()) {
    warnings.push({
      code: "missing-damage-formula",
      message: "Description contains damage dice, but the spell has no structured formula.",
    });
  }
  return warnings;
}

function normalizedSystemForMaterializedFingerprint(system) {
  const normalized = stableValue(system ?? {});
  if (normalized.formula == null) normalized.formula = "";
  if (normalized.duration?.type === "instant"
    && ["-1", "1"].includes(String(normalized.duration.value))) {
    normalized.duration.value = "1";
  }
  return normalized;
}

function materializedContent(data) {
  return stableValue({
    name: String(data?.name ?? "").trim(),
    type: "Spell",
    img: data?.img ?? null,
    system: normalizedSystemForMaterializedFingerprint(data?.system),
    effects: data?.effects ?? [],
    flags: withoutLibraryFlags(data?.flags),
  });
}

function legacyMaterializedContent(data) {
  return stableValue({
    name: String(data?.name ?? "").trim(),
    type: "Spell",
    img: data?.img ?? null,
    system: data?.system ?? {},
    effects: data?.effects ?? [],
  });
}

export function legacyMonsterSpellMaterializedFingerprint(data) {
  return fnv1a32(stableStringify(legacyMaterializedContent(data)));
}

function isUntouchedGeneratedDocument(document, provenance, desiredData) {
  const currentFingerprint = fnv1a32(stableStringify(materializedContent(document)));
  if (currentFingerprint === provenance?.materializedFingerprint) return true;
  const legacyCurrentMatches = legacyMonsterSpellMaterializedFingerprint(document)
    === provenance?.materializedFingerprint;
  const legacyDesiredMatches = legacyMonsterSpellMaterializedFingerprint(desiredData)
    === provenance?.materializedFingerprint;
  const desiredFingerprint = fnv1a32(stableStringify(materializedContent(desiredData)));
  if (!legacyCurrentMatches && !(legacyDesiredMatches && currentFingerprint === desiredFingerprint)) {
    return false;
  }
  return stableStringify(withoutLibraryFlags(document?.flags))
    === stableStringify(withoutLibraryFlags(desiredData?.flags));
}

function libraryIdFor(entry) {
  if (entry?.libraryId) return entry.libraryId;
  const primary = entry?.sources?.[0];
  return fnv1a32(`${String(entry?.originalName ?? "").toLocaleLowerCase()}|${primary?.itemUuid ?? ""}`);
}

export function materializeMonsterSpell(entry, { folder = null } = {}) {
  const data = {
    ...stableValue(entry?.data ?? {}),
    name: entry?.name ?? entry?.originalName ?? "Monster Spell",
    type: "Spell",
  };
  if (folder) data.folder = folder;
  const materializedFingerprint = fnv1a32(stableStringify(materializedContent(data)));
  data.flags = {
    ...(data.flags ?? {}),
    [MODULE_ID]: {
      ...(data.flags?.[MODULE_ID] ?? {}),
      monsterSpell: {
        generated: true,
        libraryId: libraryIdFor(entry),
        originalName: entry?.originalName ?? entry?.name ?? "",
        sourceFingerprint: entry?.fingerprint ?? "",
        materializedFingerprint,
        variant: entry?.variant === true,
        sources: stableValue(entry?.sources ?? []),
        warnings: stableValue(entry?.warnings ?? []),
      },
    },
  };
  return data;
}

export function normalizeMonsterSpellAttachment(data) {
  const copy = stableValue(data ?? {});
  const provenance = copy.flags?.[MODULE_ID]?.monsterSpell;
  if (!provenance?.generated) return copy;
  copy.name = provenance.originalName || copy.name;
  copy.flags = withoutLibraryFlags(copy.flags);
  return copy;
}

function mergeSourceRefs(desiredSources = [], existingSources = [], refreshedPacks = new Set()) {
  const retainedExisting = refreshedPacks.size
    ? existingSources.filter(source => !refreshedPacks.has(source.sourcePack))
    : existingSources;
  const byUuid = new Map(retainedExisting.map(source => [source.itemUuid, source]));
  for (const source of desiredSources) byUuid.set(source.itemUuid, source);
  return [...byUuid.values()].sort((left, right) => (
    left.actorName.localeCompare(right.actorName)
    || left.actorUuid.localeCompare(right.actorUuid)
    || left.itemId.localeCompare(right.itemId)
  ));
}

function sourceSemanticKey(source, originalName) {
  return [source?.sourcePack, source?.actorName, originalName]
    .map(value => String(value ?? "").trim().toLocaleLowerCase())
    .join("|");
}

function comparableProvenance(provenance) {
  return stableValue({
    generated: provenance?.generated === true,
    libraryId: provenance?.libraryId ?? "",
    originalName: provenance?.originalName ?? "",
    sourceFingerprint: provenance?.sourceFingerprint ?? "",
    variant: provenance?.variant === true,
    sources: provenance?.sources ?? [],
    warnings: provenance?.warnings ?? [],
  });
}

export function planMonsterSpellRefresh(entries = [], existingDocuments = [], {
  refreshedSourcePacks = [],
} = {}) {
  const refreshedPacks = new Set(refreshedSourcePacks);
  const existingById = new Map();
  const existingBySourceItem = new Map();
  const existingBySemanticSource = new Map();
  for (const document of existingDocuments) {
    const provenance = document?.flags?.[MODULE_ID]?.monsterSpell;
    if (!provenance?.generated || !provenance.libraryId) continue;
    const existing = { document, provenance };
    existingById.set(provenance.libraryId, existing);
    for (const source of provenance.sources ?? []) {
      if (source?.itemUuid) {
        const matches = existingBySourceItem.get(source.itemUuid) ?? [];
        matches.push(existing);
        existingBySourceItem.set(source.itemUuid, matches);
      }
      const semanticKey = sourceSemanticKey(source, provenance.originalName);
      const semanticMatches = existingBySemanticSource.get(semanticKey) ?? [];
      semanticMatches.push(existing);
      existingBySemanticSource.set(semanticKey, semanticMatches);
    }
  }

  const plan = {
    create: [], update: [], metadataUpdate: [], unchanged: [], conflict: [], stale: [],
  };
  const matchedIds = new Set();
  for (const originalEntry of entries) {
    let entry = originalEntry;
    let data = materializeMonsterSpell(entry);
    let provenance = data.flags[MODULE_ID].monsterSpell;
    let existing = existingById.get(provenance.libraryId);
    if (existing && matchedIds.has(existing.provenance.libraryId)) existing = null;

    if (!existing) {
      let candidates = entry.sources
        .flatMap(source => existingBySourceItem.get(source.itemUuid) ?? [])
        .filter(candidate => !matchedIds.has(candidate.provenance.libraryId));
      if (!candidates.length) {
        candidates = entry.sources
          .flatMap(source => existingBySemanticSource.get(
            sourceSemanticKey(source, entry.originalName),
          ) ?? [])
          .filter(candidate => !matchedIds.has(candidate.provenance.libraryId));
      }
      candidates = [...new Map(
        candidates.map(candidate => [candidate.provenance.libraryId, candidate]),
      ).values()]
        .sort((left, right) => (
          Number(right.provenance.sourceFingerprint === entry.fingerprint)
          - Number(left.provenance.sourceFingerprint === entry.fingerprint)
          || left.provenance.libraryId.localeCompare(right.provenance.libraryId)
        ));
      existing = candidates[0] ?? null;
      if (existing) {
        entry = { ...entry, libraryId: existing.provenance.libraryId };
        data = materializeMonsterSpell(entry);
        provenance = data.flags[MODULE_ID].monsterSpell;
      }
    }

    if (existing && refreshedPacks.size
      && existing.provenance.sourceFingerprint !== entry.fingerprint) {
      const retainedSources = (existing.provenance.sources ?? [])
        .filter(source => !refreshedPacks.has(source.sourcePack));
      if (retainedSources.length) {
        const desiredActor = entry.sources[0]?.actorName || "Unknown Source";
        const retainedActor = retainedSources[0]?.actorName || "Unknown Source";
        const actorNamesCollide = desiredActor === retainedActor;
        const qualify = (originalName, source) => {
          const actorName = source?.actorName || "Unknown Source";
          if (!actorNamesCollide) return `${originalName} — ${actorName}`;
          return `${originalName} — ${actorName} (${source?.sourceLabel || source?.sourcePack || "Source"})`;
        };
        entry = {
          ...entry,
          variant: true,
          name: qualify(entry.originalName, entry.sources[0]),
        };
        data = materializeMonsterSpell(entry);
        plan.create.push({ entry, data });

        const retainedEntry = {
          data: {
            ...materializedContent(existing.document),
            name: existing.provenance.originalName || entry.originalName,
          },
          fingerprint: existing.provenance.sourceFingerprint,
          libraryId: existing.provenance.libraryId,
          name: qualify(
            existing.provenance.originalName || entry.originalName,
            retainedSources[0],
          ),
          originalName: existing.provenance.originalName || entry.originalName,
          sources: retainedSources,
          variant: true,
          warnings: existing.provenance.warnings ?? [],
        };
        const retainedData = materializeMonsterSpell(retainedEntry);
        const currentFingerprint = fnv1a32(stableStringify(materializedContent(existing.document)));
        if (currentFingerprint === existing.provenance.materializedFingerprint) {
          plan.update.push({ entry: retainedEntry, document: existing.document, data: retainedData });
        } else {
          plan.metadataUpdate.push({
            document: existing.document,
            provenance: retainedData.flags[MODULE_ID].monsterSpell,
          });
          plan.conflict.push({ entry: retainedEntry, document: existing.document, data: retainedData });
        }
        matchedIds.add(existing.provenance.libraryId);
        continue;
      }
    }

    if (!existing) {
      plan.create.push({ entry, data });
      continue;
    }
    matchedIds.add(existing.provenance.libraryId);

    entry = {
      ...entry,
      libraryId: existing.provenance.libraryId,
      sources: mergeSourceRefs(entry.sources, existing.provenance.sources, refreshedPacks),
    };
    data = materializeMonsterSpell(entry);
    provenance = data.flags[MODULE_ID].monsterSpell;

    const currentIsGenerated = isUntouchedGeneratedDocument(
      existing.document,
      existing.provenance,
      data,
    );
    const desiredIsCurrent = provenance.materializedFingerprint === existing.provenance.materializedFingerprint;
    const provenanceIsCurrent = stableStringify(comparableProvenance(provenance))
      === stableStringify(comparableProvenance(existing.provenance));
    if (currentIsGenerated && desiredIsCurrent && provenanceIsCurrent) {
      plan.unchanged.push({ entry, document: existing.document, data });
    } else if (currentIsGenerated) {
      plan.update.push({ entry, document: existing.document, data });
    } else {
      plan.conflict.push({ entry, document: existing.document, data });
    }
  }

  for (const [libraryId, existing] of existingById) {
    if (!matchedIds.has(libraryId)) plan.stale.push(existing);
  }
  return plan;
}

export function collectMonsterSpells(actors = []) {
  const byFingerprint = new Map();

  for (const actor of actors) {
    for (const item of actor?.items ?? []) {
      if (item?.type !== "Spell") continue;
      const content = spellContent(item);
      const fingerprint = fnv1a32(stableStringify(spellDefinition(content)));
      let entry = byFingerprint.get(fingerprint);
      if (!entry) {
        entry = {
          name: content.name,
          originalName: content.name,
          fingerprint,
          data: content,
          sources: [],
          warnings: validateMonsterSpell(content),
        };
        byFingerprint.set(fingerprint, entry);
      }
      entry.sources.push(sourceRef(actor, item));
    }
  }

  const entries = [...byFingerprint.values()].map(entry => ({
    ...entry,
    sources: entry.sources.sort((left, right) => (
      left.actorName.localeCompare(right.actorName)
      || left.actorUuid.localeCompare(right.actorUuid)
      || left.itemId.localeCompare(right.itemId)
    )),
  }));
  const variantCounts = new Map();
  for (const entry of entries) {
    const key = entry.originalName.toLocaleLowerCase();
    variantCounts.set(key, (variantCounts.get(key) ?? 0) + 1);
  }

  const namedEntries = entries.map(entry => {
    const variant = variantCounts.get(entry.originalName.toLocaleLowerCase()) > 1;
    return {
      ...entry,
      variant,
      name: variant
        ? `${entry.originalName} — ${entry.sources[0]?.actorName || "Unknown Source"}`
        : entry.originalName,
    };
  });
  const displayCounts = new Map();
  for (const entry of namedEntries) {
    displayCounts.set(entry.name, (displayCounts.get(entry.name) ?? 0) + 1);
  }
  const tierNamed = namedEntries.map(entry => ({
    ...entry,
    name: displayCounts.get(entry.name) > 1
      ? `${entry.name} (Tier ${entry.data?.system?.tier ?? "?"})`
      : entry.name,
  }));
  const tierCounts = new Map();
  for (const entry of tierNamed) {
    tierCounts.set(entry.name, (tierCounts.get(entry.name) ?? 0) + 1);
  }

  return tierNamed
    .map(entry => ({
      ...entry,
      name: tierCounts.get(entry.name) > 1
        ? `${entry.name} [${entry.sources[0]?.itemId || entry.fingerprint}]`
        : entry.name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export { MODULE_ID as MONSTER_SPELL_LIBRARY_MODULE_ID };
