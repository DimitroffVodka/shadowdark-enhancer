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

/** Reduce a `{gp, sp, cp}` price to a single copper total (1gp = 100cp). */
export function toCopper(price) {
  return (price?.gp ?? 0) * 100 + (price?.sp ?? 0) * 10 + (price?.cp ?? 0);
}

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
  const duration = startTime ? formatDuration((endTime ?? startTime) - startTime) : "N/A";
  lines.push("# Session Recap");
  lines.push(`**Duration:** ${duration}`);
  lines.push("");

  // ── Encounter Checks ───────────────────────────────────────
  const checks = Array.isArray(data.encounterChecks) ? data.encounterChecks : [];
  if (checks.length > 0) {
    lines.push("## Encounter Checks");
    const hits = checks.filter((c) => c.hit).length;
    const hitPct = Math.round((hits / checks.length) * 100);
    const avg = (checks.reduce((a, c) => a + (Number(c.roll) || 0), 0) / checks.length).toFixed(1);
    lines.push(`${checks.length} rolls — ${hits} encounter${hits === 1 ? "" : "s"} (${hitPct}%) · avg d6: ${avg}`);
    lines.push("");
    for (const c of checks) {
      const rollCell = c.hit ? `**${c.roll}**` : `${c.roll}`;
      const verdict = c.hit ? "💀 **Encounter**" : "✅ safe";
      const clock = c.clockLabel ? ` · ${c.clockLabel}` : "";
      const time = c.time ? `${c.time} · ` : "";
      lines.push(`- ${time}d6=${rollCell} vs ${c.threshold}${clock} · ${verdict}`);
    }
    lines.push("");
  }

  // ── Combat ─────────────────────────────────────────────────
  if (data.combats.length > 0) {
    lines.push("## Combat");
    data.combats.forEach((combat, idx) => {
      const dur = combat.startTime && combat.endTime
        ? ` (${formatDuration(combat.endTime - combat.startTime)})` : "";
      lines.push(`**Encounter ${idx + 1}** — ${combat.rounds} rounds${dur}`);

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
      lines.push(`- Enemies: ${enemyList}`);

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
      if (defeatedParts.length > 0) lines.push(`- Defeated: ${defeatedParts.join(" · ")}`);
      lines.push("");
    });
  }

  // ── Player Stats ───────────────────────────────────────────
  const statEntries = Object.entries(data.playerStats).filter(([, s]) =>
    s.attacks.hits + s.attacks.misses > 0
    || s.saves.passes + s.saves.fails > 0
    || s.damageDealt > 0 || s.damageTaken > 0 || s.kills > 0);

  if (statEntries.length > 0) {
    lines.push("## Player Stats");
    for (const [, stats] of statEntries) {
      lines.push(`### ${stats.name}`);
      const totalAtk = stats.attacks.hits + stats.attacks.misses;
      if (totalAtk > 0) {
        const hitPct = Math.round((stats.attacks.hits / totalAtk) * 100);
        let atkLine = `- **Attacks:** ${stats.attacks.hits}/${totalAtk} hit (${hitPct}%)`;
        const p = [];
        if (stats.attacks.nat20s > 0) p.push(`${stats.attacks.nat20s} nat 20${stats.attacks.nat20s > 1 ? "s" : ""}`);
        if (stats.attacks.nat1s > 0) p.push(`${stats.attacks.nat1s} nat 1${stats.attacks.nat1s > 1 ? "s" : ""}`);
        if (p.length) atkLine += ` — ${p.join(", ")}`;
        lines.push(atkLine);
      }
      const totalSave = stats.saves.passes + stats.saves.fails;
      if (totalSave > 0) {
        let saveLine = `- **Checks/Saves:** ${stats.saves.passes}/${totalSave} passed`;
        const p = [];
        if (stats.saves.nat20s > 0) p.push(`${stats.saves.nat20s} nat 20${stats.saves.nat20s > 1 ? "s" : ""}`);
        if (stats.saves.nat1s > 0) p.push(`${stats.saves.nat1s} nat 1${stats.saves.nat1s > 1 ? "s" : ""}`);
        if (p.length) saveLine += ` — ${p.join(", ")}`;
        lines.push(saveLine);
      }
      if (stats.rolls.total > 0) lines.push(`- **Avg d20:** ${(stats.rolls.sum / stats.rolls.total).toFixed(1)}`);
      if (stats.damageDealt > 0 || stats.damageTaken > 0) lines.push(`- **Damage:** ${stats.damageDealt} dealt / ${stats.damageTaken} taken`);
      if (stats.kills > 0) lines.push(`- **Kills:** ${stats.kills}`);
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
    lines.push("## Loot");
    for (const [player, entries] of Object.entries(claimed)) {
      lines.push(`### ${player}`);
      const currency = entries.filter((e) => e.type === "currency");
      const items = entries.filter((e) => e.type === "item");
      if (currency.length > 0) {
        const cp = currency.reduce((s, e) => s + toCopper(e.coins), 0);
        if (cp > 0) lines.push(`- **Currency:** ${formatCurrency(cp)}`);
      }
      if (items.length > 0) {
        lines.push("- **Items:**");
        for (const e of items) {
          const src = e.source ? ` *(from ${e.source})*` : "";
          lines.push(`  - ${e.detail}${(e.qty ?? 1) > 1 ? ` ×${e.qty}` : ""}${src}`);
        }
      }
      lines.push("");
    }
    const unclaimedPlayers = Object.entries(unclaimed);
    if (unclaimedPlayers.length > 0) {
      lines.push("### Unclaimed");
      for (const [player, entries] of unclaimedPlayers) {
        const bits = [];
        const cp = entries.filter((e) => e.type === "currency").reduce((s, e) => s + toCopper(e.coins), 0);
        if (cp > 0) bits.push(formatCurrency(cp));
        for (const e of entries.filter((e) => e.type === "item")) {
          bits.push(`${e.detail}${(e.qty ?? 1) > 1 ? ` ×${e.qty}` : ""}`);
        }
        if (bits.length) lines.push(`- **${player}** (rolled, not claimed): ${bits.join(", ")}`);
      }
      lines.push("");
    }
  }

  // ── Sales ──────────────────────────────────────────────────
  if (Array.isArray(data.sales) && data.sales.length > 0) {
    lines.push("## Sales");
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
      lines.push(`- **Subtotal:** ${formatCurrency(cp)}`);
      partyCp += cp;
      lines.push("");
    }
    lines.push(`**Party total:** ${formatCurrency(partyCp)}`);
    lines.push("");
  }

  // ── Purchases ──────────────────────────────────────────────
  if (Array.isArray(data.purchases) && data.purchases.length > 0) {
    lines.push("## Purchases");
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
      lines.push(`- **Subtotal:** ${formatCurrency(cp)}`);
      partyCp += cp;
      lines.push("");
    }
    lines.push(`**Party total:** ${formatCurrency(partyCp)}`);
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
    lines.push("## XP");
    let grandTotal = 0;
    for (const [player, { entries, total }] of Object.entries(byPlayer)) {
      grandTotal += total;
      lines.push(`### ${player}`);
      // Consolidate by award label across the session.
      const byLabel = new Map();
      for (const e of entries) {
        const k = e.label || "Award";
        byLabel.set(k, (byLabel.get(k) || 0) + e.totalXp);
      }
      for (const [label, xp] of byLabel) lines.push(`- ${label} — ${xp} XP`);
      lines.push(`- **Total: ${total} XP**`);
      lines.push("");
    }
    if (Object.keys(byPlayer).length > 1) {
      lines.push(`**Session XP Awarded: ${grandTotal} XP**`);
      lines.push("");
    }
  }

  if (lines.length <= 3) return "No session activity recorded.";
  return lines.join("\n");
}
