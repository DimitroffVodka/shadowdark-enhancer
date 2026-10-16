// Shared sample data for the Town landing page and Town shop proposals. Nothing here ships.
// The strings are what the real windows will add to languages/en.json; until then the fixtures carry them.
export const art = (n) => `modules/shadowdark-enhancer/assets/bastion/art/${n}.svg`;
export const ico = (p) => `icons/${p}.webp`;

export const STRINGS = {
  "SDE.town.market": "The market",
  "SDE.town.openCount": "{open} of {total} open",
  "SDE.town.wares": "{n} wares",
  "SDE.town.open": "Open",
  "SDE.town.closed": "Closed",
  "SDE.town.visit": "Visit",
  "SDE.town.visitNamed": "Visit {name}",
  "SDE.town.shut": "Closed for now. The GM reopens it.",
  "SDE.town.noMerchants": "No merchants have set up here yet.",
  "SDE.town.noMerchantsGM": "No merchant has set up here yet. Add one from an NPC or a saved shop.",
  "SDE.town.addMerchant": "Add a merchant",
  "SDE.town.around": "Around town",
  "SDE.town.playingAs": "Playing as {name}",
  "SDE.town.edit": "Edit this town",
  "SDE.town.restock": "Restock every shop",
  "SDE.town.priceNoteTip": "This merchant's price markup.",
  "SDE.town.buysBack": "Buys back at {pct}%",
  "SDE.town.purse": "Your purse",
  "SDE.town.search": "Search wares",
  "SDE.town.soldOut": "Sold out",
  "SDE.town.less": "One fewer",
  "SDE.town.more": "One more",
  "SDE.town.quantity": "Quantity",
  "SDE.town.cannotAfford": "You cannot afford this.",
  "SDE.town.buy": "Buy",
  "SDE.town.sell": "Sell",
  "SDE.town.sellNote": "{name} pays {pct}% of the listed price and keeps what you sell.",
  "SDE.town.pays": "Pays {price}",
  "SDE.town.owned": "{n} owned",
  "SDE.town.shutTitle": "{name} has shut up shop",
  "SDE.town.shutBody": "Come back after the next session.",
  "SDE.town.buyingAs": "Buying as",
  "SDE.town.sharedStock": "Stock is shared with your party.",
  "SDE.town.backToTown": "Back to town",
};

export const MERCHANTS = [
  { id: "m1", name: "Hargrave the Smith", role: "Weapons and tools", pitch: "Honest steel at fair prices, and no questions about the blood.", img: art("blacksmith"), wares: 10, open: true },
  { id: "m2", name: "Ysolde Vane", role: "Armorer", pitch: "Mail that has turned worse than you.", img: art("armorer"), wares: 9, open: true },
  { id: "m3", name: "The Gilded Flagon", role: "Inn and provisions", pitch: "Ale, rations and rumours, in that order.", img: art("tavern"), wares: 11, open: true },
  { id: "m4", name: "Mother Quill", role: "Scribe and bookseller", pitch: "Scrolls, ink and secrets. Back after the next session.", img: art("library"), wares: 7, open: false },
];

export const PURSE = "134 gp 12 sp 5 cp";
export const ACTOR = "Creeg Greythorn";
