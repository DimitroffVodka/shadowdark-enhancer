# Demo site fonts — provenance and licences

Every file here is redistributable. This note records why, because two of the
fonts the module asks for could not simply be copied out of a Foundry install.

Refresh the downloaded ones with `npm run demo:vendor`
(`tools/demo/fetch-vendor.mjs`).

## What the module asks for

`styles/shadowdark-enhancer.css` names four display faces:

| CSS variable | Line | Family requested |
|---|---|---|
| `--sde-bar-font` | 99 | `"Montserrat-Medium"` |
| `--sde-bar-display-font` | 100 | `"Old Newspaper Font"` |
| `--sd-font-head` / `--sd-font-body` | 7848–7849 | `"Montserrat-SemiBold"` / `"Montserrat-Medium"` |
| `--sd-font-title` | 7847 | `"JSL Blackletter"` |

Those family names are filename-derived, not canonical font names, so
`demo.css` declares `@font-face` under **exactly those strings**. That way the
module's own CSS resolves them with no demo-specific overrides.

## Montserrat — shipped

`montserrat-500.woff2`, `montserrat-600.woff2`, `OFL-Montserrat.txt`

SIL Open Font License 1.1, "Copyright 2011 The Montserrat Project Authors".
Fetched from the Google Fonts CDN (latin subset). Weight 500 stands in for
Medium and 600 for SemiBold. Both are declared with an explicit `font-weight`
range so the browser does not synthesise a fake bold.

## Old Newspaper Font — **not** shipped, substituted

`imfell-english-400.woff2`, `OFL-IMFellEnglish.txt`

The original is by Martin Steiner (bit-fonts.com). Its specimen sheet, shipped
with the Shadowdark system as `fonts/old_newspaper_font.jpg`, states
**"All rights reserved"** and **"LICENCE: FREE FOR PERSONAL USE"**, and the
TTF's name table carries no grant. A public project website is not personal
use, so it cannot be redistributed here.

**IM Fell English** stands in: "Copyright (c) 2010, Igino Marini", SIL Open
Font License 1.1. It is a digitisation of late-1600s English metal type — the
same antique-press register as the original, with the irregular inking that
makes the strip's gold display text read the way it does.

It is declared under the family name `"Old Newspaper Font"` with a
`size-adjust`, because IM Fell's glyphs sit smaller on the em than the
original's and the strip's labels would otherwise render visibly undersized.

## JSL Blackletter — shipped verbatim

`JBLACK.TTF`, `JBLACK.TXT`

Copyright (c) 1997–2000 Jeffrey S. Lee. `JBLACK.TXT` grants permission to
freely distribute it **provided it is distributed unaltered and accompanied by
that text file**, and bars inclusion in commercial packages.

So, unlike the others, this one ships as the original `.ttf` — **not** subset
and **not** converted to woff2, since either would alter it. `JBLACK.TXT` sits
beside it to satisfy the second condition. The demo site is free and carries no
commercial package.

Copied from the Shadowdark system's `fonts/` directory; verified byte-identical
by sha256 after copying.

## Fonts deliberately absent

**Font Awesome Pro.** Foundry bundles FA Pro 7.2.0 under a commercial licence
held by Foundry. The demo vendors **FA Free 6.7.2** instead (see
`../fontawesome/LICENSE.txt`). Version 6 rather than 7 is forced by the
module's own family chain at CSS:766 and :1927, which lists
`"Font Awesome 6 Free"` and `"Font Awesome 5 Free"` but no 7 Free — FA Free 6
registers both of those names.

Five Pro-only glyphs (`fa-swords`, `fa-bow-arrow`, `fa-axe`, `fa-dagger`,
`fa-hand-holding-magic`) render blank on the free kit. The demo substitutes the
repo's own vendored game-icons SVGs, which is the module's existing idiom —
`scripts/shared/icons.mjs:30` already renders `combat` that way.
`tools/demo/check-glyphs.mjs` fails the build if a Pro-only glyph reappears.
