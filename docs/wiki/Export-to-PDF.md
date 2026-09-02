# Export to PDF

[← Wiki home](index.md)

Fill a real, form-fillable Shadowdark character sheet PDF directly from an actor.

---

## Using it

Open any **Player** character sheet. Click the **PDF** button in the sheet
window header:

![The PDF button in a character sheet header](images/pdf-export-button.png)

The export button is shown to the character's **owner** (the assigned player or
a GM). It attaches directly to the core Shadowdark player sheet.

Click the button to download your filled PDF.

## Where the file goes

The module uses your browser's native **Save As** dialog where available so you
can choose the save location. If your browser lacks native picker support, it
downloads to your standard Downloads folder.

## What gets filled in

- **Abilities**, with active-effect bonuses applied
- **Luck** and **Renown**
- **Attacks**
- **Gear and slot usage**
- **Spells**, including lost markers and brief summaries
- **Talents and abilities**: acquired level-up talents and patron boons
- **Languages**
- **Class and ancestry features**, including rules text

Talents divide cleanly between two sections: *Talents & Abilities* (page 1)
lists acquired talents and boons, while *Class & Ancestry Features* (page 2)
holds fixed class and ancestry features. No talent prints twice.

Values come directly from the system data model's **computed values** (the same
getters used by the sheet), ensuring numbers match active effects and sheet values.

---

## Privacy and safety

**Everything runs locally and offline in your browser.**

- **No data is sent to external servers.** The browser only loads the bundled
  PDF template and library from your local Foundry install.
- **Notes and text fields are parsed inertly.** Rich text cannot execute code.

The bundled PDF library is [pdf-lib](https://github.com/Hopding/pdf-lib)
(MIT, © Andrew Dillon), loaded lazily only when you export.

---

## Troubleshooting

**The PDF button is missing from the sheet header.**
The button appears only on **Player**-type actors, and only for the actor's
owner or a GM.

**"character-sheet template not found".**
The bundled PDF template is missing from the install. Reinstall the module.

**Some fields are blank on the PDF.**
Fields without character data are left empty. If populated data is missing,
check console logs for template field mismatches.

**"PDF export failed" with an error.**
Review the displayed error message. Reinstall if a template mismatch occurs
after updating.

**No Save As dialog appeared.**
Your browser does not support native file pickers. Check your default Downloads
directory.

**Spell summary text is truncated.**
The PDF template has limited notes space, so spells are formatted into concise
summaries to fit the page.

---

**Related:** [Character Builder](Character-Builder.md) · [CREDITS.md](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/CREDITS.md)
