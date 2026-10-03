# Adventure layouts

Developer tools that produced `scripts/importer/adventure/adventure-layouts.mjs`:
where each room number sits on its map, as fractions of the map image. They read the
GM's own books and map images and write positions only; nothing here ships book text
or art.

Needs: Python 3 with `numpy`, `Pillow` and `opencv-python-headless`; `pdftoppm` and
`pdftotext` (poppler); for `derive_circles.py` also `tesseract` with the English
`traineddata` (`TESSDATA_PREFIX` pointing at it).

## Maps whose numbers are text in the book's PDF (`derive_pdf.py`)

The book prints the map on a page with the room numbers as text over it. The tool
renders the page, finds your map image on it (all four rotations, several starting
placements, refined with an affine ECC fit, so a book that prints the map a little
stretched or rotated is fine), and carries each number across.

    python3 derive_pdf.py config.json outdir [site-id ...]

`config.json` is a list of `{ "id", "pdf", "page", "vtt", "lo", "hi" }`: the site's id
(from `adventure-manifest.mjs`), the book's PDF, the PDF page with the map, the map
image, and the lowest and highest room number. It writes `<id>.json` (the pins) and
`<id>.png` (your image with every pin drawn on it). Look at every `.png`: the fit score
is in the output, and a low one or a missing number is the sign to check.

## Maps with numbered discs in the image (`derive_circles.py`)

A map image with black numbered discs baked in (the City of Masks): `cands.py` finds the
discs and writes an index-labelled contact sheet; read the numbers off the sheet and
assign them, then the pins are the disc centres. (`derive_circles.py` tries to read the
digits itself and is a good first pass, but small discs are misread.)

## Adding the result

Turn each `<id>.json` into the block for `ADVENTURE_LAYOUTS` with the placer's own
formatter (`layoutSnippet` in `adventure-layouts.mjs`), keeping the file in manifest
order. `npm test` checks every layout covers its site's whole range, sits inside the
map and has the shape of the site's printed grid.
