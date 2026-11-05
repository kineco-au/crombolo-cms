# 281 — A marked gap in a template

**Epic:** O — Building a site · **Priority:** should · **Size:** S
**Depends on:** —

## Story

As a developer rewriting a template that depended on something this site
no longer has, I want to mark the place where it was, so that visitors see
the rest of the page and editors see, in preview and the back office, what
is missing and why.

## Context

A template converted from another system, by hand or by a tool, often has a
part that cannot be carried: a call to a service that is not here, a
component from a package, a form with no equivalent. Today the choice is to
delete the part or to leave a broken render. A missing block already renders
nothing to visitors and a placeholder in preview (`184`); the same shape
serves a template.

## Acceptance criteria

- [x] `import { Gap } from '@crombolo/crombolo'`, used as
      `<Gap reason="…" was="…">children?</Gap>`: to visitors it renders its
      children, or nothing; in preview and in the back office's rendering
      it renders a grey box with the reason and what was there, in the
      page's flow, sized by its children or a default.
- [x] `components check` lists every gap in a site, with its file, line,
      reason and `was`, and `crombolo components gaps` prints the list, so
      the work left is a command away.
- [x] A gap is never an error: a site with gaps checks, builds and serves.
- [x] Documented in `writing-components.md`, with the preview rendering
      shown.

## Technical notes

- `packages/render`: the component and the preview-mode check the
  placeholder in `184` uses; `packages/cli`: the `gaps` command over the
  component scan.

## Findings (2026-11-05)

- **Preview is the only render that can show a gap.** The back office renders
  no template of its own: its one route to a page is the preview
  (`renderPreview` in `server.ts`), the only caller passing `preview: true`.
  So "preview and the back office's rendering" is one case, and `isPreview()`
  (`context.ts`) already answers it. Previewing as a member is the same render.
- **Personalised parts are covered.** A preview passes no `signDeferred`, so
  `'use deferred'` parts render in place, inside the preview's scope. A gap in
  one shows like any other.
- **A browser part cannot hold a gap.** `@crombolo/crombolo` is server-only
  (`isServerOnly`), so `components check` refuses a `'use client'` file that
  imports `Gap`, with its usual message. Such a gap goes in the template, around
  or in place of the island. This is the one case where writing a gap is
  refused, and it is the import that is refused.
- **There is no JSX parser to lean on.** `Bun.Transpiler` gives imports but no
  tree, and `typescript` is not a dependency of a site. Its output normalises a
  gap's props but carries no line numbers, even with `jsxDEV` (tried on Bun
  1.4.2), and the story needs the line. `unawaitedMedia` in
  `packages/server/src/components.ts` is the precedent: a pure scan of the source.
- **`checkComponents` skips a file at its first failure,** so the scan belongs
  before the transpile, or a gap in a file with a syntax error goes unlisted.
- **`components gaps` must not compile anything.** `checkComponents` imports every
  component and runs `tsc`. The list is a read of the source, so it is
  `listComponents` plus the scan.

## Plan

### 1. The component (`packages/render/src/gap.ts`)

- `Gap(props: GapProps): Promise<RawHtml>`, an async component as `Blocks` is:
  `reason: string`, `was?: string`, `children?: Child`. `was` is optional, since
  a gap marked by hand may have nothing to name.
- **To visitors:** the rendered children, or an empty `RawHtml`. No wrapper, class
  or comment, so the published page is what it would be without the `Gap`.
- **In preview:** a grey box, styled inline as `crombolo-block-missing` is, with a
  `crombolo-gap` class. A label gives the reason, what was there when `was` is
  set, and "Visitors don't see this box". The children render below the label; with
  none, a `min-height` of 96px gives it the default size. Both strings go through
  `escapeHtml`.
- **The box is a `<span style="display: block">`,** not a `<div>`, so a gap inside
  a `<p>` does not close the paragraph. In a `<head>` the browser moves the box
  to the top of the body, and what follows still applies, so a missing analytics
  call is safe to mark there.
- `Gap` and `GapProps` export from `packages/render/src/index.ts` and
  `@crombolo/crombolo`.

### 2. The scan (`packages/server/src/components.ts`)

- `gapsIn(source): GapMark[]`, pure, as `unawaitedMedia` is. `GapMark` is
  `{ line, reason, was }`.
- It reads the local name from the `import` of `Gap` from `@crombolo/crombolo`,
  following `Gap as Hole`. A file with no such import has no gaps, so a site's own
  `Gap` component is left alone.
- It finds each `<Name` followed by whitespace, `/` or `>`, skipping any inside a
  `/* */` block or on a line that starts `//`.
- It reads `reason` and `was` from the tag: `="…"` with JSX entities decoded,
  `={"…"}`, and a plain template literal. Any other expression reports as `null`,
  and the list shows `(set in code)`, because a gap is still a gap.
- `findGaps(componentsDir): ComponentGap[]` runs it over `listComponents`, adding
  each file's site-relative path.

### 3. The commands

- `ComponentCheckReport` gains `gaps`, filled at the top of the file loop.
  `components check` prints each as
  `  [gap]    components/pages/home.tsx:14  reason (was: …)` and returns `gaps` in
  its output. Gaps never set `problems_found`.
- **`crombolo components gaps`** (`packages/cli/src/commands/components/gaps.ts`):
  `read_only`, `bounded`, modelled on `components list`. `items` are
  `{ file, line, reason, was }`. It always exits 0, and says `No gaps.` when there
  are none.
- Nothing else changes: a gap does not affect `bundle build`, `status` or serving.

### 4. Tests

- **`tests/gap.test.tsx`:**
  - to visitors, with children, without, and with an async child, matching the
    same page rendered with no `Gap`;
  - in preview, the reason, `was` and children, with and without `was`;
  - escaping of both strings;
  - a gap inside a `'use deferred'` part in preview.
- **`tests/components.test.ts`, for `gapsIn`:** a multi-line tag, a renamed
  import, entities, `={"…"}`, a computed reason, comments, a site's own `Gap`,
  and two gaps in a file with their lines.
- **`tests/cli.test.ts`:**
  - `components gaps` on a site with gaps and on one without, in JSON;
  - `components check` lists them and exits 0, and its output still carries a
    real problem when there is one;
  - a gap in a file with a syntax error is still listed;
  - a `'use client'` file importing `Gap` is refused.

### 5. Docs

- `docs/writing-components.md`: a section, "A gap in a template", after "Blocks",
  with the usage, what visitors and previews get, the rendered box shown as its
  markup and a text sketch, and the island rule.
- `docs/rendering.md`: a line beside the missing-block placeholder.
- `bun run api:snapshot` for `docs/api/surface.json`, and `bun run cli:spec` and
  `bun run cli:manifest` for `docs/cli/`. `components.toml` under
  `sites/crombolo/content/pages/home/docs/reference/command-line/` gains the
  command, and `bundle.json` follows if the site's bundle is regenerated.
- `docs/release-notes.md`, under `## Unreleased`. No migration.

## Implementation (2026-11-05)

Built as planned. What differs, or was found on the way:

- **`checkComponents` calls `findGaps` once, at the end,** rather than filling
  `gaps` in its file loop, so a file with a syntax error is listed with no
  special case.
- **`gapLine`** in `packages/cli/src/support/components.ts` is the one line both
  commands print.
- **A quote that never closes** ends the read of a tag, so a broken file reports
  its gap with a null reason instead of hanging the scan.
- **A false match is possible in one place:** `<Gap` inside a string in a file
  that imports `Gap` is listed as a gap.
- **Tests:** `tests/gap.test.tsx`, "the gaps in a template" in
  `tests/components.test.ts`, "components gaps" in `tests/cli.test.ts`, and a gap
  in a part in preview in `tests/deferred-parts.test.ts`.

## Out of scope

- Any attempt to fill a gap automatically.
