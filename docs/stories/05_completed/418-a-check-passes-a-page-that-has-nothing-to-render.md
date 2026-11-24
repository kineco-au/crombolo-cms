# 418 — A check passes a page that has nothing to render

**Epic:** S — Workspaces and changes · **Priority:** must · **Size:** S
**Depends on:** 386, 406

## Story

As someone finishing work on a site whose pages are served by an app, or on a page
of a type with no template, I want the check to pass a page there is nothing to
render, so that the check does not fail for something that is not a fault.

## Context

Reported by Crombolo Cloud on 2026-11-24, in 0.77.0. A page of a type that allows no
template was renamed in a workspace; `POST workspaces/{key}/check` answered
`ok: false` with `{ kind: 'page', says: 'It answered noTemplate.' }`. A host that
refuses to finish work while the check fails can then never finish any on a headless
site.

Both checks count a page as passed only when rendering answers `ok`, `redirect` or
`outcome` (`packages/server/src/workspace-checks.ts`, `shared-check.ts`). The renderer
answers `noTemplate` for a page with no template, which is how a headless page is
meant to be: it has content and no markup, and an app reads it through the Delivery
API. Neither check tells that apart from a failure.

The same rule makes two more cases fail that are not faults, noted when `406` was
built: a page only members may see answers `notFound`, and so does a page whose
address is not served.

## The design

- **A page whose type allows no template is not rendered.** It is listed as not
  checked, with the reason, and does not make the check fail.
- **A page whose type has templates and has none chosen fails,** saying so in words:
  "It has no template chosen", not `noTemplate`.
- **A page only members may see is rendered as a member would see it:** as a stand-in
  member belonging to the groups the page asks for, with access allowed. It never fails
  for being protected. A view that looks that member up finds none, which it must
  already bear for a member since deleted.
- **`notChecked` becomes one list of what a check did not look at,** pages and the rest
  alike: `notChecked: [{ kind, item, why, says }]`, `kind` one of `page`, `file`,
  `site`; `why` one of a short fixed list (`no-template`, `over-the-limit`,
  `not-published` for a page, `at-merge` and `at-start` for the rest); `says` a
  sentence. Today it is a list of sentences (found 2026-11-24), so this breaks its
  readers: the command line's `workspace check` and `changes check`, the remote
  protocol, and any host.
- **Both checks and the errors list use the one rule,** so a workspace's check, the
  Shared check (`406`) and what `render` notes as an error (`408`) agree.
- **The words shown never name an internal status:** each failure and each reason
  has a sentence of its own.

## Decisions (2026-11-24, the maintainer's)

1. **A page with nothing to render is not checked,** with its reason; it does not fail
   the check and is not counted as passing.
2. **`notChecked` is replaced by one list of objects,** `{ kind, item, why, says }`,
   covering pages and the rest alike. A breaking change, said in the release notes and
   `docs/remote-protocol.md`.
3. **A type with templates and none chosen is a failure:** "It has no template chosen."
4. **A members-only page is rendered now,** as a stand-in member in the groups it asks
   for.
5. **Released as a minor, not a patch,** since decision 2 breaks `notChecked`'s readers.

## Acceptance criteria

- [x] **A changed page of a type with no template** leaves the workspace's check and
      the Shared check `ok`, and is listed as not checked with its reason.
- [x] **A changed page of a type with templates and none chosen** fails with a
      sentence that says so.
- [x] **A members-only page** is rendered as a member and passes or fails as any page
      does; it never fails for being protected.
- [x] **`notChecked`** is a list of `{ kind, item, why, says }` in both checks, the
      remote protocol and the command line's output.
- [x] **A site with no templates at all** checks `ok` with every page listed as not
      checked.
- [x] **A page that throws, and a view that does not compile,** fail as today.
- [x] **`render` on a page with no template** notes no error against the workspace.
- [x] **No message names an internal status.**
- [x] **Tests** on both dialects; `docs/workspaces.md`, `docs/changes.md`,
      `docs/remote-protocol.md` and the release notes updated.

## Implementation

- `pageVerdict` (`workspace-checks.ts`, pure): one rule for both checks and the errors
  `render` notes: `ok`, `redirect` and `outcome` pass; no template on a type with none is
  not checked (`no-template`); none chosen on a type with templates fails, "It has no
  template chosen."; every failure in words.
- `renderForCheck` (`server.ts`): a page only members may see is rendered again as a
  stand-in member in the groups its access names; a page with no template says whether
  its type allows any (`typeAllowsTemplates`).
- `notChecked` is `{ kind, item, why, says }` in both checks (`skippedPages`), the remote
  protocol and the command line's output.
- Tests: `tests/shared-check.test.ts` (a headless page not checked, a members-only page
  rendered as a member, none chosen failing, a workspace's check and `render`).
