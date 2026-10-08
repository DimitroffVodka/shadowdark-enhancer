/**
 * Shadowdark Enhancer — Session Recap core (pure, node-testable).
 *
 * No Foundry globals: the data shape, Shadowdark currency math, duration
 * formatting, session-name generation, and the Discord-markdown export — all
 * derived purely from a plain `data` object so they can be unit-tested the same
 * way loot-value.mjs / party-xp-core.mjs are. The Foundry-coupled singleton
 * (session-recap.mjs) owns persistence, hooks, and the window.
 *
 * Currency is Shadowdark's `{gp, sp, cp}` at 1gp = 10sp = 100cp (NOT Vagabond's
 * 100c = 1s ratios). Internally we reduce to a copper total where 1gp = 100cp.
 */

// One-way dependency on the downtime log's pure row formatter, so the recap
// window, the Discord export and the persistent journal all phrase a downtime
// attempt identically. downtime-log-core.mjs is Foundry-free, like this file.
import { recapRow as downtimeRecapRow } from "../downtime/downtime-log-core.mjs";
// Same one-way arrangement for renown, so the chat card, the recap window and
// the Discord export phrase a renown change identically. renown-core.mjs is
// Foundry-free, like this file.
import { recapRow as renownRecapRow } from "../renown/renown-core.mjs";
// And again for carousing, which Shadowdark Extras owns — carousing-feed-core.mjs
// normalizes SDX's two result shapes and is likewise Foundry-free.
import {
  recapRow as carousingRecapRow, carousingSubtotal, tierLine,
} from "./carousing-feed-core.mjs";
import { L } from "../shared/i18n.mjs";
import { toCopper } from "../shared/coins.mjs";


/** Empty session payload. Cloned on session start / clear. */
export const DEFAULT_DATA = {
  sessionState: "inactive",
  sessionStart: null,
  loot: [],
  sales: [],
  purchases: [],
  xp: [],
  combats: [],
  encounterChecks: [],
  luckSpent: [],
  downtime: [],
  renown: [],
  carousing: [],
  rumors: [],
  playerStats: {},
};

/** Fresh per-actor stat block. */
export function emptyPlayerStat(name) {
  return {
    name,
    attacks: { hits: 0, misses: 0, nat20s: 0, nat1s: 0 },
    saves: { passes: 0, fails: 0, nat20s: 0, nat1s: 0 },
    rolls: { total: 0, sum: 0 },
    damageDealt: 0,
    damageTaken: 0,
    kills: 0,
  };
}

/** Reduce a `{gp, sp, cp}` price to a single copper total (1gp = 100cp): the shared coins helper, re-exported for the recap window. */
export { toCopper };

/** Format a copper total as a short `gp/sp/cp` string, e.g. `"5gp 3sp"`. */
export function formatCurrency(cpTotal) {
  cpTotal = Math.max(0, Math.round(cpTotal));
  if (cpTotal === 0) return "0cp";
  const gp = Math.floor(cpTotal / 100);
  const sp = Math.floor((cpTotal % 100) / 10);
  const cp = cpTotal % 10;
  const parts = [];
  if (gp) parts.push(`${gp}gp`);
  if (sp) parts.push(`${sp}sp`);
  if (cp) parts.push(`${cp}cp`);
  return parts.join(" ");
}

/** Sum an array of `{gp,sp,cp}` coin objects to one `gp/sp/cp` string. */
export function sumCoins(coinObjs) {
  return formatCurrency(coinObjs.reduce((s, c) => s + toCopper(c), 0));
}

/** Human duration from a ms span, e.g. `"1h 5m"`, `"3m 20s"`, `"12s"`. */
export function formatDuration(ms) {
  if (!ms || ms < 0) return "0m";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** `YYYY.MM.DD Session` (+ ` N` when same-day duplicates already exist). */
export function generateSessionName(timestamp, existingNames = []) {
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  const base = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} Session`;
  const existing = existingNames.filter((n) => n.startsWith(base));
  if (existing.length === 0) return base;
  return `${base} ${existing.length + 1}`;
}

/**
 * Build the Discord-markdown recap from a plain `data` object. Pure — every
 * input is read off `data`, currency via {@link toCopper}/{@link formatCurrency}.
 * Returns "No session activity recorded." when nothing meaningful is present.
 */
export function formatForDiscordFromData(data, startTime, endTime) {
  const lines = [];
  const duration = startTime ? formatDuration((endTime ?? startTime) - startTime) : L("SDE.sessionRecap.discord.na");
  lines.push(`# ${L("SDE.sessionRecap.title")}`);
  lines.push(`**${L("SDE.sessionRecap.discord.duration")}** ${duration}`);
  lines.push("");

  // ── Encounter Checks ───────────────────────────────────────
  const checks = Array.isArray(data.encounterChecks) ? data.encounterChecks : [];
  if (checks.length > 0) {
    lines.push(`## ${L("SDE.sessionRecap.discord.encounterChecks")}`);
    const hits = checks.filter((c) => c.hit).length;
    const hitPct = Math.round((hits / checks.length) * 100);
    const avg = (checks.reduce((a, c) => a + (Number(c.roll) || 0), 0) / checks.length).toFixed(1);
    const summary = { rolls: checks.length, hits, pct: hitPct, avg };
    lines.push(hits === 1
      ? L("SDE.sessionRecap.discord.checksOne", summary)
      : L("SDE.sessionRecap.discord.checksMany", summary));
    lines.push("");
    for (const c of checks) {
      const rollCell = c.hit ? `**${c.roll}**` : `${c.roll}`;
      const verdict = c.hit
        ? `💀 **${L("SDE.sessionRecap.discord.encounter")}**`
        : `✅ ${L("SDE.sessionRecap.discord.safe")}`;
      const clock = c.clockLabel ? ` · ${c.clockLabel}` : "";
      const time = c.time ? `${c.time} · ` : "";
      lines.push(`- ${time}${L("SDE.sessionRecap.discord.checkRoll", { roll: rollCell, threshold: c.threshold })}${clock} · ${verdict}`);
    }
    lines.push("");
  }

  // ── Combat ─────────────────────────────────────────────────
  if (data.combats.length > 0) {
    lines.push(`## ${L("SDE.sessionRecap.discord.combat")}`);
    data.combats.forEach((combat, idx) => {
      const dur = combat.startTime && combat.endTime
        ? ` (${formatDuration(combat.endTime - combat.startTime)})` : "";
      lines.push(`**${L("SDE.sessionRecap.encounterN", { n: idx + 1 })}** — ${L("SDE.sessionRecap.discord.rounds", { n: combat.rounds })}${dur}`);

      const counts = {};
      for (const e of combat.enemies) {
        if (!counts[e.name]) counts[e.name] = { total: 0, defeated: 0, killers: [] };
        counts[e.name].total++;
        if (e.defeated) {
          counts[e.name].defeated++;
          if (e.killedBy) counts[e.name].killers.push(e.killedBy);
        }
      }
      // ` · ` separator so bestiary names with commas ("Bat, Giant") read as one.
      const enemyList = Object.entries(counts)
        .map(([name, c]) => `${name}${c.total > 1 ? ` x${c.total}` : ""}`)
        .join(" · ");
      lines.push(`- ${L("SDE.sessionRecap.discord.enemies", { list: enemyList })}`);

      const defeatedParts = [];
      for (const [name, c] of Object.entries(counts)) {
        if (c.defeated === 0) continue;
        const killerCounts = {};
        c.killers.forEach((k) => { killerCounts[k] = (killerCounts[k] || 0) + 1; });
        const killerStr = Object.entries(killerCounts)
          .map(([k, n]) => (n > 1 ? `${k} x${n}` : k)).join(", ");
        const label = c.defeated > 1 ? `${name} x${c.defeated}` : name;
        defeatedParts.push(killerStr ? `${label} (${killerStr})` : label);
      }
      if (defeatedParts.length > 0) lines.push(`- ${L("SDE.sessionRecap.discord.defeated", { list: defeatedParts.join(" · ") })}`);
      lines.push("");
    });
  }

  // ── Player Stats ───────────────────────────────────────────
  const statEntries = Object.entries(data.playerStats).filter(([, s]) =>
    s.attacks.hits + s.attacks.misses > 0
    || s.saves.passes + s.saves.fails > 0
    || s.damageDealt > 0 || s.damageTaken > 0 || s.kills > 0);

  if (statEntries.length > 0) {
    lines.push(`## ${L("SDE.sessionRecap.discord.playerStats")}`);
    // "3 nat 20s, 1 nat 1" — singular and plural are separate keys.
    const nats = (n20, n1) => {
      const p = [];
      if (n20 > 0) p.push(n20 > 1 ? L("SDE.sessionRecap.discord.nat20Many", { n: n20 }) : L("SDE.sessionRecap.discord.nat20One", { n: n20 }));
      if (n1 > 0) p.push(n1 > 1 ? L("SDE.sessionRecap.discord.nat1Many", { n: n1 }) : L("SDE.sessionRecap.discord.nat1One", { n: n1 }));
      return p.length ? ` — ${p.join(", ")}` : "";
    };
    for (const [, stats] of statEntries) {
      lines.push(`### ${stats.name}`);
      const totalAtk = stats.attacks.hits + stats.attacks.misses;
      if (totalAtk > 0) {
        const hitPct = Math.round((stats.attacks.hits / totalAtk) * 100);
        const rate = L("SDE.sessionRecap.discord.hitRate", { hits: stats.attacks.hits, total: totalAtk, pct: hitPct });
        lines.push(`- **${L("SDE.sessionRecap.discord.attacks")}** ${rate}${nats(stats.attacks.nat20s, stats.attacks.nat1s)}`);
      }
      const totalSave = stats.saves.passes + stats.saves.fails;
      if (totalSave > 0) {
        const rate = L("SDE.sessionRecap.discord.passRate", { passes: stats.saves.passes, total: totalSave });
        lines.push(`- **${L("SDE.sessionRecap.discord.saves")}** ${rate}${nats(stats.saves.nat20s, stats.saves.nat1s)}`);
      }
      if (stats.rolls.total > 0) lines.push(`- **${L("SDE.sessionRecap.discord.avgD20")}** ${(stats.rolls.sum / stats.rolls.total).toFixed(1)}`);
      if (stats.damageDealt > 0 || stats.damageTaken > 0) {
        const dmg = L("SDE.sessionRecap.discord.damageLine", { dealt: stats.damageDealt, taken: stats.damageTaken });
        lines.push(`- **${L("SDE.sessionRecap.discord.damage")}** ${dmg}`);
      }
      if (stats.kills > 0) lines.push(`- **${L("SDE.sessionRecap.discord.kills")}** ${stats.kills}`);
      lines.push("");
    }
  }

  // ── Loot ───────────────────────────────────────────────────
  if (data.loot.length > 0) {
    const claimed = {}, unclaimed = {};
    for (const e of data.loot) {
      const bucket = e.claimed === false ? unclaimed : claimed;
      (bucket[e.player] ??= []).push(e);
    }
    lines.push(`## ${L("SDE.sessionRecap.discord.loot")}`);
    for (const [player, entries] of Object.entries(claimed)) {
      lines.push(`### ${player}`);
      const currency = entries.filter((e) => e.type === "currency");
      const items = entries.filter((e) => e.type === "item");
      if (currency.length > 0) {
        const cp = currency.reduce((s, e) => s + toCopper(e.coins), 0);
        if (cp > 0) lines.push(`- **${L("SDE.sessionRecap.discord.currency")}** ${formatCurrency(cp)}`);
      }
      if (items.length > 0) {
        lines.push(`- **${L("SDE.sessionRecap.discord.items")}**`);
        for (const e of items) {
          const src = e.source ? ` *(${L("SDE.sessionRecap.discord.from", { source: e.source })})*` : "";
          lines.push(`  - ${e.detail}${(e.qty ?? 1) > 1 ? ` ×${e.qty}` : ""}${src}`);
        }
      }
      lines.push("");
    }
    const unclaimedPlayers = Object.entries(unclaimed);
    if (unclaimedPlayers.length > 0) {
      lines.push(`### ${L("SDE.sessionRecap.discord.unclaimed")}`);
      for (const [player, entries] of unclaimedPlayers) {
        const bits = [];
        const cp = entries.filter((e) => e.type === "currency").reduce((s, e) => s + toCopper(e.coins), 0);
        if (cp > 0) bits.push(formatCurrency(cp));
        for (const e of entries.filter((e) => e.type === "item")) {
          bits.push(`${e.detail}${(e.qty ?? 1) > 1 ? ` ×${e.qty}` : ""}`);
        }
        if (bits.length) lines.push(`- **${player}** ${L("SDE.sessionRecap.discord.notClaimed", { items: bits.join(", ") })}`);
      }
      lines.push("");
    }
  }

  // ── Sales ──────────────────────────────────────────────────
  if (Array.isArray(data.sales) && data.sales.length > 0) {
    lines.push(`## ${L("SDE.sessionRecap.discord.sales")}`);
    const byPlayer = {};
    for (const s of data.sales) (byPlayer[s.player] ??= []).push(s);
    let partyCp = 0;
    for (const [player, entries] of Object.entries(byPlayer)) {
      lines.push(`### ${player}`);
      let cp = 0;
      for (const e of entries) {
        const qtyStr = (e.qty ?? 1) > 1 ? ` ×${e.qty}` : "";
        const ratioStr = (e.ratio ?? 100) !== 100 ? ` (${e.ratio}%)` : "";
        const lineCp = toCopper(e.price);
        cp += lineCp;
        lines.push(`- ${e.item}${qtyStr} — ${formatCurrency(lineCp)}${ratioStr}`);
      }
      lines.push(`- **${L("SDE.sessionRecap.discord.subtotal")}** ${formatCurrency(cp)}`);
      partyCp += cp;
      lines.push("");
    }
    lines.push(`**${L("SDE.sessionRecap.discord.partyTotal")}** ${formatCurrency(partyCp)}`);
    lines.push("");
  }

  // ── Purchases ──────────────────────────────────────────────
  if (Array.isArray(data.purchases) && data.purchases.length > 0) {
    lines.push(`## ${L("SDE.sessionRecap.discord.purchases")}`);
    const byPlayer = {};
    for (const p of data.purchases) (byPlayer[p.player] ??= []).push(p);
    let partyCp = 0;
    for (const [player, entries] of Object.entries(byPlayer)) {
      lines.push(`### ${player}`);
      let cp = 0;
      for (const e of entries) {
        const qtyStr = (e.qty ?? 1) > 1 ? ` ×${e.qty}` : "";
        const lineCp = toCopper(e.price);
        cp += lineCp;
        lines.push(`- ${e.item}${qtyStr} — ${formatCurrency(lineCp)}`);
      }
      lines.push(`- **${L("SDE.sessionRecap.discord.subtotal")}** ${formatCurrency(cp)}`);
      partyCp += cp;
      lines.push("");
    }
    lines.push(`**${L("SDE.sessionRecap.discord.partyTotal")}** ${formatCurrency(partyCp)}`);
    lines.push("");
  }

  // ── XP ─────────────────────────────────────────────────────
  if (data.xp.length > 0) {
    const byPlayer = {};
    for (const e of data.xp) {
      if (!byPlayer[e.player]) byPlayer[e.player] = { entries: [], total: 0 };
      byPlayer[e.player].entries.push(e);
      byPlayer[e.player].total += e.totalXp;
    }
    lines.push(`## ${L("SDE.sessionRecap.discord.xp")}`);
    let grandTotal = 0;
    for (const [player, { entries, total }] of Object.entries(byPlayer)) {
      grandTotal += total;
      lines.push(`### ${player}`);
      // Consolidate by award label across the session.
      const byLabel = new Map();
      for (const e of entries) {
        const k = e.label || L("SDE.sessionRecap.award");
        byLabel.set(k, (byLabel.get(k) || 0) + e.totalXp);
      }
      for (const [label, xp] of byLabel) lines.push(`- ${label} — ${xp} XP`);
      lines.push(`- **${L("SDE.sessionRecap.discord.totalXp", { n: total })}**`);
      lines.push("");
    }
    if (Object.keys(byPlayer).length > 1) {
      lines.push(`**${L("SDE.sessionRecap.discord.sessionXp", { n: grandTotal })}**`);
      lines.push("");
    }
  }

  // ── Renown ──────────────────────────────────────────────────
  // Every change to `system.renown` this session, whatever caused it — a GM
  // award, a level-up, or a downtime rumour. A downtime-driven change also
  // appears under Downtime as part of that attempt's effect summary; this
  // section is the renown ledger, the same double-entry Purchases has.
  if (Array.isArray(data.renown) && data.renown.length > 0) {
    lines.push(`## ${L("SDE.sessionRecap.discord.renown")}`);
    const byPlayer = {};
    for (const e of data.renown) (byPlayer[e.player || L("SDE.sessionRecap.gm")] ??= []).push(e);
    for (const [player, entries] of Object.entries(byPlayer)) {
      lines.push(`### ${player}`);
      for (const e of entries) lines.push(`- ${renownRecapRow(e)}`);
      lines.push("");
    }
  }

  // ── Downtime ────────────────────────────────────────────────
  // The narrative record. Paid attempts ALSO appear under Purchases (the money
  // ledger) — that double-entry is deliberate, see downtime-log.mjs.
  if (Array.isArray(data.downtime) && data.downtime.length > 0) {
    lines.push(`## ${L("SDE.sessionRecap.discord.downtime")}`);
    const byPlayer = {};
    for (const e of data.downtime) (byPlayer[e.player || L("SDE.sessionRecap.gm")] ??= []).push(e);
    for (const [player, entries] of Object.entries(byPlayer)) {
      lines.push(`### ${player}`);
      for (const e of entries) {
        lines.push(`- ${downtimeRecapRow(e)}`);
        if (e.effectSummary) lines.push(`  - *${e.effectSummary}*`);
      }
      const spent = entries.reduce((s, e) => s + (Number(e.costGp) || 0), 0);
      const won = entries.filter((e) => e.success).length;
      const tally = L("SDE.sessionRecap.discord.succeeded", { won, n: entries.length });
      lines.push(`- **${tally}**${spent > 0 ? ` · ${L("SDE.sessionRecap.discord.gpSpent", { gp: spent })}` : ""}`);
      lines.push("");
    }
  }

  // ── Carousing ───────────────────────────────────────────────
  // Mirrored from Shadowdark Extras. Grouped per CAROUSE rather than per player,
  // because a carouse is one shared event the whole party bought into — the
  // tier and its cost belong to the night, not to any one character.
  if (Array.isArray(data.carousing) && data.carousing.length > 0) {
    lines.push(`## ${L("SDE.sessionRecap.discord.carousing")}`);
    for (const carouse of data.carousing) {
      const entries = Array.isArray(carouse.entries) ? carouse.entries : [];
      lines.push(`**${carouse.date || L("SDE.sessionRecap.carouse")}** — ${carousingSubtotal(entries)}`);
      const tier = tierLine(carouse);
      if (tier) lines.push(`*${tier}*`);
      for (const e of entries) {
        lines.push(`- ${carousingRecapRow(e)}`);
        for (const b of e.benefits ?? []) lines.push(`  - ${L("SDE.sessionRecap.discord.benefit", { text: b.text })}`);
        for (const m of e.mishaps ?? []) lines.push(`  - ${L("SDE.sessionRecap.discord.mishap", { text: m.text })}`);
        if (e.applied) lines.push(`  - *${e.applied}*`);
        else if (e.appliedState === "pending") lines.push(`  - *${L("SDE.sessionRecap.discord.notApplied")}*`);
      }
      lines.push("");
    }
  }

  // ── Rumors ──────────────────────────────────────────────────
  // What the party heard this session (#190), in the order given; the region
  // in brackets, the general table's none.
  if (Array.isArray(data.rumors) && data.rumors.length > 0) {
    lines.push(`## ${L("SDE.sessionRecap.discord.rumors")}`);
    for (const r of data.rumors) lines.push(`- ${r.region ? L("SDE.sessionRecap.discord.rumorIn", { text: r.text, region: r.region }) : r.text}`);
    lines.push("");
  }

  // ── Luck Spent ──────────────────────────────────────────────
  if (Array.isArray(data.luckSpent) && data.luckSpent.length > 0) {
    const byPlayer = {};
    for (const e of data.luckSpent) {
      (byPlayer[e.player] ??= []).push(e);
    }
    lines.push(`## ${L("SDE.sessionRecap.discord.luckSpent")}`);
    for (const [player, entries] of Object.entries(byPlayer)) {
      const n = entries.length;
      lines.push(`- **${player}:** ${n !== 1
        ? L("SDE.sessionRecap.discord.tokenMany", { n })
        : L("SDE.sessionRecap.discord.tokenOne", { n })}`);
      for (const e of entries) {
        lines.push(`  - ${e.formula}: ${e.oldTotal} → ${e.newTotal}`);
      }
    }
    lines.push("");
  }

  if (lines.length <= 3) return L("SDE.sessionRecap.discord.empty");
  return lines.join("\n");
}
