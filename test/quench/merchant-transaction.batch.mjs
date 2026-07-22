/**
 * Quench batch: merchant transactions — coin-conservation invariants.
 *
 * Drives the REAL GM-side transaction handlers (_handleBuy/_handleSell via
 * _enqueueTx — the same serialized path the socket relay uses) against a
 * disposable NPC-mode shop, asserting the money invariants that matter:
 *   - buy:  buyer copper delta = −price; item lands exactly once with the
 *           requested quantity; shop stock decrements by exactly that much;
 *   - refusal: an unaffordable buy changes NOTHING (coins, inventory, stock);
 *   - sell: buyer copper delta = +cost × sellRatio; item leaves the seller;
 *           the merchant restocks it.
 *
 * Availability is published through the same shopAvailabilityData snapshot a
 * real "open shop" writes, and restored afterward. Skips rather than disturb
 * a genuinely open shop or an open merchant window. An ACTIVE session recap
 * is handled by stubbing SessionRecap.logPurchase/logSale for the batch's
 * duration (restored in after) — skipping instead would silently disable the
 * batch for every recap-using GM. Registered only via quenchReady;
 * test/ never ships in the release zip.
 */
import { MODULE_ID } from "../../scripts/shared/module-id.mjs";
import { MerchantShop } from "../../scripts/merchant/merchant-shop.mjs";
import { SessionRecap } from "../../scripts/session-recap/session-recap.mjs";

const FIXTURE_PREFIX = "Quench SDE Shop";
const WARE = `${FIXTURE_PREFIX} Ware`;

const toCopper = (c) => (c?.gp ?? 0) * 100 + (c?.sp ?? 0) * 10 + (c?.cp ?? 0);

export function registerMerchantTransactionBatch(quench) {
  quench.registerBatch("shadowdark-enhancer.merchant-transaction", (context) => {
    const { describe, it, assert, before, after } = context;

    let merchant = null;
    let buyer = null;
    let savedAvailability;
    let savedLog = null;
    let chatBefore = null;
    let recapStubs = null;
    let publishedAvailability = false;

    const wareEntries = () =>
      MerchantShop._buildInventory("actor", merchant.id).filter((e) => e.name === WARE);
    const inventoryEntry = () => wareEntries()[0];
    const totalStock = () => wareEntries().reduce((s, e) => s + e.stock, 0);

    before(async function () {
      this.timeout(60000);
      if (!game.user.isGM) this.skip();
      // Never clobber a real shopping session.
      if (game.settings.get(MODULE_ID, "shopAvailabilityData")) this.skip();
      if (MerchantShop._app?.rendered) this.skip();
      // A live recap must not absorb fixture transactions — stub the two log
      // entry points for the batch's duration (restored in after()).
      recapStubs = { logPurchase: SessionRecap.logPurchase, logSale: SessionRecap.logSale };
      SessionRecap.logPurchase = async () => {};
      SessionRecap.logSale = async () => {};

      // Self-heal fixtures leaked by a crashed prior run.
      for (const a of game.actors.filter((x) => x.name.startsWith(FIXTURE_PREFIX))) await a.delete();

      savedAvailability = game.settings.get(MODULE_ID, "shopAvailabilityData");
      savedLog = game.settings.get(MODULE_ID, "shopLog");
      chatBefore = new Set(game.messages.map((m) => m.id));

      merchant = await Actor.create({ name: `${FIXTURE_PREFIX} Keeper`, type: "NPC" });
      await merchant.createEmbeddedDocuments("Item", [{
        name: WARE, type: "Basic",
        system: { cost: { gp: 5, sp: 0, cp: 0 }, quantity: 3, description: "<p>fixture</p>" },
      }]);
      buyer = await Actor.create({
        name: `${FIXTURE_PREFIX} Buyer`, type: "Player",
        system: { coins: { gp: 10, sp: 0, cp: 0 } },
      });

      // Publish availability exactly like a real GM "open for players" would.
      await game.settings.set(MODULE_ID, "shopAvailabilityData", {
        mode: "actor", actorId: merchant.id,
        sellRatio: 50, buyMultiplier: 100,
        catalogEnabled: false, gambleEnabled: false,
      });
      publishedAvailability = true;
    });

    after(async function () {
      this.timeout(60000);
      // Every step guards on its own setup marker — a skipped/aborted before()
      // must not make cleanup throw (that reads as a batch failure).
      if (recapStubs) {
        SessionRecap.logPurchase = recapStubs.logPurchase;
        SessionRecap.logSale = recapStubs.logSale;
      }
      if (publishedAvailability) {
        await game.settings.set(MODULE_ID, "shopAvailabilityData", savedAvailability ?? null);
      }
      if (savedLog !== null) await game.settings.set(MODULE_ID, "shopLog", savedLog ?? []);
      if (chatBefore) {
        // Drop the chat cards the transactions emitted — GM-visible noise only.
        const newMessages = game.messages.filter((m) => !chatBefore.has(m.id));
        for (const m of newMessages) await m.delete();
      }
      await buyer?.delete();
      await merchant?.delete();
    });

    describe("buy / refuse / sell against system.coins", function () {
      it("buy: coin delta = −price, item lands once, stock decrements", async function () {
        this.timeout(60000);
        const entry = inventoryEntry();
        assert.exists(entry, "fixture ware missing from shop inventory");
        assert.equal(entry.stock, 3, "starting stock wrong");
        const copperBefore = toCopper(buyer.system.coins);

        await MerchantShop._enqueueTx(() => MerchantShop._handleBuy({
          buyerActorId: buyer.id, shopItemId: entry.id, quantity: 1, userId: game.userId,
        }));

        const copperAfter = toCopper(buyer.system.coins);
        assert.equal(copperBefore - copperAfter, 500, "buy did not deduct exactly 5 gp");
        const owned = buyer.items.filter((i) => i.name === WARE);
        assert.equal(owned.length, 1, "item did not land exactly once");
        assert.equal(owned[0].system.quantity, 1, "bought quantity wrong (stack-size leak?)");
        assert.equal(inventoryEntry().stock, 2, "stock did not decrement by 1");
      });

      it("refusal: an unaffordable buy changes nothing", async function () {
        this.timeout(60000);
        const entry = inventoryEntry();
        const copperBefore = toCopper(buyer.system.coins);   // 5 gp left; 2×5 gp unaffordable
        const ownedBefore = buyer.items.filter((i) => i.name === WARE).length;

        await MerchantShop._enqueueTx(() => MerchantShop._handleBuy({
          buyerActorId: buyer.id, shopItemId: entry.id, quantity: 2, userId: game.userId,
        }));

        assert.equal(toCopper(buyer.system.coins), copperBefore, "refused buy moved money");
        assert.equal(buyer.items.filter((i) => i.name === WARE).length, ownedBefore,
          "refused buy delivered an item");
        assert.equal(inventoryEntry().stock, 2, "refused buy changed stock");
      });

      it("sell: coin delta = +cost × sellRatio, item leaves, merchant restocks", async function () {
        this.timeout(60000);
        const item = buyer.items.find((i) => i.name === WARE);
        assert.exists(item, "nothing to sell — buy test did not run?");
        const copperBefore = toCopper(buyer.system.coins);

        await MerchantShop._enqueueTx(() => MerchantShop._handleSell({
          sellerActorId: buyer.id, itemId: item.id, quantity: 1, userId: game.userId,
        }));

        // 5 gp at sellRatio 50 → 250 copper back.
        assert.equal(toCopper(buyer.system.coins) - copperBefore, 250,
          "sell did not credit exactly half the cost");
        assert.equal(buyer.items.filter((i) => i.name === WARE).length, 0,
          "sold item still on the seller");
        // Restock lands as its own stack on the merchant (headless ctx path —
        // the 2026-07-21 _restockMerchantInventory fix); total across stacks
        // must be back to 3.
        assert.equal(totalStock(), 3, "merchant did not restock the sold item");
      });
    });
  }, { displayName: "Shadowdark Enhancer: merchant transactions — coin conservation" });
}
