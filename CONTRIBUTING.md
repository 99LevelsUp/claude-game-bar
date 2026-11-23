# Contributing to claude-game-bar

The repository is [99LevelsUp/claude-game-bar](https://github.com/99LevelsUp/claude-game-bar), and
the npm package and its command are both `claude-game-bar`. Settings from the environment are named
`GAMEBAR_*`; the code reads them through `src/platform/env.js`, which falls back to the `DOOMBAR_*`
names of releases before 1.0.0.

[docs/architecture.md](docs/architecture.md) explains how the bar is built: the platform and the
games, one tick from the client through the daemon to the drawn skin, hooks, scripts and assets.
Read it first; this file covers how to change things.

## Ideas and bugs

Open proposals, ideas and bugs are [GitHub Issues](https://github.com/99LevelsUp/claude-game-bar/issues).
Labels give the area (`daemon`, `render`, `skins`, `chat`, `wc3`, `install`, `housekeeping`,
`performance`, `mugshot`, `legacy`), `bug` or `enhancement`, and the state when it is not plain
open work: `idea` (not decided yet), `blocked` (waiting on something outside the project) or
`needs-decision` (waiting on the maintainer). A pull request that finishes an issue says
`Fixes #<number>` in its description, which closes the issue when it merges.

The plans and ideation documents in `docs/` cite the IDs of the backlog that came before the issues
(D-18, G-5, …); `docs/BACKLOG.md` maps each one to its issue.

## Changes go through a pull request

`master` is protected: it cannot be force-pushed or deleted, and it takes changes only through a
pull request whose `test` and `e2e` checks (the `Test` workflow on Linux) have passed. No review
approval is required. This holds for everyone, including the repository owner.

1. Branch from an up-to-date `master`: `git switch master && git pull && git switch -c <type>/<topic>`
   (`feat/`, `fix/`, `docs/`, `chore/`, `release/`).
2. Commit as often as you like and push the branch: `git push -u origin <branch>`.
3. Open a pull request: `gh pr create --fill` (or `--draft` while it is in progress; the checks
   run on every push either way).
4. When `test` and `e2e` are green, merge with a merge commit: `gh pr merge --merge --delete-branch`.
   Merge commits keep the branch's commit hashes, which commit messages and PR descriptions
   refer to.
5. Update your local `master`: `git switch master && git pull`.

Run the tests locally before pushing: `npm test`, and `npm run test:e2e` on its own (it starts
real daemons and must not run alongside anything else).

## Adding a game

A game is data, scripts and assets. It brings no layout code: the bar is a tree of the platform's
shared nodes (containers and metric visuals, `src/kit/nodes/`), and a game's skin file composes that
tree in TOML. A game that needs only the nodes the platform has changes nothing outside its two
folders. A new kind of node, such as a minimap, is ordinary platform work in `src/kit/nodes/`.

```
src/games/<game>/
  game.toml          the manifest
  <game>.toml        the game's skins, as named entries of one file
packages/<game>/     the npm package @claude-game-bar/<game> (see packages/README.md)
  package.json
  images/, scripts/, conversations/   its assets, in subfolders by kind
```

The registry, `src/games/index.js`, finds the game folders itself (sorted by name, the order
`skin next` cycles through). The rest of the code reaches a game only through it;
`test/games/general-part.test.mjs` fails when a game's name appears anywhere else in `src/` or
`bin/`.

The manifest, `game.toml` (the comment at the top of `src/games/index.js` lists every key):

- `name`, `description`: the game's name, which `skin <name>` also accepts, and the blurb in the
  skin list.
- `default`: true for the one game drawn when nothing is chosen, the built-in `default` game.
  `default_skin`: the skin drawn when the game itself is chosen.
- `[vars]`: the game's style, variables its skins read (`panel = "#1c2036"`,
  `threshold = ["$good", "$warn", "$bad"]`); see [Variables and expressions](#variables-and-expressions).
- `[lines]`: line sets of its own, eleven characters each (see [Lines](#lines)).
- `[legacy]`: what a release before 3.0.0 saved. `aliases` are older theme names that still
  choose the game; `reads_presets` says whether the file name of `GAMEBAR_PRESET` picks the size;
  `presets` maps a preset file name (without `.toml`) to the skin name of that size; `skins` maps
  old skin names to the entries they draw now (`"doom-full" = "doom"`).
- `[assets]`: `package` (`@claude-game-bar/<game>`), `version` and `integrity`, the one version of
  the assets package the bar installs. `0.0.0` and an empty integrity pin nothing: the assets then
  come only from a checkout's `packages/<game>/`. A game without `[assets]` (the built-in default
  game) has no package at all. See [Asset packages](#asset-packages).

`test/games/fixture-game/` is a working example of a game that is a folder and nothing else;
`test/games/registry.test.mjs` registers and draws it.

### Skins

A game's skin file holds its components and its named skins. The loader's header comment
(`src/kit/layout/load.js`) is the reference; the design behind it, with worked examples, is
`docs/ideation/2026-11-20-skin-component-system.md`.

```toml
version = 2                 # the format; a file without it is not loaded
game = "doom"

[skin.doom]                 # a skin a user picks: its root, and optionally its own vars
root = "bar"

[element.bar]               # a component, by id
kind = "switch"
children = ["tall", "line"]

[element.context]
kind = "list"
gap = 1
children = [                # a child is an id, an inline node, or { ref = "id", vars = { ... } }
  { kind = "label", text = "🧠" },
  { kind = "bar", metric = "context.hp", label = "none", grow = 1 },
  { kind = "number", metric = "context.hp", color = "$threshold" },
]
```

- A child is an element id, an inline node (it gets the id `parent.1`, `parent.2`), or a reference
  with variables of its own for its subtree. An element placed in several places (shared by switch
  cases) is drawn in each, with its own script state.
- `{ kind = "repeat", template = "slot", items = [{ id = "slot-cost", metric = "cost.total" }, ...] }`
  in a list of children copies the template once per item, its `{placeholders}` filled from the
  item and its id taken from the item's `id`.
- A user skin is a file of the same format in `skins/<name>/<name>.toml`; it draws its entry named
  like the folder, else its first. With `game = "<game>"` it draws with that game's style.

**Every node** has these settings (`SHARED` in `src/kit/nodes/schema.js`):

| Setting | Meaning |
|---|---|
| `kind` | the container, chrome leaf or visual it is |
| `width`, `min_width`, `max_width` | natural, fewest and most columns; a visual's own come from its value's type, a container's from its children (`min_width` on a container is a floor) |
| `rows`, `min_rows` | the rows it wants and the fewest it can live with. Sizes (these, the widths, and a kind's `gap`, `padding`, `columns`, `count`) stop at 1000 columns and 200 rows (`MAX_COLUMNS`, `MAX_ROWS`); a larger value is reported and its default used |
| `grow` | a weight: how much of a parent's spare room it takes (0 = none) |
| `priority` | an integer marks it optional: dropped when room runs out, the lowest first. Without one it is essential: never dropped on its own |
| `empty` | what it does with nothing to show: `collapse` (no room), `blank` (a leaf keeps its minimum size, a container its frame and title), `zero` / `full` (draws as if the value were 0 % / 100 %) |
| `empty_when` | an expression: while true, the node has nothing to show |
| `align` | where its content sits in the width it was given |
| `color`, `background` | inherited from the parent when not set |
| `script` | a script run each render (below) |
| `place` | where it sits inside `layers` |

**Containers** (`src/kit/nodes/containers/`):

- `anchor`: nine places (`top_left` ... `bottom_right`) around a `center`. It takes the whole width.
  With `balance = "mirror"` (the default) both sides are equally wide, so the centre starts exactly
  at `⌊(W − centre) / 2⌋`, and each side degrades inside its own half; `gravity = "in"` pulls the
  content toward the centre, `"out"` to the edges.
- `list`: children in a `direction` (`horizontal` or `vertical`), with `align` (`start`, `center`,
  `end`, `between`), `cross` (`start`, `center`, `end`, `stretch`), `gap`, `separator` and `cut`
  (the end that loses children first; by default the end away from `align`).
- `box`: a list with a `title`, a `fill`, a `border` (a line set) and `padding`. It gives up its
  decoration in this order: padding, border, title row.
- `grid`: equal cells, `columns` a row, with `lines`, `selected_lines`, `line_color`,
  `selected_color`, `fill` and `cell_align`. All cells shrink together, and a joint is drawn from
  the arms that are there, so any number of cells can be selected by its script.
- `layers`: children drawn over each other; a glyph keeps the background of what is under it.
- `switch`: `cases = [{ when = "= ...", node = ... }, ...]` (a case without `when` is the else),
  or `children` for cases without conditions. It draws the first case whose condition holds and
  whose node fits; the conditions may read `$width` and `$rows`, the room it was given: an
  anchor's side, a grid's cell, a box's inside. A side its container does not bound (the width of
  a child of a list across, the height of one of a list down) is the container's room.

**Leaves** (`src/kit/nodes/visuals/`): `label` (fixed text), and the visuals `text`, `number`,
`bar`, `meter`, `state`, `sparkline`, `columns`, `scroll`, `chat` and `sprite` (frames). Each
descriptor lists its own parameters with their meaning, type and default, and the value types it
draws. A `text` or `number` of a formatted type (`percent`, `count`, `money`, `duration`, `time`,
`ratio`) takes its natural and minimum width from the type's bounded formatter
(`src/metrics/format.js`), so a value never moves the bar.

**Fitting.** When the bar does not fit the terminal's width or its row budget (`GAMEBAR_MAX_ROWS`,
else a third of the terminal's rows), every node first shrinks toward its minimum (in a list, the
children with `grow` first, so a bar narrows before the value beside it takes its short form); then, at the
smallest container that overflows: decoration goes, optional nodes are dropped (lowest priority
first, from the cut end), inner switches take their next case, and only then does the enclosing
switch move on. If even the last case does not fit, it is drawn cut at the edge.

Kinds and parameters the design specifies but this release does not build (`each`, `marks`,
`image`, `rule`, a computed `value`, `type`, `trend`, `trend_window`, `currency`, `joined`, a
skin's `before` script, a sprite's `draw`, the `block` line set) are reported as not available in
this version.

A part of a skin that does not hold (an unknown key, kind, metric or parameter, a missing child, an
expression that does not parse) is skipped with one warning, shown as a dim line under the bar for
60 seconds, and the rest is drawn. A skin that throws while it is drawn gives way to the default
game's default skin, and the warning names the error (`render-failed`, `src/render-core.js`).

### Variables and expressions

Any parameter may be `"$name"`, `"text with ${name}"`, or an expression starting with `=`:

```toml
color = "= case when $context.hp > 80 then $bad when $context.hp > 50 then $warn else $good end"
title = "= case when $act.agents > 0 then 'AGENTS (' || $act.agents || ')' else 'AGENTS' end"
empty_when = "= not has($ratelimit.5h)"
```

The language (`src/kit/layout/expr.js`) has numbers, `'text'`, `true`, `false`, `null`, `+ - * / %`,
`||` (joins text), `= <> < <= > >=`, `in (...)`, `and`, `or`, `not`, `case when ... then ... else
... end`, and the functions `has`, `coalesce`, `min`, `max`, `clamp`, `round`, `floor`, `len`,
`mix(colour, colour, 0-1)` and `format($x[, 'compact'])`. It is parsed by the bar, never run as
JavaScript. A name nobody defines, or a value of the wrong kind, keeps the parameter's default with a
warning.

The variables (`src/kit/layout/vars.js`): the game's `[vars]`, then the skin entry's `vars`, then a
node's `vars` for its subtree. Every metric is a variable under its catalogue id, and a dot reads a
field (`$git.branch.text`). `$now` and `$tick` are the time.

### Lines

A box's `border` and a grid's `lines` name a line set of eleven characters, in this order: top-left
corner, horizontal line, top joint, top-right corner, vertical line, left joint, cross, right
joint, bottom-left corner, bottom joint, bottom-right corner. The bar has `light`, `heavy`,
`double`, `rounded` and `ascii`; a game adds its own in `[lines]`.

### Assets

An asset reference is `<game>:<path>`, a path inside that game's assets package
(`doom:images/mugshot/STFST01.png`). A plain path is the skin's own: inside a user skin's folder,
or for a bundled skin inside its game folder `src/games/<game>/`. A reference naming an npm package
(`@scope/...`) is refused with a warning; the bar installs only the packages game manifests pin.

A `sprite` draws every frame of its `frames` folder on one canvas, the size of the folder's largest
frame (`frameCanvas` in `src/kit/raster/asset-raster.js`), so frames of different sizes keep one
scale and never jump; it is as wide as that canvas drawn at its `rows`.

### Skin scripts

This interface is internal and may change between releases. Its reference is the header comment of
`src/kit/skin/scripts.js`, with the host's rules in `src/platform/scripts/host.js`.

Any node can name a `script`: the bar runs it before the node is drawn, and what it returns changes
how the node looks this render. A `sprite` needs one to pick its frame; DOOM's
mugshot (`packages/doom/scripts/mugshot.js`) and Minecraft's hotbar highlight
(`packages/minecraft/scripts/hotbar-highlight.js`) are working examples.

A script is a plain JavaScript file, a classic script rather than a module (no `import` or
`export`), that defines a global function `render(input)`. It runs in a context of its own with the
language's built-ins only: no timers, no `require`, no `eval`, no WebAssembly, no `console`. It
returns its result directly; a returned promise counts as an error. Input and output travel as
JSON, so a value JSON cannot hold (an age of `Infinity`) arrives as `null`.

`input`:

| Field | What it is |
|---|---|
| `value` | the node's metric value, raw as the catalogue gives it; `null` without a metric or while the session does not report it |
| `standIn` | `null` while `value` is the metric's own; `"zero"` or `"full"` while the node draws a stand-in for an absent metric (its `empty`) |
| `metric` | the metric id, or `null` |
| `params` | the node's parameters for this render, defaults filled in and expressions evaluated |
| `reaction` | the session's game-neutral reaction (`src/metrics/reaction.js`): `expr` and `exprAge` (what just happened and how many seconds ago), `flash` (the reaction showing now: `"dead"`, `"god"`, an expression or `null`), `hp` (0 healthy to 4), `god`, `dead` |
| `now` | the time in seconds; `tick` the render tick |
| `width`, `rows` | the columns and rows the fit gave the node |
| `children` | a container's drawn children, in order: `[{ id, metric, value, standIn, width }]`, `id` the element id the skin gives each |
| `state` | what the script returned as `state` the last time it ran for this node in this session (a node placed in several places has a state in each); `{}` the first time, and again after the skin or the script changes |

The result (anything else is ignored):

| Field | What it does |
|---|---|
| `frame` | the frame a `sprite` draws: a file name in its `frames` folder, `.png` added when it has no extension |
| `selected` | the cells a `grid` selects: one index among `children`, or a list of indices or child ids; any number, or none |
| `params` | parameters drawn instead of the skin's this render (characters, colours, icons). A value the node's kind does not accept keeps the skin's. A script never changes a node's size: a node drawn wider is cut to its columns |
| `state` | kept for the next run; it is the only thing that survives, since the input is a copy |

Where a script comes from follows the asset rules above: `<game>:<path>` from that game's assets, a
plain path from the skin's own folder. A path that leads out of that folder, or an absolute one, is
refused with a warning and never run.

Budgets and failures:

- Each call has 20 ms, enforced by the script's own timeout. All scripts of one render pass of the
  daemon share 200 ms across every session it draws; when a session finds none left, its nodes
  draw their defaults for that render, with no warning and nothing turned off.
- A script that throws, cannot be loaded or returns a promise draws its node's default (a
  sprite's `default_frame`, else a blank of its width), shows a warning under the bar, and is
  not run again until its file or its skin changes.
- A script that runs past its budget is stopped and turned off for a cooldown: 30 s, doubling each
  time it runs late again, up to 10 minutes. A call that returns in time resets the cooldown to
  30 s; a change of its file or skin ends it at once.
- All scripts share one worker thread with a 64 MB heap.

Scripts run only in the render daemon. The one-shot status line (no bash 5, or no daemon) runs
none: a sprite shows its `default_frame` there, and a chat plays the platform's metrics library
only.

Scripts are trusted code, like any program the user installs: the bar runs them from the user's own
skin folders and from the game packages it installed, and never downloads code from anywhere else.
The script context keeps timers, `require` and `eval` out of reach, but it is not a security
boundary.

### Conversation libraries

A `chat` node plays conversations about the session; it costs no tokens. The platform's metrics
library (`src/kit/chat/metrics-library.js`) always plays, the one-shot status line included. A skin
adds libraries in the chat's `libraries` parameter; each is a script, found like any other, that
defines `conversations(facts)` instead of `render`. Same budgets and failure rules; a library that
fails is left out of the chat with a warning. `packages/minecraft/conversations/minecraft.js` is
a working example.

`facts` holds every fact the chat can say (model, effort, context, rate limits, branch, tasks, CPU
and more), as strings and numbers, `null` when unknown; a value the bar formats (the cost, the
resets, the clock, the task ratio, the savings) is the same string the bar shows (`"$1.83"`,
`"2h13m"`, `"14:23"`, `"2/5"`, `"8.3k 63%"`); the list is `facts()` in the metrics
library. `family` lists the Claude model family by display name, one model per tier, so a library
can cast other players from it without keeping its own list of models. The bar learns it
(`src/metrics/models.js`, the metric `model.family`): it starts from a seed list and takes in every
running or advisor model it sees, a newer version replacing its tier's model and a new tier joining
at the end; what it learned is kept in `models.json` in the user directory. The function returns:

```js
{ cast: { a: "Ada", b: "Ben" }, conversations: { "<key>": [line, ...], ... } }
```

A line is one of:

- `[role, "text"]`: a message, drawn `<name> text`. Role `"me"` is the running model; another role
  is a name of the cast, or the role itself when the cast does not name it.
- `[role, ["text", "backup", ...]]`: the first text whose placeholders are all known.
- `"text"`: a plain line in the chat's system colour.
- `[{ text, role }, ...]`: parts in their own colours, role `"text"`, `"me"`, `"system"` or
  `"accent"`.

Text may name any fact or cast role in braces (`{ctx}`, `{me}`, `{a}`); a line with a fact that is
not known is left out.

The sources merge in order: the metrics library, the skin's libraries in the order it lists them,
then the chat's own `conversations` parameter. A later conversation with an existing key replaces
it in its place; a new key plays after the rest. Every key in `drop` is left out at the end. The
metrics library's keys are listed at the top of its file.

A skin's own conversations are text, one line per line: `role: text` is a message, any other line
a plain line. Quote a key that has a dot:

```toml
[element.chat]
kind = "chat"
drop = ["cost.ask", "cost.answer"]

[element.chat.conversations]
"ctx.low" = """
a: {me}, your context is at {ctx}%
me: time to wrap up
"""
greeting = "a: hi {me}!"
```

## Releasing

A release is published by pushing a `vX.Y.Z` tag: `.github/workflows/publish.yml` runs the tests
and publishes to npm with trusted publishing (no token). The tag must point at a commit that is
already on `master`, so the version bump goes through a pull request first:

1. `git switch master && git pull && git switch -c release/X.Y.Z`
2. Move the `[Unreleased]` entries in `CHANGELOG.md` under `## [X.Y.Z] - YYYY-MM-DD`, add the
   compare link at the bottom, and commit it on its own: `docs: changelog for X.Y.Z`.
3. `npm version <patch|minor|major> --no-git-tag-version` (runs `npm test` first), then commit
   `package.json` and `package-lock.json` with the message `X.Y.Z`.
4. Push the branch, open a pull request, and merge it once the checks are green.
5. Tag the merged commit and push only the tag:

   ```sh
   git switch master && git pull
   git tag -a vX.Y.Z -m X.Y.Z
   git push origin vX.Y.Z
   ```

6. Check the outcome: `gh run watch` on the `Publish to npm` run, then
   `npm view claude-game-bar version --prefer-online`.

If the publish run fails (for example a test that only fails in CI), nothing reaches npm. Fix it
through a pull request, then move the tag to the fixed commit on `master`:
`git push origin :refs/tags/vX.Y.Z`, `git tag -fa vX.Y.Z -m X.Y.Z <commit>`, `git push origin vX.Y.Z`.

### Asset packages

Each game's assets are their own npm package, `@claude-game-bar/<game>`, published from
`packages/<game>/`. The main package ships no game assets (`test/install/package-files.test.mjs`
checks that): an installed bar fetches the version its game manifests pin, in the background, the
first time a skin needs it.

`.github/workflows/publish-assets.yml` runs on every push to `master` that touches an asset package.
It publishes each package whose version is not on npm yet, with trusted publishing and provenance,
from the GitHub environment `npm-assets`, whose deployment rule allows only `master`. A version
already on npm, the placeholder `0.0.0` and a package npm does not know yet are skipped with a
notice.

To change a game's assets:

1. In one pull request, change the files, bump `version` in `packages/<game>/package.json`, and
   set the same `version` in `src/games/<game>/game.toml` (`[assets]`). The package-files test
   fails while the two differ. A version is never `0.0.0`, which means "not published".
2. Merge it. The workflow publishes the new version.
3. In a second pull request, set `integrity` in `game.toml` to what
   `npm view @claude-game-bar/<game>@<version> dist.integrity` prints. Until then the bar treats
   the game as unpublished and a checkout uses its own folder; an installed bar has no assets for
   the game.
4. Release the bar as usual. Users get the new assets with that release, never earlier.

#### One-time bootstrap (owner)

Trusted publishing can be set up only for a package that exists, so each new package name starts by
hand:

1. Create the npm organisation `claude-game-bar` (once).
2. Set the package's first version (not `0.0.0`) in its `package.json` and manifest, then publish
   it from its folder: `cd packages/<game> && npm publish --access public`.
3. On npm, add a trusted publisher to the package: this repository, workflow `publish-assets.yml`,
   environment `npm-assets`. In the repository settings, create the `npm-assets` environment with a
   deployment rule that allows only `master`.
4. In the package's settings on npm, require two-factor authentication and disallow tokens.
5. Pin the published version and its integrity in the manifest, as in step 3 above.

Status: `@claude-game-bar/doom` and `@claude-game-bar/minecraft` were published by hand at 1.0.0
and are pinned (steps 1, 2 and 5). Steps 3 and 4 are still to do for both, before the first change
of either package goes through the workflow.
