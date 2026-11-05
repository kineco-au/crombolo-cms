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

- [ ] `import { Gap } from '@crombolo/crombolo'`, used as
      `<Gap reason="…" was="…">children?</Gap>`: to visitors it renders its
      children, or nothing; in preview and in the back office's rendering
      it renders a grey box with the reason and what was there, in the
      page's flow, sized by its children or a default.
- [ ] `components check` lists every gap in a site, with its file, line,
      reason and `was`, and `crombolo components gaps` prints the list, so
      the work left is a command away.
- [ ] A gap is never an error: a site with gaps checks, builds and serves.
- [ ] Documented in `writing-components.md`, with the preview rendering
      shown.

## Technical notes

- `packages/render`: the component and the preview-mode check the
  placeholder in `184` uses; `packages/cli`: the `gaps` command over the
  component scan.

## Out of scope

- Any attempt to fill a gap automatically.
