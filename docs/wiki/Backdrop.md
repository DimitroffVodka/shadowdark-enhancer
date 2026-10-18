# Backdrop

[← Wiki home](index.md) · [Camping](Camping.md)

The Backdrop is one full-screen picture that every connected player sees behind
Foundry's windows and toolbar. It is the same on every scene, so it covers the
map without you having to move the table anywhere. It is kept in a world setting,
so it survives a reload and a player who joins late sees it too.

The party's camp is the automatic place. You can also keep your own list of
pictures, see [Backdrop places](#backdrop-places). A place can also carry a Town page, see [A Town page on a place](#a-town-page-on-a-place). A fight with no battle map is drawn over it as
[Zone Combat](Zone-Combat.md).

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
  camp picture** in the Camping window switches to the camp by hand.
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

**The kind.** The kind labels the place, and a Town or Tavern place is not
replaced by a camp that begins (the Show camp picture button still switches by
hand). No town or
tavern pictures ship with the module: you add your own.

The list is its own hidden world setting, apart from the one that holds what is
showing, so neither overwrites the other.

## A Town page on a place

A place (of any kind) can open a Town page over the Backdrop for everyone.

1. On a scene, press the Town tool to make its page, and edit it with the
   pencil on the page ([Town Landing Page](Town-Landing-Page.md)).
2. In Backdrop places, set the place's **Page scene** to that scene. Only scenes
   that already have a page are listed, and only scenes your players can see
   (give them at least Limited ownership of the scene): a scene they have no
   access to never reaches their client, so they see the Backdrop with no page
   and no notice. In the Add form you can leave the
   picture empty: a Town or Tavern place then uses that scene's background as
   its picture (a Custom place still needs one).
3. Making a page with the Town tool also switches it on for everyone viewing
   that scene. If it should appear only on the Backdrop, switch the page off with
   its own switch after making it; otherwise it also shows whenever someone views
   that scene, and the hide icon below hides only the Backdrop.
4. Show the place. The picture goes up and the page opens over it for everyone.

While it is up:

- The page stays when the GM changes the canvas scene. A page on the new canvas
  scene does not replace it, and when the Backdrop drops, the canvas scene's own
  page comes back if it is shown.
- The page's hide icon drops the Backdrop, and the page closes with it. It also
  closes if the place changes, or the page or its scene is removed. If that
  happens, the place keeps its Page scene and shows "Page missing" until you
  pick another or None.
- A camp that begins does not replace a Town or Tavern place or its page (that guard is by the place's kind; a Camp or Custom place is replaced).
- Shopping works with no GM connected. Carousing needs a GM connected.

## What it does not do yet

- No tavern page tiles yet; a Tavern place hosts the same Town page as a Town place.
- No pictures for town or tavern come with the module.
- It is not in the Settings list; the values sit in hidden world settings.
