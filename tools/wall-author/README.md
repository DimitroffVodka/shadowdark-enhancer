# Wall author

How a map's walls and doors get into `scripts/importer/adventure/adventure-walls.mjs`. The module ships positions only (fractions
of the map picture); the picture itself comes from the user's book, so it is never committed here.

`ink_rooms.py` is for maps drawn as bold ink rooms with solid black door bars (the Iron Fortress). It reads the white space
between the bold wall lines as floor, joins rooms through their door bars, and turns the floor's outline into closed wall loops,
so a room can only leak where a door is. Maps drawn as caves (the Halls, the Sea Caves) were traced from auto-wall's ink reading
and cleaned by hand; the steps are in the worklog.

```bash
PY=~/FoundryVTT-Projects/auto-wall/.venv/bin/python           # numpy + opencv
$PY ink_rooms.py bars  maps/<site>.json out/                  # bars.png: every solid black bar, numbered
# list the bars that are doors in maps/<site>.json ("doors"), the river banks and bridges to erase ("erase", in squares), the lights
$PY ink_rooms.py build maps/<site>.json out/                  # overlay.png to look at; entry.txt to paste into ADVENTURE_WALLS
```

Copy the map picture next to the json (the `image` name), measure the drawn grid's pitch and origin in pixels, and then:

1. Look at `overlay.png` at full size in several crops: red is the walls, green the doors. A wall wrongly through a river or a
   missing wall at a drawing's gap is a judgement the picture has to settle; fix it in the json (erase polygon, door list).
2. Run `npm test`: the leak test (test/adventure-walls.test.mjs) runs for every map in the data, and the creature test needs
   each numbered room's pin to sit on its own floor. A pin on a wall line or in a cell too small for its creatures moves in
   adventure-layouts.mjs.
3. Build the scene in a throwaway world, darken it, and look: lights stop at the walls and doors, the creatures stand in their rooms.
