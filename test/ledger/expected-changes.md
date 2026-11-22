# Expected ledger changes

The ledger files next to this one were recorded on the 2.x skin engine. The skin component system (docs/ideation/2026-11-20-skin-component-system.md) is meant to change what they record in the ways listed here, and in no other. When the ledger is regenerated on the new engine, every difference must match an entry below; any other difference is a defect.

## doom

- **The mugshot is exactly central.** Wherever the tall or balanced bar is drawn, the mugshot starts at column `⌊(W − 12) / 2⌋` of the bar. In 2.x it drifts toward the lighter side. This is checked by formula, not entry by entry.
- **Optional boxes drop inside their own half.** SAVE goes from the left half; SYSTEM, then AGENTS and TASKS go from the right half. The side that overflows first drops first, so the widths where each box disappears move.
- **The balanced bar replaces doom-minimal.** Where 2.x fell back to doom-minimal (MODEL and USAGE left of the mugshot, PROJECT and ACTIVITY right of it), the balanced alternative draws the same four boxes in the same halves.
- **The 3-row bar leaves the cost out.** In 2.x doom-compact moves the cost into MODEL; the compact alternative drops it with USAGE's other optional rows.
- **Predicted breakpoints.** Filled in before the new ledger is generated: for each row budget, the width at which each optional box drops and each alternative takes over, derived from the new skin's minimums.

## doom-line

- No change is expected beyond the clipped flag at widths too narrow for the line's minimum.

## minecraft

- **The HUD is exactly central.** Under `balance = "mirror"` the chat gets at most the left half beside the HUD.
- **The hotbar's visible slots stay equal in width.** The number of visible slots per width may change, because all cells now shrink together; the predicted counts are filled in before the new ledger is generated.
