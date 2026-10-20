/**
 * Shadowdark Enhancer — the landing page (ApplicationV2): a table you sit at.
 *
 * The module's own render of a candle-lit table fills the screen, dim and a little desaturated; the props on it are the
 * buttons (landing-table-core.mjs). The prop under the pointer comes up to full colour with a warm glow and its name:
 * the quest tome (its pages list the active quests with tick boxes), the coin chest (the party's coin; it opens to the
 * market), the dice cup, the tankard, the framed map, the sealed letter, the hourglass and the journal. The session
 * title card is the GM's to write on; the day dial follows the world's clock. The party's portraits sit round the
 * table: hover for a card, click for the sheet (players: their own). The GM also gets the settlement size, a pencil
 * (the landing page editor), the sales log, a Restock for every shop, a way to take the page away, and Return.
 * It opens by itself on arriving at a landing scene (town-entry-points.mjs).
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { shelf } from "../merchant/shop-core.mjs";
import { Party } from "../party/party.mjs";
import { Quests } from "../quests/quests.mjs";
import { DowntimeSession } from "../downtime/downtime-session.mjs";
import { SIZES } from "../merchant/stock-generator.mjs";
import { landingOf, normalizeLanding, restockAll } from "./town-core.mjs";
import { buyerFor, characters, nightParty, openPlace, redrawOnChange, switchTown, today, updateLanding } from "./town-live.mjs";
import { placeTiles, purseText } from "./town-view.mjs";
import { TABLE, dialAngle, homography, propAtHit, propSrc, seatsFor, tableProps, tomePages } from "./landing-table-core.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The boxes the overlays are drawn in before they are laid onto their props (picture pixels at the prop's own scale). */
const PAGE_BOX = [300, 410], TITLE_BOX = [700, 150], DIAL_BOX = [400, 400];

/** The click map, read once: which prop is under each quarter-size pixel of the picture. */
let hitMap = null;
async function loadHitMap() {
  if (hitMap) return hitMap;
  const img = new Image();
  img.src = TABLE.hit;
  await img.decode();
  const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight), ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  hitMap = { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
  return hitMap;
}

const sumCoins = (actors) => actors.reduce((s, a) => {
  const c = a?.system?.coins ?? {};
  return { gp: s.gp + (Number(c.gp) || 0), sp: s.sp + (Number(c.sp) || 0), cp: s.cp + (Number(c.cp) || 0) };
}, { gp: 0, sp: 0, cp: 0 });

export class TownApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-town",
    classes: ["shadowdark-enhancer", "sde-ui", "sde-town", "lt-root"],
    window: { frame: false, positioned: false },
    actions: {
      prop: TownApp.prototype._onProp,
      seat: TownApp.prototype._onSeat,
      party: TownApp.prototype._onParty,
      editTown: TownApp.prototype._onEdit,
      openLog: TownApp.prototype._onLog,
      restockAll: TownApp.prototype._onRestockAll,
      hideTown: TownApp.prototype._onHide,
      returnTable: TownApp.prototype._onReturn,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/town/town-table.hbs` },
  };

  scene = null;
  _stop = null;
  _watch = null;
  _fit = null;
  _marketId = null;

  /** Open (or bring forward) the landing page for a scene that has one. */
  static open(scene = globalThis.canvas?.scene) {
    if (!landingOf(scene)) { ui.notifications.warn(t("SDE.town.noPage")); return null; }
    const app = foundry.applications.instances.get(TownApp.DEFAULT_OPTIONS.id) ?? new TownApp();
    app.scene = scene;
    app.render({ force: true });
    return app;
  }

  get townName() { return landingOf(this.scene)?.title || this.scene?.name || t("SDE.town.title"); }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const page = landingOf(this.scene) ?? normalizeLanding({});
    const isGM = game.user.isGM, table = characters();
    const merchants = page.merchants.map((m) => {
      const actor = game.actors.get(m.actorId);
      return { id: m.id, name: actor?.name ?? t("SDE.town.editor.missingName"), open: m.open && !!actor, missing: !actor, wares: actor ? shelf(actor.items.contents, m, table).filter((w) => w.stock !== 0).length : 0 };
    }).filter((m) => isGM || !m.missing);
    const market = merchants.find((m) => m.open) ?? merchants[0];
    this._marketId = market?.id ?? null;
    const active = Quests.list({ status: "active" });
    const { hasRumorsHeard } = await import("../rumors/rumors.mjs");
    const hasMap = page.places.includes("map") ? await (await import("./landing-map.mjs")).hasMap() : false;
    const tiles = placeTiles([...page.places, ...(page.games.on ? ["games"] : [])], {
      isGM, hasParty: Party.list().length > 0, downtimeOpen: DowntimeSession.active, activeQuests: active.length, nightOpen: !!nightParty(),
      gmOnline: !!game.users.activeGM, rumorsHeard: hasRumorsHeard(), hasMap, t,
    });
    const labels = Object.fromEntries(tiles.map((p) => [p.id, { name: p.label, sub: p.tag || p.sub, disabled: p.disabled, hint: p.hint }]));
    labels.market = { name: t("SDE.town.table.market"), sub: market?.name ?? "", disabled: !market?.open, hint: t("SDE.town.shut") };
    const party = Party.selected() ?? Party.list()[0];
    const members = party ? Party.members(party).map((uuid) => fromUuidSync(uuid)).filter(Boolean) : [];
    const buyer = buyerFor();
    const L = TABLE.layout;
    const [left, right] = tomePages(active, 5);
    const clock = game.time.components ?? {};
    return Object.assign(context, {
      isGM, townName: this.townName, table: TABLE,
      sizes: SIZES.map((z) => ({ id: z.id, label: t(z.labelKey), selected: z.id === (page.size ?? "town") })),
      returnName: isGM && page.returnTo !== this.scene?.id ? game.scenes.get(page.returnTo ?? "")?.name ?? "" : "",
      actorName: buyer?.name ?? "", purse: buyer ? purseText(buyer.system.coins) : "",
      props: tableProps(page, { hasMerchant: !!market, labels }),
      chestOpen: L.marketOpen ? { ...L.marketOpen, src: propSrc("market-open") } : null,
      coin: { text: purseText(sumCoins(members)), x: L.chestFront[0], y: L.chestFront[1] },
      tome: page.places.includes("quests") ? [
        { lines: left, empty: !left.length, transform: homography(...PAGE_BOX, L.tomeLeft), box: PAGE_BOX },
        { lines: right, transform: homography(...PAGE_BOX, L.tomeRight), box: PAGE_BOX, flip: true },
      ] : null,
      title: { text: page.sessionTitle, transform: homography(...TITLE_BOX, L.title), box: TITLE_BOX },
      dial: {
        angle: dialAngle((Number(clock.hour) || 0) + (Number(clock.minute) || 0) / 60), transform: homography(...DIAL_BOX, L.dial), box: DIAL_BOX,
        ticks: Array.from({ length: 24 }, (_, i) => ({ deg: i * 15, len: i % 6 ? 20 : 30 })),
      },
      seats: seatsFor(members.length).map((at, i) => this._seat(members[i], at)),
      // The Party plaque sits under the far side's portraits, centred on them.
      party: party && page.places.includes("party") ? { x: (L.seats[0][0] + L.seats[Math.min(3, Math.max(0, members.length - 1))][0]) / 2, y: L.seats[0][1] + 92 } : null,
    });
  }

  /** A portrait round the table and its card: name, level, class, hit points and purse. */
  _seat(actor, at) {
    const sys = actor.system ?? {}, hp = sys.attributes?.hp ?? {};
    let cls = "";
    try { cls = sys.class ? fromUuidSync(sys.class)?.name ?? "" : ""; } catch { cls = ""; }
    return {
      ...at, id: actor.id, name: actor.name, img: actor.img || "icons/svg/mystery-man.svg", mine: actor.isOwner,
      level: sys.level?.value ?? "", cls, hp: hp.max ? `${hp.value ?? 0} / ${hp.max}` : "", purse: purseText(sys.coins ?? {}),
    };
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this._stop = redrawOnChange(this);
    this._fit = () => this._fitToScreen();
    this._watch = new ResizeObserver(this._fit);
    for (const id of ["sidebar", "scene-controls", "hotbar"]) { const el = document.getElementById(id); if (el) this._watch.observe(el); }
    window.addEventListener("resize", this._fit);
    // The clock ticks every second under real-time light tracking: only the dial's hand moves, the page is not redrawn.
    this._clock = Hooks.on("updateWorldTime", () => this._turnHand());
  }

  _onClose(options) {
    this._stop?.();
    this._stop = null;
    this._watch?.disconnect();
    this._watch = null;
    window.removeEventListener("resize", this._fit);
    Hooks.off("updateWorldTime", this._clock);
    super._onClose?.(options);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this._fitToScreen();
    const pic = this.element.querySelector(".lt-pic");
    // A redraw (a purchase, a quest ticked) keeps the prop under the pointer lit.
    if (pic && this._hot) { pic.dataset.hot = ""; this._light(pic, this._hot); }
    // The prop under the pointer, read from the click map, so the light follows the prop's own outline.
    pic?.addEventListener("pointermove", (event) => this._hover(event, pic));
    pic?.addEventListener("pointerleave", () => this._light(pic, null));
    pic?.addEventListener("click", (event) => {
      if (event.target.closest("button, [contenteditable], select, .lt-seat")) return;
      const id = pic.dataset.hot;
      if (id) this._onProp(event, pic.querySelector(`.lt-prop[data-prop="${id}"]`));
    });
    const title = this.element.querySelector(".lt-title-text[contenteditable]");
    title?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); title.blur(); } });
    title?.addEventListener("blur", () => this._saveTitle(title.textContent));
    this.element.querySelector("select[name=size]")?.addEventListener("change", (event) => this._setSize(event.target.value));
  }

  /**
   * The table fills the screen left of Foundry's sidebar, and the picture fits between the scene tools (left) and the
   * hotbar (below); it is drawn at its own 2560 x 1440 and scaled as one (--lt-k).
   */
  _fitToScreen() {
    const root = this.element;
    if (!root) return;
    const side = document.getElementById("sidebar")?.offsetWidth ?? 42;
    const left = Math.ceil(document.getElementById("scene-controls")?.getBoundingClientRect().right ?? 0) + 6;
    const hotbar = document.getElementById("hotbar")?.getBoundingClientRect();
    const bottom = hotbar?.height ? Math.ceil(window.innerHeight - hotbar.top) + 6 : 0;
    const k = Math.min((window.innerWidth - side - left - 8) / TABLE.width, (window.innerHeight - bottom - 8) / TABLE.height);
    root.style.setProperty("--sde-town-side", `${side}px`);
    root.style.setProperty("--sde-town-left", `${left}px`);
    root.style.setProperty("--sde-town-bottom", `${bottom}px`);
    root.style.setProperty("--lt-k", String(Math.max(0.1, k)));
  }

  async _hover(event, pic) {
    const map = await loadHitMap().catch(() => null);
    if (!map) return;
    const r = pic.getBoundingClientRect();
    const x = Math.floor(((event.clientX - r.left) / r.width) * map.w), y = Math.floor(((event.clientY - r.top) / r.height) * map.h);
    const id = x >= 0 && y >= 0 && x < map.w && y < map.h ? propAtHit(map.data[(y * map.w + x) * 4]) : null;
    this._light(pic, event.target.closest(".lt-seat, .lt-gm, .lt-party, [contenteditable]") ? null : id);
  }

  /** Light one prop (or none): only a prop this page shows. */
  _light(pic, id) {
    const button = id && pic.querySelector(`.lt-prop[data-prop="${id}"]`);
    const hot = button ? id : "";
    this._hot = hot;
    if (pic.dataset.hot === hot) return;
    pic.dataset.hot = hot;
    for (const b of pic.querySelectorAll(".lt-prop")) b.classList.toggle("hot", b.dataset.prop === hot);
    pic.style.cursor = button && button.getAttribute("aria-disabled") !== "true" ? "pointer" : "";
  }

  /** The day dial's hand, turned to the world's time of day without redrawing the page. */
  _turnHand() {
    const hand = this.element?.querySelector(".lt-dial .lt-hand");
    const c = game.time.components ?? {};
    hand?.setAttribute("transform", `rotate(${dialAngle((Number(c.hour) || 0) + (Number(c.minute) || 0) / 60)} 100 100)`);
  }

  /** A prop was pressed: the tome turns a page and the chest opens before their windows do. */
  async _onProp(_event, target) {
    if (!target || target.getAttribute("aria-disabled") === "true") return null;
    const id = target.dataset.prop, root = this.element;
    if (id === "quests" || id === "market") {
      root.classList.remove("opening-quests", "opening-market");
      void root.offsetWidth;
      root.classList.add(`opening-${id}`);
      setTimeout(() => root.classList.remove(`opening-${id}`), 1800);
      await new Promise((r) => setTimeout(r, 480));
    }
    if (id === "market") {
      const { TownShopApp } = await import("./town-shop-app.mjs");
      return TownShopApp.open(this.scene, this._marketId);
    }
    return openPlace(id, this.scene);
  }

  /** A portrait: its sheet, for its owner (a GM: any). */
  _onSeat(_event, target) {
    const actor = game.actors.get(target.dataset.actorId);
    if (!actor?.isOwner) return null;
    return actor.sheet?.render(true);
  }

  _onParty() { return openPlace("party", this.scene); }

  async _saveTitle(text) {
    if (!game.user.isGM) return;
    const value = String(text ?? "").trim().slice(0, 120);
    if (value === (landingOf(this.scene)?.sessionTitle ?? "")) return;
    await updateLanding(this.scene, (page) => page && { ...page, sessionTitle: value });
  }

  /** The settlement's size: the market's stock follows it, rolled again at once. */
  async _setSize(size) {
    if (!game.user.isGM) return;
    const { resize } = await import("./landing-pages.mjs");
    await resize(this.scene, size);
  }

  /** Everyone back to the scene they came from. */
  async _onReturn() { return (await import("./landing-pages.mjs")).returnFromPage(this.scene); }

  /** Away for the whole table. */
  _onHide() { return switchTown(this.scene, false); }

  async _onLog() {
    const { TownLogApp } = await import("./town-log-app.mjs");
    return TownLogApp.open(this.scene);
  }

  async _onEdit() {
    const { TownEditorApp } = await import("./town-editor-app.mjs");
    return TownEditorApp.open(this.scene);
  }

  /** Every shop's shelf back at once: each merchant's revision goes up (nothing is written to any player). */
  async _onRestockAll() {
    const day = today();
    await updateLanding(this.scene, (page) => page && restockAll(page, day));
    ui.notifications.info(t("SDE.town.restocked"));
  }
}
