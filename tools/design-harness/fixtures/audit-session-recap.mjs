// Audit fixture: Session Recap, GM view, busiest data. state = overview | combat | loot | xp | downtime | history
const P = ["Creeg Greythorn", "Elbin Grizzlegut", "Iraga Draguul", "Jorbin Ironhelm", "Martin Rast"];
const build = (state) => ({ context: {
  isGM: true, isViewingHistory: false, viewingSession: null,
  tab: { [state]: true },
  sessionStatusLabel: "Current session", sessionDisplayName: "Session 14: The Drowned Chapel of Saint Orrin",
  sessionStats: ["3h 42m", "4 combats", "17 enemies defeated", "9 loot found", "320 XP"].map((label) => ({ label })),
  hasEncounterChecks: true, encounterSummary: "6 encounter checks: 2 encounters, 4 quiet",
  hasPlayerSummaries: true, playerSummaries: P.map((name, i) => ({ name, kills: 3 + i, damageDealt: 40 + i * 11, damageTaken: 12 + i * 3, totalXp: 60 + i })),
  hasDamageLog: false, hasCombats: true,
  combats: [0, 1, 2, 3].map((i) => ({ index: i, expanded: i < 2, label: ["The Chapel Door", "Flooded Crypt", "The Drowned Bishop and his Choir", "Rat Swarm"][i], rounds: 3 + i, duration: "4m", totalDefeated: 3 + i, totalEnemies: 4 + i,
    enemies: ["Drowned Acolyte", "Drowned Acolyte", "Choir Wraith", "Bishop Orrin, the Drowned", "Giant Crab", "Giant Crab"].map((name, k) => ({ name, defeated: k < 4, killedBy: k < 4 ? P[k] : "" })) })),
  hasPlayerStats: true, playerStatsTable: P.map((name, i) => ({ name, hitRate: (60 + i * 5) + "%", nat20s: i, nat1s: 2 - (i % 3), avgD20: (9.5 + i / 4).toFixed(1), saveRate: (7 + i) + "/" + (10 + i), damageDealt: 40 + i * 11, damageTaken: 12 + i * 3, kills: 3 + i })),
  hasLoot: true, lootEntries: Array.from({ length: 9 }, (_, i) => ({ time: "21:" + (10 + i * 3), iconHtml: '<i class="fas fa-coins"></i>', player: P[i % 5], detail: ["Silver chalice worth 40 gp", "Potion of healing", "212 sp", "Rope, 60 ft", "Wand of the drowned (cracked)", "Bishop's signet ring", "Wet scroll", "A key", "Gem: jade"][i], source: i % 2 ? "Bishop Orrin" : "Crypt", unclaimed: i === 7 })),
  hasMerchant: true, purchases: [{ player: P[0], subtotal: "62 gp", items: [{ item: "Rations", qtyLabel: " x6", price: "30 gp" }, { item: "Torches", qtyLabel: " x4", price: "2 gp" }] }],
  sales: [{ player: P[1], subtotal: "40 gp", items: [{ item: "Silver chalice", qtyLabel: "", price: "40 gp", ratio: "half price" }] }],
  hasXp: true, xpPlayers: P.slice(0, 3).map((player) => ({ player, total: 66, awards: [{ time: "21:30", label: "Defeated the Drowned Bishop", totalXp: 40 }, { time: "22:10", label: "Found the hidden shrine", totalXp: 26 }] })),
  hasRenown: true, renownPlayers: P.slice(0, 2).map((player) => ({ player, net: "+3", changes: [{ time: "22:30", text: "Saved the village of Harwick (+3)" }] })),
  hasDowntime: true, downtimePlayers: P.slice(0, 2).map((player) => ({ player, subtotal: "3", rows: [{ time: "Day 2", text: "Tracked down a rumor in the harbour taverns (success)", effect: "Gained a clue" }, { text: "Trained with Clementine" }] })),
  hasCarousing: true, carousing: [{ heading: "Night of the Lanterns", tier: "Comfortable, 20 gp each", subtotal: "3", rows: P.slice(0, 2).map((player) => ({ text: "Woke in a barn", player, benefits: ["+1 renown"], mishaps: ["Lost a boot"], applied: "Applied to sheet", pending: false })) }],
  hasRumors: true, rumors: [{ text: "The well in Harwick sings at night", region: "Western Reaches", time: "Day 2" }, { text: "A ship without a crew", region: "", time: "Day 3" }],
  hasHistory: true, historyEntries: Array.from({ length: 6 }, (_, i) => ({ id: "s" + i, name: "Session " + (13 - i), duration: "3h", combatCount: 3, enemiesDefeated: 11, lootCount: 8 })),
} });
export default { previewHeight: 700, title: "SDE.sessionRecap.title", icon: "fas fa-scroll", classes: ["shadowdark-enhancer", "sde-session-recap", "sde-ui"], width: 660, height: 560, resizable: true, template: "templates/session-recap.hbs", initial: "overview", build,
  toolbar: ["overview", "combat", "loot", "xp", "downtime", "history"].map((s) => `<button data-action="t" data-state="${s}">${s}</button>`).join(""), actions: { t: { state: "{state}" }, changeTab: { state: "{tab}" } } };
