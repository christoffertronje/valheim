# Crafting Codex data audit — 2026-10-17

## Scope and limitations

This is a **partial, source-based audit**, not a claim that every recipe and every upgrade cost has been independently verified. The code contains the item data inline in `crafting/index.html`. The current catalogue has 157 entries, including one entry whose ingredients remain unverified (Dvergr lantern). Hammer-built structures and station upgrade pieces remain out of catalogue scope. Deep North is not exhaustively covered.

## Changes made

- Fixed ingredient discrepancies that could be cross-checked with the Valheim Wiki Crafting recipe tables:
  - Iron sledge: **Draugr trophy ×1**, not Draugr elite trophy.
  - Finewood bow: Corewood ×10, not ×20.
  - Flint axe: Flint ×4, not ×6.
  - Ooze bomb: Ooze ×10 and Workbench level 1.
  - Ancient bark spear requires Forge level 3; Porcupine requires Forge level 2.
- Corrected crafting yields: missiles ×20, Ceramic plates ×5. Existing arrow/bolt and bomb batch calculations remain enabled.
- Added documented Black metal pickaxe, Serpent scale shield, bronze/iron nails, Dvergr lantern, and Bloodgold missile.
- The Black metal tower shield chain cost is **disputed between source snippets** (1 vs 7); the catalogue currently uses 7, matching the Crafting page shield table. This remains an open issue.
- Non-food content remains protected by the default-on Ashlands/Deep North toggle.

## Validation performed

- Checked that the generated browser JavaScript parses after modifications.
- Checked the six major station categories against the Crafting Menu overview.
- Spot-checked specific quantities and requirements against the sources linked below.
- Did **not** run the website on a physical phone or cross-check each of the 157 individual recipes against live game files.

## Unresolved verification work

1. Independently verify all remaining item base material costs, especially Ashlands and magic equipment. Presence in the JSON means *populated*, **not independently verified**.
2. Independently check every minimum station level and all crafting yields; earlier levels were entered during incremental development.
3. Add initial-versus-upgrade costs as separate data fields (the current calculator models creation only).
4. Verify station mappings for items and mechanics introduced in Valheim 1.0.
5. Expand the list systematically to missing equipment, consumables, and Deep North inventory crafting, without exposing spoilers by default.
6. Fill Dvergr lantern ingredients only after confirmation.
7. Audit inconsistencies between `valheim.fandom.com` and third-party community databases and document which game version they refer to.

## Sources examined

- https://valheim.fandom.com/wiki/Crafting
- https://valheim.fandom.com/wiki/Crafting_menu
- https://valheim.fandom.com/wiki/Workbench
- https://valheim.fandom.com/wiki/Forge
- https://valheim.fandom.com/wiki/Black_forge
- https://valheim.fandom.com/wiki/Artisan_table
- https://valheim.fandom.com/wiki/Black_metal_pickaxe
- https://valheim.fandom.com/wiki/Mechanical_spring
- https://valheim.fandom.com/wiki/Sharpening_stone
- https://valheim.fandom.com/wiki/Materials

## Data quality policy for future changes

Do not invent recipe amounts or levels. Record missing data as pending. Distinguish a populated recipe from a source-verified one, and do not claim comprehensive accuracy solely because no ingredient field is empty. Check batch yields independently; never assume quantity 1.
