// A Bastion's Armorer shop open to the GM: six party members in the buyer dropdown, 24 stock rows with long names and
// bundles, search box, markup hint. state: open | closed (the room was taken down). Real window: 560 x 620.
const names = ["Leather armor", "Chainmail", "Plate mail", "Shield", "Mithral chain shirt of the Lantern Hold, enchanted by Orlandu of the Seven Spires for a long-forgotten king", "Supercalifragilisticexpialidocious_Longsword_of_Unbreakingness_Plus_Three", "Crossbow bolts", "Dagger", "Greataxe", "Warhammer", "Spear", "Shortbow", "Arrows", "Shortsword", "Mace", "Handaxe", "Light crossbow", "Longbow", "Halberd", "Net", "Lance", "Sling bullets", "Staff", "Club"];
const stock = names.map((name, i) => ({ uuid: "u" + i, key: name.toLowerCase(), name, img: "/icons/svg/item-bag.svg", bundle: /bolts|Arrows|bullets/.test(name) ? "20" : "", list: `${5 + i * 3} gp`, price: `${6 + i * 3} gp ${i % 2 ? "5 sp" : ""}` }));
const people = ["Creeg Greythorn", "Elbin Grizzlegut", "Iraga Draguul", "Jorbin Ironhelm", "Martin Rast", "Bartholomew the Unfortunate"].map((name, i) => ({ id: "p" + i, name, selected: i === 0 }));
export default {
  title: "Armorer: The Lantern Hold", icon: "fa-solid fa-store", classes: ["shadowdark-enhancer", "sde-bastion-shop"], resizable: true, width: 560, height: 620, template: "templates/bastion-shop.hbs", initial: "open",
  build: (s) => ({ context: { open: s.startsWith("open"), markup: 20, people, purse: "134 gp 12 sp 5 cp", stock: s.startsWith("open") ? stock : [] }, ...(s === "open-full" ? { height: 1700 } : {}) }),
  toolbar: `<span>State:</span><button data-action="s" data-state="open">open</button><button data-action="s" data-state="closed">closed</button>`, actions: { s: { state: "{state}" } },
};
