# Character-builder portrait gallery

Drop character portrait / token images in this folder (any web image format:
webp, png, jpg, …). They appear as a pickable gallery on the **Preview** step of
the Character Builder, offered to every player — including players with no file
permissions, because the folder is browsed on the GM's client.

This folder is the default source for the `charBuilderArtFolder` world setting.
The setting is a comma-separated list, so a GM can add their own folders (or
Tokenizer's save locations) alongside this one without editing the module.

Nothing here is Tokenizer-specific — the gallery reads whatever images live in
the configured folders.
