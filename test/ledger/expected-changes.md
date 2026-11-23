# Expected ledger changes

The ledger files next to this one were recorded on the 2.x skin engine. The skin component system (docs/ideation/2026-11-20-skin-component-system.md) is meant to change what they record in the ways listed here, and in no other. When the ledger is regenerated on the new engine, every difference must match an entry below; any other difference is a defect.

## doom

- **The mugshot is exactly central.** Wherever the tall or balanced bar is drawn, the mugshot starts at column `⌊(W − 12) / 2⌋` of the bar. In 2.x it drifts toward the lighter side. This is checked by formula, not entry by entry.
- **Optional boxes drop inside their own half.** SAVE goes from the left half; SYSTEM, then AGENTS and TASKS go from the right half. The side that overflows first drops first, so the widths where each box disappears move.
- **The balanced bar replaces doom-minimal.** Where 2.x fell back to doom-minimal (MODEL and USAGE left of the mugshot, PROJECT and ACTIVITY right of it), the balanced alternative draws the same four boxes in the same halves.
- **The 3-row bar leaves the cost out.** In 2.x doom-compact moves the cost into MODEL; the compact alternative drops it with USAGE's other optional rows.
- **The compact bar is the origin's.** It draws MODEL and USAGE left of a 3-row mugshot and ACTIVITY right of it (origin §11.1), where 2.x drew PROJECT on the right; its mugshot is exactly central too, at `⌊(W − 6) / 2⌋`. ACTIVITY's task count is optional so the box fits three rows.
- **Row steps instead of a row chain.** The tall bar is drawn at a 6-row budget, its boxes giving up title rows and optional rows to fit (origin §11.1, "Rows"); 2.x needed 7 rows and fell to doom-compact. Below 6 rows the compact bar uses up to the budget's rows, each box keeping its title while it fits.
- **Predicted breakpoints**, derived from the v2 skin's box minimums by arithmetic on the anchor's halves (each half `⌊(W − mugshot) / 2⌋`, the odd column on the right; boxes at padding 0, decoration going before drops):
  - **Budgets 6, 7 and 8:** the tall bar from 98 columns (left essentials MODEL, USAGE, PROJECT need 43; ACTIVITY needs 10). SAVE from 118, SYSTEM from 131, TASKS from 99, AGENTS whenever the tall bar is drawn. The balanced bar from 65 to 97 (left 26, right 27). The compact bar from 58 to 64. The line below 58.
  - **Budget 6:** PROJECT has no title (its six rows fill the budget); every other box keeps its title.
  - **Budgets 3, 4 and 5:** the compact bar from 58 (left 26, mugshot 6, right 10), the line below. No titles at 3 and 4 rows; at 5 rows MODEL and ACTIVITY keep their titles and USAGE gives its up.
  - **Budgets 1 and 2:** the line at every width.

## doom-minimal and doom-compact

Recorded since #100 (24.11.2026), after the 3.0.0 regeneration: they start lower in the doom tree, so
each draws the doom ledger's balanced and compact bars (or the compact bar and the line) at the same
widths, and never a taller bar. Every signature also records `face`, the mugshot's rows, which
#93 found the ledger did not pin.

## doom-line

- No change is expected beyond the clipped flag at widths too narrow for the line's minimum.

## minecraft

- **The HUD is exactly central.** Under `balance = "mirror"` the chat gets at most the left half beside the HUD.
- **The hotbar's visible slots stay equal in width.** The number of visible slots per width may change, because all cells now shrink together; the predicted counts are filled in before the new ledger is generated.
- **No compact form (KTD9).** minecraft-compact is gone; at budgets below 6 rows the one tree gives up the hotbar (its slots have the lowest priority after the chat), so budgets 3 to 5 draw hearts, hunger and the XP bar in 2 rows, budget 2 the same, and budget 1 hearts and hunger in 1 row. 2.x drew its 3-row compact skin at every budget below 6.
  - **Corrected after the regeneration, accepted by the owner (23.11.2026):** the prediction left out the chat. It is optional and 18 columns at its narrowest, so from 75 columns (`⌊(W − 39) / 2⌋ ≥ 18` beside a 39-column HUD) it is drawn in the left half at budgets 3 to 5 too, as tall as the budget: 3, 4 or 5 rows from 75 columns.
- **Predicted slot counts** at budgets 6 to 8: a cell is 5 to 7 columns, so n slots need `6n + 1` columns and the chat (18 columns, optional) needs `⌊(W − 73) / 2⌋ ≥ 18`: 6 slots at 40–42, 7 at 43–48, 8 at 49–54, 9 from 55, the same as 2.x.
