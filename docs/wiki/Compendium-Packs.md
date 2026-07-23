# Compendium Packs

[← Wiki home](Home.md)

Where the module keeps content it creates, and the rules it follows about your
data.

---

## The content contract

Four rules, applied everywhere:

1. **Every document-creating entry point is GM-only.**
2. **Nothing is overwritten silently.** Conflicts always prompt.
3. **Nothing is ever deleted.** The module does not call `deleteCompendium`, and
   the guided duplicate-cull only ever removes copies inside its own packs —
   never world documents, never `_Backup` documents.
4. **Re-importing is idempotent.** The same paste committed twice does not
   produce two copies.

Everything the module creates is an **ordinary Foundry document**. Disable or
remove the module and your content stays readable and usable.

## The packs

Packs are **world compendiums**, created on demand — nothing exists until
something needs it. They live in the sidebar under a **Shadowdark Enhancer**
folder.

### Suite packs

| Pack id | Type | Label | Holds |
|---|---|---|---|
| `sde-actors` | Actor | Shadowdark Enhancer — Actors | Imported monsters |
| `sde-items` | Item | Shadowdark Enhancer — Items | Imported items, spells, gear |
| `sde-tables` | RollTable | Shadowdark Enhancer — Roll Tables | Imported tables |
| `sde-journal` | JournalEntry | Shadowdark Enhancer — Journals | *(structural)* |
| `sde-scenes` | Scene | Shadowdark Enhancer — Scenes | *(structural)* |

### Character Options packs

Nested under a **Character Options** sub-folder, mirroring the system's own
grouping:

| Pack id | Label |
|---|---|
| `classes` | Classes |
| `talents` | Talents |
| `class-abilties` | Class Abilties |
| `spells` | Spells |
| `background` | Background |
| `ancestries` | Ancestries |
| `languages` | Languages |
| `patrons-and-deities` | Patrons and Deities |

> **The odd ids and the `Class Abilties` spelling are deliberate.** These packs'
> **labels slugify to their collection ids** (`Classes` → `world.classes`), so
> importing a bundle into a fresh world recreates the identical `world.<slug>`
> collection. That keeps every cross-pack `@UUID` reference valid —
> class → talent, spell → class, table → document, ancestry → talent. Renaming
> them to fix the typo would break links in every exported bundle. Two packs
> (Languages, Patrons and Deities) are carried empty purely so an imported suite
> mirrors its source exactly.

## Source folders

Inside each pack, content is filed into a folder named for the book it came from,
derived from the source label you commit with:

| You type | Folder |
|---|---|
| `cs1` … `cs6`, or `Cursed Scroll 1` … `6` | `CS1` … `CS6` |
| `pgwr`, `gmgwr`, `wr`, `Western Reaches` | `Western Reaches` |
| `core`, `Core Rulebook` | `CORE` |
| *(blank)* or `custom` | `Custom` |
| anything else | Upper-cased |

Both the short code and the full book name fold to the **same** folder — this
matters, because the Manage tree's census is keyed on the short form. An import
filed under the wrong label will show as a gap forever while a duplicate all-caps
folder sits beside it.

## Link resolution

`@UUID` links resolve to the **system's own `shadowdark.*` packs first**, and
fall back to the module's world packs. Imported content prefers to point at the
content you already had rather than at a copy.

## Ownership

Players get **Observer** on **`sde-actors` only** — so monster `@UUID` links
resolve on player-facing sheets and cards. **Every other suite pack is GM-only**
(player ownership `NONE`): items, tables, journals, scenes, and all the
Character Options packs. Player-facing features (the builder, the merchant)
read that content through GM-mediated paths instead. Note that v14
compendium ownership maps user **role names** to ownership level **names** as
strings — numeric levels are silently rejected, which is why you may see this
handled explicitly in the code.

## Moving content between worlds

Use the [Importer Hub](Importer-Hub.md)'s **bundle export/import** (Tools menu).
It writes the whole suite as one JSON file. On import it validates, **skips
anything that already exists, and never overwrites** — so it is a way to seed a
new world, not to sync two worlds.

Because pack ids are reconstructed from labels, a bundle imported into a fresh
world keeps all its internal links intact.

---

## Troubleshooting

**The packs don't exist.**
They are created on demand. Import something and they appear.

**Content landed in a `Custom` folder.**
You committed without a source label. Set the source before committing — the
Source dropdown offers Core Rulebook, Cursed Scroll 1–6, and Western Reaches.

**A duplicate all-caps folder appeared next to the proper one (e.g. `CURSED SCROLL 1` beside `CS1`).**
A source label was used that didn't fold to the expected short code. Move the
documents into the correct folder; future imports with a recognised label will
file correctly.

**Links broke after importing a bundle into a new world.**
Check that the Character Options packs came across with their original labels —
the collection ids are derived from them. A renamed pack means a different
`world.<slug>` and dead links.

**I want to delete a pack.**
Do it yourself in the sidebar. The module will never delete a compendium, so
nothing is going to remove it for you — and nothing will object if you do.

---

**Related:** [Importer Hub](Importer-Hub.md) · [Monster Token Art](Monster-Token-Art.md) · [API](../API.md)
