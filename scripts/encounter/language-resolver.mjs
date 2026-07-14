/**
 * Language names → system UUIDs, shared by the ancestry commit path and the
 * class builder (the char-builder consumes languages.fixed/selectOptions as
 * UUIDs). Entries that already look like UUIDs pass through; unknown names are
 * kept as-is so the caller's warning surface can report them.
 */
export async function resolveLanguageNames(names) {
  const list = Array.isArray(names) ? names : [];
  if (!list.length || !list.some((f) => !/^Compendium\./.test(String(f)))) return list;
  const byName = {};
  for (const getter of ["commonLanguages", "rareLanguages"]) {
    try { for (const d of await shadowdark.compendiums[getter]()) byName[d.name.toLowerCase()] = d.uuid; }
    catch (_e) { /* language pack unavailable — keep names */ }
  }
  return list.map((f) => (/^Compendium\./.test(String(f)) ? f : (byName[String(f).toLowerCase()] ?? f)));
}
