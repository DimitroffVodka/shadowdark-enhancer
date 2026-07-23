# Export to PDF

[← Wiki home](Home.md)

Fill a real, form-fillable Shadowdark character sheet PDF from an actor.

---

## Using it

Open a **Player** character sheet. The button is in the sheet window's header,
labelled **PDF** with a red PDF icon:

![The PDF button in a character sheet header](images/pdf-export-button.png)

It is shown only to the character's **owner** — the player who owns it, or a GM
(who owns everything). It attaches to the Shadowdark system's own player sheet,
so it does not appear on NPC sheets or on other systems' sheets.

Click it and you get the filled PDF.

## Where the file goes

The module uses your browser's native **Save As** dialog where available, so you
choose the location. If your browser doesn't support it, it falls back to an
ordinary download.

## What gets filled in

- **Abilities**, with active-effect bonuses applied
- **Attacks**
- **Gear and slot usage**
- **Spells**, with lost markers and a short summary
- **Talents**
- **Languages**
- **Class and ancestry features**

Data is read from the Shadowdark data model's **own computed values** — the same
getters the sheet uses — rather than from the sheet's render context. That means
the numbers on the PDF are the numbers the system says are true, including
active-effect modifiers.

---

## Privacy and safety

**Everything is local and offline.**

- **Nothing is uploaded and nothing is sent to any server.** The only network
  access is your own browser fetching the module's bundled PDF template and PDF
  library from your Foundry install.
- **Any HTML in the actor's data — your notes, for instance — is parsed
  inertly.** An export can never execute code, which matters because a GM owns
  every actor and can export any player's sheet.

The bundled PDF library is [pdf-lib](https://github.com/Hopding/pdf-lib)
(MIT, © Andrew Dillon). It is loaded lazily — only when you actually export.

---

## Troubleshooting

**The button isn't on the sheet.**
It only appears on **Player**-type actors, and only for an owner. Check the
actor's type and your ownership.

**"character-sheet template not found".**
The bundled template PDF is missing from the install. Reinstall the module.

**Some fields are blank.**
Fields the actor has no data for are left empty. If a field you *do* have data
for is blank, the template's field id may not match — the console logs which
field ids were missing.

**"PDF export failed" with an error.**
The message names the cause. The most common is a template mismatch after a
partial update — reinstall.

**A Save As dialog didn't appear.**
Your browser doesn't support the native file picker. The file downloads normally
instead; check your Downloads folder.

**The spell summary is truncated.**
The template's notes field is filled with a deliberately concise summary — the
full spell list won't fit the printed sheet.

---

**Related:** [Character Builder](Character-Builder.md) · [CREDITS.md](../../CREDITS.md)
