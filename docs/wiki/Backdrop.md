# Backdrop

[← Wiki home](index.md) · [Camping](Camping.md)

The Backdrop is one full-screen picture that every connected player sees behind
Foundry's windows and toolbar. It is the same on every scene, so it covers the
map without you having to move the table anywhere. It is kept in a world setting,
so it survives a reload and a player who joins late sees it too.

The party's camp is the automatic place. You can also keep your own list of
pictures, see [Backdrop places](#backdrop-places). Town and tavern pages and zone
combat are not here yet.

---

## The toolbar tool

A GM gets a **Backdrop** tool in the Tokens group of the left toolbar. It is lit
while the picture is up. Click it to hide the picture; click it again to bring a picture
back: the last custom place you showed, if it still exists, otherwise the camp
picture. Players have no tool and cannot hide it.

While the picture is up, selected tokens are released for the GM and for the
players, so the arrow keys do not move tokens on the map underneath.

## How a camp raises and drops it

- **It rises once, when a camp begins** (Begin in the [Camping](Camping.md)
  window, or Overland making camp for the night), and only when there is no
  party token: the party actor's own token on the hex map the active GM is
  viewing (the characters' tokens do not count). A camp that begins with the
  party token on the hex map does not cover the map, so its fire light and the
  night time-lapse stay visible; an Overland camp has the party token there, so
  it normally will not raise. Raise it by hand then (below). A camp in a dungeon
  or town with only the characters' tokens on the map is covered by the picture,
  and the GM hides it from the Backdrop tool.
- A camp that begins does not replace a Town or Tavern place that is up. **Show
  camp picture** in the Camping window switches to the camp by hand. A place can
  later point at a page scene; that is not in this release and has no control yet.
- Water terrain does not raise it by itself: the boat is the camp.
- Camps run by Shadowdark Extras do not raise it.
- **After a GM hides it, it stays down for that camp.** Task picks, token moves, a
  reload and a second GM do not bring it back. The next night's camp raises it
  again.
- **It drops by itself when that camp ends or is cancelled**, but only while it is
  still showing that party's camp. A picture you raised by hand during a running
  camp drops with it; one raised after the camp ended stays until you hide it.

## Show camp picture

The Camping window has a **Show camp picture** button for the GM, in the
standalone window and in the Travel tab of the Party sheet. It raises the Backdrop
by hand, which is how you get it when the party token is on the map.

## Bring the table

[Bring the table](Encounter-Battle-Maps.md#bring-the-table) on a battle map hides
the Backdrop first, also when the battle scene is already the active scene.
Return to travel does not bring it back.

## How it chooses the picture

The picture is the camp version of the battle map for the party's terrain. These
are the camp pictures that ship with the module for
[Encounter Battle Maps](Encounter-Battle-Maps.md).

| Party's terrain | Camp picture |
|---|---|
| Forest | Forest woods (camp) |
| Path | Forest road (camp) |
| Grassland | Open grassland (camp) |
| Jungle | Dense jungle (camp) |
| Swamp | Swamp bog (camp) |
| Desert | Desert dunes (camp) |
| Salt flat | Salt flat (camp) |
| Any other terrain (canyon, mountain, coast, volcano, lava, deep tunnels), or none known | Forest woods (camp) |

River, lake, ocean and arctic sea never raise it by themselves; a hand raise
there shows Forest woods (camp).

## Backdrop places

A GM can keep a list of up to 24 named places, each with its own picture. The
camp picture is not in this list: it stays automatic.

**The window.** A second GM-only button, **Backdrop places**, sits beside the
Backdrop tool in the Tokens group. It opens a window with an **Add a place** form
and the list of your places. Each row has a thumbnail, a name you can edit, a kind,
and the buttons **Show** (or **Hide** while it is up), **Replace picture** and
**Delete**.

**Adding one.** Type a name (left empty, it takes the kind's word, such as
Tavern), pick a kind (Town, Tavern, Camp or Custom) and choose a picture from your
own computer, then press **Add place**. At 24 places you get a notice and must
delete one first.

**What happens to the picture.** It is shrunk so its longest side is at most
2560 px (a smaller picture is never enlarged) and saved as WebP, or as JPEG if
your browser cannot make WebP. It goes into the world's `stage` folder
(`worlds/<world id>/stage/`), which is created the first time. Adding or replacing
a picture needs the Upload New Files permission; a GM without it gets a notice.
A file that is not a picture is refused before anything is uploaded.

**Show and Hide.** Show puts the place's picture up for everyone exactly like the
camp picture: the same layer, the same release of selected tokens, and
[Bring the table](Encounter-Battle-Maps.md#bring-the-table) hides it. Replacing
the picture of the place that is up changes what the table sees. A camp that
begins raises the camp picture over a Custom or Camp place, but never over a Town or
Tavern place; a camp ending or being
cancelled never takes down a custom place, you hide it yourself.

**Delete.** It asks first and names the place. Deleting a place that is up hides
the Backdrop. The picture file stays in the world folder.

**The kind.** For now the kind only labels the place. Town and tavern pages are
planned, not built, and no town or tavern pictures ship with the module: you add
your own.

The list is its own hidden world setting, apart from the one that holds what is
showing, so neither overwrites the other.

## What it does not do yet

- No town or tavern pages, and no zone combat.
- No pictures for town or tavern come with the module.
- It is not in the Settings list; the values sit in hidden world settings.
