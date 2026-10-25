# 184 — Blocks render their own components

**Epic:** O — Building a site · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As someone building a site, I want a block's own component to render it,
found by its element type, so that adding a new kind of block means writing
one component, not editing every template that lists blocks.

## Context

A page template renders a Block List or Block Grid by hand. It reads the
items, switches on each one's `contentType.alias` and calls the matching
component (for example
`sites/harbourstone/components/shared/highlights.tsx`). Nothing maps an
element type to a component file. A new block therefore renders nowhere
until every template that holds that property is edited. A site the editor
or a tool extends one block at a time pays that cost on each block.

Umbraco's convention is a partial per element type under
`blocklist/Components/<alias>`. The CMS can give TSX components the same
convention.

## Acceptance criteria

- [x] **`Blocks`, from `@crombolo/crombolo`:**
      `<Blocks items={model.value('sections')} />` renders each block with
      `components/blocks/<elementAlias>.tsx`'s default export, given
      `{ content, settings, block }`.
- [x] **Block Grid:** a grid variant (or the same component) renders the
      layout and its areas, with each area's blocks resolved the same way.
- [x] **A missing component** renders nothing to visitors. In preview it
      renders a placeholder naming the element type and the file to create.
- [x] **Bounded lookup:** the renderer resolves block components only under
      `components/blocks/`, by an alias that passes the alias rules, and the
      module-graph checks still hold.
- [x] **Overrides:** a template can pass its own mapping for an alias, so a
      block can render differently in one place.
- [x] **Tooling:** `crombolo components new --block <alias>` scaffolds the
      file with typed props for the element type. `components check`
      reports a block component whose alias matches no element type.
- [x] **A starter template uses it,** and `docs/writing-components.md` and
      `docs/rendering.md` describe it.
- [x] **Tests:**
  - list and grid rendering;
  - a missing component in delivery and in preview;
  - an override;
  - the lookup refusing a path outside `components/blocks/`;
  - the scaffold.

## Findings (2026-10-25)

- **No site renders a Block List or Block Grid today.** The context's example,
  Harbourstone's `shared/highlights.tsx`, renders an Element Picker by
  mapping over elements. The demos use Element Pickers throughout, and the
  basic template has no blocks. A starter that uses `<Blocks>` needs a block
  data type, element types and seed content of its own.
- **Components are loaded by a plain dynamic import** of
  `<dir>/<alias>.tsx` (`Renderer.#load`, `packages/render/src/renderer.ts`).
  The directory is the current views snapshot, so an edit gets a new import
  path. A component cannot reach the renderer: the render scope (an
  AsyncLocalStorage, `packages/render/src/context.ts`) carries the page,
  contexts and ids, but no loader. `<Blocks>` needs one there, so it imports
  from the same generation as the page.
- **Components may be async.** The JSX runtime awaits a promise a component
  returns (`jsx-runtime.ts`). So `Blocks` is an async component that loads
  each block's module as it renders.
- **Block values** (`values.ts`):
  - **List:** `BlockItem { contentKey, content, settingsKey, settings }`,
    where `content.contentType.alias` is resolved and may be null.
  - **Grid:** `BlockGridItem` adds `columnSpan`, `rowSpan` and `areas`. A
    `BlockGridArea` carries only the area's key, not its alias.
  - **Typing:** `generate` already types both, with `TypedElement<X>` per
    element type.
- **There is no preview flag in render.** Preview calls
  `renderer.renderModel` from `server.ts`, and so does the 404 page. A
  placeholder needs `preview` passed through `RenderRequest` into the scope.
- **Alias rules:** `isSafeComponentAlias` (renderer.ts) refuses absolute,
  backslashed and drive-letter aliases, and requires `[A-Za-z0-9_-]`
  segments. The view-side "module graph" rule is `checkComponents`'s refusal
  of imports that climb out of `components/`. `scripts/check-module-graph.ts`
  is about the vendored back office, not views.
- **The CLI:** `components new` takes an alias and no flags; it picks a view,
  e-mail or plain scaffold by where the alias sits. `components check`
  transpiles, imports and type-checks everything under `components/`.

## Plan

### 1. The renderer

- `RenderScope` gains `component(alias)`, which loads a component's default
  export from the page's own views generation, through `#load`, and
  `preview: boolean`.
- `RenderRequest` gains `preview`, set by the preview route in `server.ts`
  only.
- `blockComponent(elementAlias)` resolves `blocks/<alias>` only. The alias
  must pass `isSafeComponentAlias` as a single segment, so a value cannot
  reach outside `components/blocks/`. A missing file is `undefined`, not an
  error.

### 2. `Blocks` (`packages/render/src/blocks.ts`)

- `<Blocks items={…} components?={{ alias: Component }} />` is an async
  component. Each item renders with the override for its element alias, else
  `components/blocks/<alias>.tsx`'s default export, given `{ content,
  settings, block }`.
- A missing component renders nothing to visitors. In preview it renders a
  placeholder naming the element type and the file to create.
- **Block Grid:** the same component, detecting grid items by their spans.
  It renders Umbraco's block-grid markup (decided 2026-10-25), so Umbraco's
  default stylesheet and CSS written for it work unchanged:
  - the class names `umb-block-grid`, `umb-block-grid__layout-container`,
    `umb-block-grid__layout-item`, `umb-block-grid__area-container` and
    `umb-block-grid__area`;
  - the custom properties `--umb-block-grid--grid-columns`,
    `--umb-block-grid--item-column-span`, `--umb-block-grid--item-row-span`
    and `--umb-block-grid--area-column-span`;
  - the `data-content-element-type-alias` attributes.

  Each area's blocks resolve the same way as a list's.
- `BlockGridArea` gains `alias`, from the data type's area config, so
  markup and authors can name areas.
- `BlockProps<Content, Settings>` is exported for typed block components.
  `Blocks`, `BlockProps` and `BlockGrid…` are re-exported from
  `@crombolo/crombolo`.

### 3. Tooling

- **`components new --block <alias>`** writes
  `components/blocks/<alias>.tsx`, typed with
  `BlockProps<TypedElement<Pascal>>` from `../../schema/content-types`. It
  refuses an alias that is not an element type.
- **`components check`** reports a `blocks/<alias>.tsx` whose alias names no
  element type.

### 4. A starter that uses it (decided 2026-10-25): Harbourstone

- The demo's highlights move from the `highlightPicker` Element Picker to a
  `highlightBlocks` Block List of the `highlight` element type:
  - `components/blocks/highlight.tsx` renders one highlight;
  - the home and content pages' templates use `<Blocks>` where
    `shared/highlights.tsx` mapped over picked elements;
  - the seed's highlight values become blocks (`[{ type = "highlight",
    values = {…} }]`), so the Library elements they used to pick are no
    longer needed and go.
- `tests/templates.test.ts`'s "one highlight type answers for the figures
  and the decisions alike" checks the block list in place of the picker.
- `bundle build` of the demo, its seed check, and the template and
  demo-from-bundle tests still pass.

### 5. Tests and docs

- **`tests/blocks.test.ts`:**
  - a list and a grid with areas;
  - an override;
  - a missing component, both delivered and in preview;
  - an alias that would reach outside `blocks/`;
  - a component from the current views generation.
- **`tests/cli.test.ts`:** the scaffold, and `check` on an orphaned block
  component.
- **Docs:** `docs/writing-components.md` and `docs/rendering.md`, "Blocks".

## Implementation (2026-10-25)

Built as planned. What differs, or was found on the way:

- **A grid block's areas are its component's `children`.** Umbraco's partial
  calls `GetBlockGridItemAreasHtmlAsync` where the areas go. Here the areas
  render first and arrive as `children`, so the component places them. A
  component that ignores `children` drops them.
- **The grid value carries its config.** A `BlockGridArea` gains `alias`,
  `columnSpan` and `rowSpan`, and a `BlockGridItem` gains `areaGridColumns`,
  from the data type's block config. The list carries `gridColumns`
  (`BlockGridValue`), so the markup has the column counts without the
  template passing them.
- **`Renderer.blockComponent(alias)` is public,** so the bounded lookup is
  tested directly. The render scope (`RenderScopeOptions`) carries it, with
  `preview`, for `Blocks`. `renderScope`'s third argument became an options
  object.
- **Preview** is the one render that passes `preview: true`
  (`RenderRequest.preview`, set by the preview route in `server.ts`).
- **`components check`** reports orphaned block components as warnings
  (`orphanBlocks`), not problems: such a file is never used, but it breaks
  nothing.
- **Harbourstone:**
  - the highlights are a `highlightBlocks` Block List;
  - `components/blocks/highlight.tsx` renders a row, and the home page maps
    `highlight` to a figure;
  - the eight Library highlights became block values in the seed, and their
    Library files are gone;
  - `highlight` no longer allows the Library.
- **Tests:**
  - `tests/blocks.test.tsx`: a list, an override, a missing component
    delivered and in preview, no blocks, a grid in Umbraco's markup with an
    area, and the lookup refusing paths outside `blocks/`;
  - `tests/cli.test.ts`: `components new --block`, its refusals, and
    `components check`'s orphan;
  - `tests/templates.test.ts` and `tests/delivery-types.test.ts`: the demo's
    block list;
  - `tests/integration/new-site.integration.ts`: the demo's highlights render.

## Out of scope

- Changing how existing templates render blocks. They keep working, and
  move to `<Blocks>` when their authors choose.
