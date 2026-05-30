/**
 * Shadowdark Enhancer — shared NPC index
 *
 * Converts Shadowdark NPC actors into a compact, browse-friendly row
 * model. This intentionally uses Shadowdark-native stats (level, HP,
 * AC, movement, attacks, features) rather than Vagabond's TL model.
 */

const DEFAULT_IMG = "icons/svg/mystery-man.svg";

export function createNpcIndexRow(actor, {
  sourceId = "",
  sourceLabel = "",
} = {}) {
  const sys = actor?.system ?? {};
  const items = _itemsArray(actor?.items);
  const level = coerceLevel(sys.level);
  const hp = coerceHP(sys.attributes?.hp);
  const hpMax = coerceHPMax(sys.attributes?.hp, hp);
  const ac = _finiteNumber(sys.attributes?.ac?.value, 10);
  const alignmentLabel = _normalizeAlignmentLabel(sys.alignment);
  const alignment = _alignmentCode(alignmentLabel);
  const move = sys.move ?? "";
  const moveNote = String(sys.moveNote ?? "").trim();

  const attackData = _summarizeAttacks(items);
  const featureNames = items
    .filter(it => it?.type === "NPC Feature" && it.name)
    .map(it => it.name);
  const hasSpellcasting = Number(sys.spellcasting?.attacks ?? 0) > 0;
  const spellcastingBonus = _finiteNumber(sys.spellcasting?.bonus, 0);
  const darkAdapted = !!sys.darkAdapted;
  const traits = [
    ...featureNames,
    ...(hasSpellcasting ? ["Spellcaster"] : []),
    ...(darkAdapted ? ["Dark-Adapted"] : []),
  ];

  return {
    uuid: actor?.uuid,
    id: actor?.id,
    name: actor?.name ?? "Unknown",
    img: actor?.img ?? DEFAULT_IMG,
    level,
    levelLabel: Number.isFinite(level) ? String(level) : "--",
    alignment,
    alignmentLabel,
    hp,
    hpMax,
    hpLabel: hpMax > hp ? `${hp}/${hpMax}` : String(hp),
    ac,
    acLabel: String(ac),
    move,
    moveNote,
    moveLabel: moveNote ? `${move} (${moveNote})` : (move || "--"),
    darkAdapted,
    hasSpellcasting,
    spellcastingBonus,
    featureNames,
    traitCount: traits.length,
    traitSummary: traits.length ? traits.join(", ") : "--",
    traitPreview: _previewList(traits, 3),
    traits,
    sourceId,
    sourceLabel,
    ...attackData,
  };
}

export function filterNpcIndexRows(rows, {
  search = "",
  alignment = [],
  levelMin = null,
  levelMax = null,
  hpMin = null,
  hpMax = null,
  acMin = null,
  acMax = null,
  moves = [],
  darkAdapted = false,
  hasSpellcasting = false,
  abilitySearch = "",
  attackKinds = [],
} = {}) {
  const needle = search.trim().toLowerCase();
  const abilityNeedle = abilitySearch.trim().toLowerCase();
  return rows.filter(r => {
    if (needle && !String(r.name ?? "").toLowerCase().includes(needle)) return false;
    if (alignment.length && !alignment.includes(r.alignment)) return false;
    if (levelMin != null && Number.isFinite(r.level) && r.level < levelMin) return false;
    if (levelMax != null && Number.isFinite(r.level) && r.level > levelMax) return false;
    if (hpMin != null && Number.isFinite(r.hp) && r.hp < hpMin) return false;
    if (hpMax != null && Number.isFinite(r.hp) && r.hp > hpMax) return false;
    if (acMin != null && Number.isFinite(r.ac) && r.ac < acMin) return false;
    if (acMax != null && Number.isFinite(r.ac) && r.ac > acMax) return false;
    if (moves.length && !moves.includes(r.move)) return false;
    if (darkAdapted && !r.darkAdapted) return false;
    if (hasSpellcasting && !r.hasSpellcasting) return false;
    if (attackKinds.length && !attackKinds.some(k => r.attackKinds?.[k])) return false;
    if (abilityNeedle) {
      const names = r.featureNames ?? [];
      const hit = names.some(n => String(n).toLowerCase().includes(abilityNeedle));
      if (!hit) return false;
    }
    return true;
  });
}

export function sortNpcIndexRows(rows, { column = "name", ascending = true } = {}) {
  const numeric = ["level", "hp", "hpMax", "ac", "attackCount", "attackBonus", "dpr", "traitCount"].includes(column);
  rows.sort((a, b) => {
    const av = a[column];
    const bv = b[column];
    if (numeric) {
      const aNaN = !Number.isFinite(av);
      const bNaN = !Number.isFinite(bv);
      if (aNaN && bNaN) return 0;
      if (aNaN) return 1;
      if (bNaN) return -1;
      const cmp = av - bv;
      return ascending ? cmp : -cmp;
    }
    const cmp = String(av ?? "").localeCompare(String(bv ?? ""));
    return ascending ? cmp : -cmp;
  });
  return rows;
}

export function coerceLevel(raw) {
  let value = raw;
  if (value && typeof value === "object" && "value" in value) value = value.value;
  if (value === null || value === undefined || value === "" || value === "--") return NaN;
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

export function coerceHP(hp) {
  if (!hp) return 0;
  return _finiteNumber(hp.value ?? hp.max, 0);
}

function coerceHPMax(hp, fallback) {
  if (!hp) return fallback;
  return _finiteNumber(hp.max ?? hp.value, fallback);
}

function _summarizeAttacks(items) {
  const attacks = [];
  let specialCount = 0;
  const attackKinds = { melee: false, ranged: false, special: false };

  for (const item of items) {
    if (item?.type === "NPC Special Attack") {
      specialCount += 1;
      attackKinds.special = true;
      continue;
    }
    if (item?.type !== "NPC Attack") continue;
    const ranges = Array.isArray(item.system?.ranges) ? item.system.ranges : [];
    const num = Math.max(1, _finiteNumber(item.system?.attack?.num, 1));
    const bonus = _finiteNumber(item.system?.bonuses?.attackBonus, 0);
    const damage = String(item.system?.damage?.value ?? "").trim();
    const special = String(item.system?.damage?.special ?? item.system?.description ?? "").trim();
    if (ranges.includes("close")) attackKinds.melee = true;
    if (ranges.some(r => r === "near" || r === "far" || r === "nearLine")) attackKinds.ranged = true;
    attacks.push({
      name: item.name ?? "Attack",
      num,
      bonus,
      damage,
      special,
      ranges,
    });
  }

  const attackCount = attacks.reduce((sum, a) => sum + a.num, 0) + specialCount;
  const dpr = attacks.reduce((best, a) => Math.max(best, a.num * averageDice(a.damage)), 0);
  const primary = attacks[0] ?? null;
  const attackBonus = attacks.reduce((best, a) => Math.max(best, a.bonus), Number.NEGATIVE_INFINITY);
  const primaryBits = [];
  if (primary) {
    primaryBits.push(`x${primary.num}`);
    primaryBits.push(`${primary.bonus >= 0 ? "+" : ""}${primary.bonus}`);
    if (primary.damage) primaryBits.push(primary.damage);
  }
  if (specialCount > 0) primaryBits.push("+ special");

  return {
    attackCount,
    attackBonus: Number.isFinite(attackBonus) ? attackBonus : 0,
    attackKinds,
    dpr,
    dprLabel: formatNumber(dpr),
    attackSummary: primaryBits.length ? primaryBits.join(" ") : "--",
    primaryAttack: primary?.name ?? "",
    actionNames: [
      ...attacks.map(a => a.name),
      ...Array.from({ length: specialCount }, () => "Special"),
    ],
    specialCount,
  };
}

export function averageDice(formula) {
  const text = String(formula ?? "");
  if (!text.trim()) return 0;
  let total = 0;
  const diceRegex = /(\d+)?d(\d+)/gi;
  let match;
  while ((match = diceRegex.exec(text)) !== null) {
    const count = Number(match[1] || 1);
    const faces = Number(match[2]);
    if (Number.isFinite(count) && Number.isFinite(faces)) total += count * ((faces + 1) / 2);
  }
  const flatRegex = /([+-]\s*\d+)(?!\s*d)/g;
  while ((match = flatRegex.exec(text)) !== null) {
    total += Number(match[1].replace(/\s/g, ""));
  }
  return Math.round(total * 10) / 10;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "--";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function _itemsArray(items) {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (typeof items.filter === "function") return items.filter(() => true);
  if (typeof items.values === "function") return [...items.values()];
  return [];
}

function _finiteNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function _normalizeAlignmentLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower === "l") return "lawful";
  if (lower === "n") return "neutral";
  if (lower === "c") return "chaotic";
  return lower;
}

function _alignmentCode(value) {
  if (!value) return "";
  return String(value).charAt(0).toUpperCase();
}

function _previewList(list, limit) {
  if (!list.length) return "--";
  const head = list.slice(0, limit).join(", ");
  const more = list.length > limit ? `, +${list.length - limit}` : "";
  return `${head}${more}`;
}
