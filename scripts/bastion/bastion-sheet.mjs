/**
 * Shadowdark Enhancer — Bastion actor sheet.
 *
 * An ApplicationV2 sheet with four tabs: Overview (type, hit points, treasury,
 * the build clock), Upgrades (pick and build), Plan (the bastion drawn from
 * outside or in, with roofs, zoom and a card for a room) and Log. The GM edits;
 * players who can see the actor read it. Every change goes through the rules in
 * bastion-core.mjs and is written back as one update.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import * as core from "./bastion-core.mjs";
import { stateOf } from "./bastion-core.mjs";
import { renderPlan } from "./bastion-plan.mjs";
import { isPartyActor } from "./bastion-funding.mjs";
import { ensureSprites } from "./bastion-art.mjs";
import { absDay } from "../time/time-core.mjs";
import { t, format, WHY, logText, monthLine } from "./bastion-text.mjs";
import { writeState, fundBastion, trophyBastion, takeOutBastion, storeBastion, pigeonBastion } from "./bastion-writes.mjs";
import { slotsOf, usedSlots, VAULT_SLOTS, VAULT_TYPES } from "./bastion-vault-core.mjs";
import { openShops } from "./bastion-shop-core.mjs";
import { BastionShopApp } from "./bastion-shop-app.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class BastionSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["shadowdark", "shadowdark-enhancer", "sde-bastion-sheet"],
    position: { width: 980, height: 760 },
    window: { icon: "fa-solid fa-chess-rook", resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      changeTab: BastionSheet.prototype._onChangeTab,
      setView: BastionSheet.prototype._onSetView,
      toggleRoofs: BastionSheet.prototype._onToggleRoofs,
      build: BastionSheet.prototype._onBuild,
      takeDown: BastionSheet.prototype._onTakeDown,
      advanceWeek: BastionSheet.prototype._onAdvanceWeek,
      repair: BastionSheet.prototype._onRepair,
      rollMonth: BastionSheet.prototype._onRollMonth,
      deposit: BastionSheet.prototype._onDeposit,
      withdraw: BastionSheet.prototype._onWithdraw,
      placeTrophy: BastionSheet.prototype._onPlaceTrophy,
      removeTrophy: BastionSheet.prototype._onRemoveTrophy,
      takeOut: BastionSheet.prototype._onTakeOut,
      sendPigeon: BastionSheet.prototype._onSendPigeon,
      openShop: BastionSheet.prototype._onOpenShop,
      exportSvg: BastionSheet.prototype._onExportSvg,
      exportPng: BastionSheet.prototype._onExportPng,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/actors/bastion-sheet.hbs` },
  };

  _activeTab = "overview";
  _view = "ext";
  _roofs = false;
  _card = null;
  /** The world-clock day this sheet's context was built for; the clock hook redraws it only when a new day turns. */
  _shownDay = null;
  /** The viewBox the GM zoomed or panned to, kept across redraws of the same plan. */
  _zoom = { key: "", viewBox: null };

  get state() { return stateOf(this.document); }

  // ── Context ────────────────────────────────────────────────────────────────

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    await ensureSprites();
    const state = this.state, st = core.stats(state);
    const gm = game.user.isGM;
    context.gm = gm;
    context.editable = this.isEditable && gm;
    context.tab = Object.fromEntries(["overview", "upgrades", "plan", "log"].map((id) => [id, this._activeTab === id]));
    context.system = this.document.system;
    context.types = core.BASTION_TYPES.map((type) => ({
      id: type.id, name: t(type.name), selected: type.id === state.type,
      line: format("SDE.bastion.type.line", { cost: type.cost, ac: type.ac, hp: type.hp, slots: type.slots }),
    }));
    context.type = { name: t(st.type.name), blurb: t(st.type.blurb), cost: st.type.cost, weeks: st.type.weeks };
    context.stats = {
      ac: st.ac, hp: st.hp, maxHp: st.maxHp, used: st.used, slots: st.slots, breached: st.breached, standing: st.standing,
      repairCost: st.repairCost, worth: core.worth(state), weeksLeft: state.weeksLeft, week: state.week,
      repairing: state.repair.weeksLeft > 0,
    };
    context.upgrades = core.BASTION_UPGRADES.map((u) => {
      const have = state.upgrades.find((x) => x.id === u.id);
      const check = core.canBuild(state, u.id);
      return {
        id: u.id, name: t(u.name), effect: t(u.effect), cost: u.cost,
        isBuilt: !!have && have.weeksLeft <= 0,
        isBuilding: !!have && have.weeksLeft > 0,
        isNone: !have,
        weeksLeft: have?.weeksLeft ?? 0,
        canBuild: check.ok,
        why: check.reason && check.reason !== "built" ? t(WHY[check.reason]) : "",
      };
    });
    const fx = core.effects(state);
    const stored = this.document.items.filter((i) => VAULT_TYPES.includes(i.type));
    context.vault = { shown: fx.vault || stored.length > 0, open: fx.vault, used: usedSlots(stored), max: VAULT_SLOTS,
      items: stored.map((i) => ({ id: i.id, name: i.name, img: i.img, quantity: i.system?.quantity ?? 1, slots: slotsOf(i) })).sort((a, b) => a.name.localeCompare(b.name)) };
    context.shops = openShops(fx).map((shop) => ({ id: shop.id, name: t(shop.name) }));
    const day = absDay(game.time.calendar, game.time.worldTime);
    this._shownDay = day;
    context.aviary = { open: fx.aviary, flown: state.pigeonDay === day };
    context.trophyRoom = fx.trophyRoom;
    context.trophies = state.trophies.map((name, index) => ({ name, index }));
    context.trophyXp = core.TROPHY_XP;
    context.log = state.log.map((e) => ({ week: e.week, text: logText(e) })).reverse();
    context.plan = this._plan(state, st);
    context.parties = game.actors.filter(isPartyActor).map((a) => ({ uuid: a.uuid, name: a.name, selected: a.uuid === this.document.system.party }));
    context.view = { ext: this._view === "ext", in: this._view === "in" };
    context.roofs = this._roofs;
    context.enrichedNotes = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      this.document.system.notes ?? "", { secrets: this.document.isOwner, relativeTo: this.document });
    return context;
  }

  _plan(state, st) {
    const plan = renderPlan({
      type: state.type, slots: st.slots, upgrades: state.upgrades, built: st.standing, name: this.document.name,
      view: this._view, roofs: this._roofs,
      label: (id) => { const u = core.upgradeOf(id); return `${t(u.name)}: ${t(u.effect)}`; },
      t,
    });
    const key = `${state.type}|${this._view}`;
    if (this._zoom.key !== key) this._zoom = { key, viewBox: null };
    return { markup: plan.markup, viewBox: this._zoom.viewBox ?? plan.viewBox, base: plan.viewBox };
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  /** Write a state back (the GM's), and say so when Foundry vetoed it after the fact. */
  _write(next) { return writeState(this.document, next); }

  /** Run a rules function on the current state and write its result, or say why not. */
  async _apply(fn) {
    const { state, error } = fn(this.state);
    if (error) {
      ui.notifications?.warn(t(WHY[error] ?? WHY.unknown));
      return false;
    }
    return this._write(state);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  _onChangeTab(_event, target) {
    this._activeTab = target.dataset.tab;
    this.render();
  }

  _onSetView(_event, target) {
    this._view = target.dataset.view === "in" ? "in" : "ext";
    this.render();
  }

  _onToggleRoofs() {
    this._roofs = !this._roofs;
    this.render();
  }

  _onBuild(_event, target) { return this._apply((s) => core.build(s, target.dataset.id)); }
  _onTakeDown(_event, target) { return this._confirmTakeDown(target.dataset.id); }

  /** Ask, then take an upgrade down (nothing is refunded). */
  async _confirmTakeDown(id) {
    const upgrade = core.upgradeOf(id);
    const sure = await foundry.applications.api.DialogV2.confirm({
      window: { title: "SDE.bastion.takeDown.title" },
      content: `<p>${esc(format("SDE.bastion.takeDown.question", { upgrade: t(upgrade?.name ?? "") }))}</p>`,
      yes: { label: "SDE.bastion.takeDown.yes", icon: "fa-solid fa-trash" },
      no: { label: "SDE.bastion.takeDown.keep", icon: "fa-solid fa-xmark", default: true },
      rejectClose: false,
    });
    if (sure) return this._apply((s) => core.takeDown(s, id));
    return false;
  }
  _onRepair() { return this._apply(core.startRepair); }
  _onAdvanceWeek() { return this._write(core.advanceWeek(this.state)); }

  /** The monthly d6 (and d4): applied to the bastion and posted to chat. */
  async _onRollMonth() {
    if (!game.user.isGM) return;
    const die = (n) => Math.floor(CONFIG.Dice.randomUniform() * n) + 1;
    const before = this.state;
    const next = core.applyDisaster(before, core.rollDisaster(die));
    if (!(await this._write(next))) return;
    // Every line the roll added goes to chat (a breaching disaster adds two: the damage, then the breach;
    // under a finished Infirmary the pestilence line says the patients have ADV).
    // The cap can drop old lines, so compare entries — the ones handed in are the same that come back — not indexes.
    const seen = new Set(before.log);
    const lines = next.log.filter((e) => !seen.has(e)).map((e) => monthLine(next, e));
    await ChatMessage.create({ content: `<p><strong>${esc(this.document.name)}</strong> ${lines.map(esc).join(" ")}</p>`, speaker: { alias: this.document.name } });
  }

  // ── Paying in and out of the treasury (bastion-writes.mjs) ─────────────────

  _onDeposit() { return fundBastion(this.document, "deposit"); }
  _onWithdraw() { return fundBastion(this.document, "withdraw"); }

  // ── The Trophy Room (bastion-trophies.mjs) ─────────────────────────────────

  _onPlaceTrophy() { return trophyBastion(this.document); }
  _onRemoveTrophy(_event, target) { return this._apply((s) => core.removeTrophy(s, Number(target.dataset.index))); }

  // ── The shops (bastion-shop.mjs): the Armorer, the Blacksmith, the Trading Post ──

  _onOpenShop(_event, target) { return BastionShopApp.open(this.document, target.dataset.shop); }

  // ── The Aviary (bastion-aviary.mjs) ────────────────────────────────────────

  _onSendPigeon() { return pigeonBastion(this.document); }

  // ── The Vault (bastion-vault.mjs): items dropped on the sheet go in, a button takes them out ──

  _onTakeOut(_event, target) { return takeOutBastion(this.document, target.dataset.id); }

  /** An item dropped on the sheet is stored in the Vault (the GM's drop; the base sheet would just copy it in). */
  async _onDropItem(_event, item) { return storeBastion(this.document, item); }

  /** The plan as a standalone SVG: the page's art symbols plus what's drawn. */
  _planSvg() {
    const map = this.element.querySelector(".sde-bastion-map");
    const defs = document.querySelector("#sde-bastion-sprites svg defs")?.outerHTML ?? "";
    const [, , w, h] = map.getAttribute("viewBox").split(" ").map(Number);
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${map.getAttribute("viewBox")}">${defs}${map.innerHTML}</svg>`, w, h };
  }

  _fileName(ext) {
    return `${this.document.name.toLowerCase().replace(/\W+/g, "-")}-${this._view === "in" ? "interior" : "exterior"}.${ext}`;
  }

  _onExportSvg() {
    foundry.utils.saveDataToFile(this._planSvg().svg, "image/svg+xml", this._fileName("svg"));
  }

  _onExportPng() {
    const { svg, w, h } = this._planSvg();
    const k = Math.min(2, 6000 / Math.max(w, h)), img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * k);
      canvas.height = Math.round(h * k);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => foundry.utils.saveDataToFile(blob, "image/png", this._fileName("png")));
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  // ── Render: type select, zoom and pan, the room card ───────────────────────

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;

    // The type is a select with no form name: the rules decide whether it may change.
    root.querySelector("select[data-bastion-type]")?.addEventListener("change", (event) => {
      this._apply((s) => core.changeType(s, event.target.value))
        .then((ok) => { if (!ok) this.render(); });
    });

    const map = root.querySelector(".sde-bastion-map");
    if (map) this._wirePlan(map, context.plan.base);
    for (const el of root.querySelectorAll("[data-card]")) el.addEventListener("mouseenter", () => this._showCard(el.dataset.card));
    this._showCard(this._card ?? this.state.upgrades.find((u) => u.id !== core.MOAT)?.id ?? this.state.upgrades[0]?.id);
  }

  /** Wheel zooms at the pointer, a drag pans, a double click resets; a click on a room takes it down (GM). */
  _wirePlan(map, base) {
    const view = () => map.getAttribute("viewBox").split(" ").map(Number);
    const remember = (viewBox) => { this._zoom.viewBox = viewBox; map.setAttribute("viewBox", viewBox); };
    const at = (e) => new DOMPoint(e.clientX, e.clientY).matrixTransform(map.getScreenCTM().inverse());
    const baseBox = base.split(" ").map(Number);
    map.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [x, y, w, h] = view(), p = at(e), f = Math.exp(e.deltaY * 0.0015);
      const nw = Math.min(baseBox[2] * 1.2, Math.max(baseBox[2] / 12, w * f)), k = nw / w;
      remember(`${p.x - (p.x - x) * k} ${p.y - (p.y - y) * k} ${nw} ${h * k}`);
    }, { passive: false });
    let drag = null;
    map.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, box: view(), moved: false }; });
    map.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (!e.buttons) { drag = null; return; }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      const r = map.getBoundingClientRect(), [x, y, w, h] = drag.box;
      remember(`${x - (dx * w) / r.width} ${y - (dy * w) / r.width} ${w} ${h}`);
    });
    for (const end of ["pointerup", "pointercancel", "pointerleave"]) map.addEventListener(end, () => setTimeout(() => { drag = null; }, 0));
    map.addEventListener("dblclick", () => remember(base));
    map.addEventListener("mouseover", (e) => { const g = e.target.closest("g[data-id]"); if (g) this._showCard(g.dataset.id); });
    map.addEventListener("click", (e) => {
      if (drag?.moved) return;
      const g = e.target.closest("g[data-id]");
      if (g && game.user.isGM && this._activeTab === "plan" && e.shiftKey) this._confirmTakeDown(g.dataset.id);
    });
  }

  /** The card: an upgrade's outside and inside art, cost and effect. */
  _showCard(id) {
    const box = this.element?.querySelector(".sde-bastion-card");
    const u = id && core.upgradeOf(id);
    if (!box || !u) return;
    this._card = id;
    const inside = !!document.getElementById("sde-bastion-sprites")?.querySelector(`#r-${id}`);
    const bg = '<rect width="512" height="512" fill="#85A478"/>';
    box.innerHTML = `<figure>
        <svg viewBox="0 0 512 512">${bg}<use href="#s-${id}" width="512" height="512"/><use href="#b-${id}" width="512" height="512"/></svg>
        <figcaption>${esc(t("SDE.bastion.card.outside"))}</figcaption>
      </figure>
      <figure>
        <svg viewBox="0 0 512 512">${inside ? `<use href="#r-${id}" width="512" height="512"/>` : '<rect width="512" height="512" fill="#5B99A6"/><rect width="512" height="512" fill="url(#waterHatch)"/>'}</svg>
        <figcaption>${esc(inside ? t("SDE.bastion.card.inside") : t("SDE.bastion.card.moat"))}</figcaption>
      </figure>
      <span class="cost">${esc(format("SDE.bastion.card.cost", { cost: u.cost }))}</span><strong>${esc(t(u.name))}</strong>
      <p>${esc(t(u.effect))}</p>`;
  }
}
