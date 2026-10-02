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
import { stateOf, updateOf } from "./bastion-core.mjs";
import { renderPlan } from "./bastion-plan.mjs";
import { isPartyActor, fundingActors, planDeposit, planWithdraw, purseUpdate, purseOf } from "./bastion-funding.mjs";
import { bastionArt } from "./bastion-art.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const SPRITES_URL = `modules/${MODULE_ID}/assets/bastion/sprites.svg`;
const t = (key) => game.i18n.localize(key);
const format = (key, data) => game.i18n.format(key, data);

/** The art as symbols, loaded into the page once so a plan can `<use>` it. */
let spritesLoaded = null;
export function ensureSprites() {
  spritesLoaded ??= (async () => {
    if (document.getElementById("sde-bastion-sprites")) return;
    const text = await (await fetch(foundry.utils.getRoute(SPRITES_URL))).text();
    const holder = document.createElement("div");
    holder.id = "sde-bastion-sprites";
    holder.hidden = true;
    holder.innerHTML = text;
    document.body.append(holder);
  })().catch((err) => { spritesLoaded = null; throw err; });
  return spritesLoaded;
}

/** Why a rules call said no, in words (written out in full: the i18n test scans for keys). */
const WHY = {
  unknown: "SDE.bastion.why.unknown",
  full: "SDE.bastion.why.full",
  unstanding: "SDE.bastion.why.unstanding",
  broke: "SDE.bastion.why.broke",
  tooMany: "SDE.bastion.why.tooMany",
  nothing: "SDE.bastion.why.nothing",
  amount: "SDE.bastion.why.amount",
  built: "SDE.bastion.why.built",
};

const samePurse = (a, b) => a.gp === b.gp && a.sp === b.sp && a.cp === b.cp;

/** A log line, with any i18n key in its data (an upgrade's name) turned into words. */
const logText = (entry) => format(entry.key, Object.fromEntries(
  Object.entries(entry.data ?? {}).map(([k, v]) => [k, typeof v === "string" && v.startsWith("SDE.") ? t(v) : v])));

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

  /** Write a state back, and say so when Foundry vetoed it after the fact. */
  async _write(next) {
    if (!game.user.isGM) return false;
    const update = updateOf(next), was = this.document.system.type;
    // A bastion still wearing its old type's art takes the new type's.
    if (next.type !== was) {
      if (this.document.img === bastionArt(was)) update.img = bastionArt(next.type);
      if (this.document.prototypeToken.texture.src === bastionArt(was)) update["prototypeToken.texture.src"] = bastionArt(next.type);
    }
    const saved = await this.document.update(update);
    if (!saved) ui.notifications?.warn(t("SDE.bastion.notify.notSaved"));
    return !!saved;
  }

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
    const next = core.applyDisaster(this.state, core.rollDisaster(die));
    if (!(await this._write(next))) return;
    const line = logText(next.log.at(-1));
    await ChatMessage.create({ content: `<p><strong>${esc(this.document.name)}</strong> ${esc(line)}</p>`, speaker: { alias: this.document.name } });
  }

  // ── Paying in and out of the treasury ──────────────────────────────────────

  _onDeposit() { return this._fund("deposit"); }
  _onWithdraw() { return this._fund("withdraw"); }

  /** Ask who and how much, then move that gold between a character's purse and the treasury. */
  async _fund(direction) {
    if (!game.user.isGM) return false;
    const link = this.document.system.party;
    const party = link ? await fromUuid(link).catch(() => null) : null;
    const people = fundingActors({
      party,
      resolve: (id) => game.actors.get(id) ?? fromUuidSync(id, { strict: false }),
      players: game.actors.filter((a) => a.type === "Player"),
    });
    if (!people.length) {
      ui.notifications?.warn(t("SDE.bastion.fund.nobody"));
      return false;
    }
    const pick = await this._promptFunding(direction, people);
    const person = pick && people.find((a) => a.uuid === pick.who);
    const gp = Number(pick?.gp);   // not rounded: a part of a coin is refused by the plan, not quietly paid as less
    if (!person) return false;
    return direction === "deposit" ? this._deposit(person, gp) : this._withdraw(person, gp);
  }

  _promptFunding(direction, people) {
    const options = people.map((a) => `<option value="${esc(a.uuid)}">${esc(a.name)} (${esc(format("SDE.bastion.fund.purse", { gp: a.system.coins.gp ?? 0 }))})</option>`).join("");
    const paying = direction === "deposit";
    return foundry.applications.api.DialogV2.prompt({
      window: { title: paying ? "SDE.bastion.fund.depositTitle" : "SDE.bastion.fund.withdrawTitle" },
      content: `<div class="form-group"><label>${esc(t("SDE.bastion.fund.who"))}</label><div class="form-fields"><select name="who">${options}</select></div></div>
        <div class="form-group"><label>${esc(t("SDE.bastion.fund.amount"))}</label><div class="form-fields"><input type="number" name="gp" min="1" step="1" value="10" autofocus></div></div>`,
      ok: {
        label: paying ? "SDE.bastion.fund.deposit" : "SDE.bastion.fund.withdraw",
        callback: (_event, button) => new foundry.applications.ux.FormDataExtended(button.form).object,
      },
      rejectClose: false,
    });
  }

  /**
   * A character pays in: their purse first, then the treasury. Each write is read back, and if the
   * treasury refuses the purse is put back as it was.
   */
  async _deposit(person, gp) {
    const before = this.state, was = purseOf(person), plan = planDeposit(was, gp);
    if (!plan.ok) {
      ui.notifications?.warn(plan.error === "broke" ? format("SDE.bastion.fund.noPurse", { name: person.name, gp }) : t(WHY[plan.error]));
      return false;
    }
    const { state: next, error } = core.deposit(before, gp, person.name);
    if (error) { ui.notifications?.warn(t(WHY[error] ?? WHY.unknown)); return false; }
    const paid = await person.update(purseUpdate(plan.coins));
    if (!paid || !samePurse(purseOf(person), plan.coins)) { ui.notifications?.warn(t("SDE.bastion.notify.notSaved")); return false; }
    if (await this._write(next)) {
      ui.notifications?.info(logText(next.log.at(-1)));
      return true;
    }
    await person.update(purseUpdate(was));
    ui.notifications?.warn(t("SDE.bastion.fund.undone"));
    return false;
  }

  /** The treasury pays out: it first, then the character's purse; if the purse refuses, the treasury is put back. */
  async _withdraw(person, gp) {
    const before = this.state, was = purseOf(person), plan = planWithdraw(was, gp);
    if (!plan.ok) { ui.notifications?.warn(t(WHY[plan.error])); return false; }
    const { state: next, error } = core.withdraw(before, gp, person.name);
    if (error) { ui.notifications?.warn(t(WHY[error] ?? WHY.unknown)); return false; }
    if (!(await this._write(next))) return false;
    const paid = await person.update(purseUpdate(plan.coins));
    if (paid && samePurse(purseOf(person), plan.coins)) {
      ui.notifications?.info(logText(next.log.at(-1)));
      return true;
    }
    await this._write(before);
    ui.notifications?.warn(t("SDE.bastion.fund.undone"));
    return false;
  }

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
