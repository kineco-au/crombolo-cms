# 264 — Personalised parts in the back office

**Epic:** O — Building a site · **Priority:** could · **Size:** M
**Depends on:** 263

## Story

As a developer working in the back office, I want it to show me which pages
can be shared and why the others can't, and to offer personalised and
interactive parts where I write templates, so that the pattern from 263 is the obvious way
to build a member site.

## Context

The back office's template editor writes TSX (`backoffice-host/plugin/tsx-editors.js`),
and its Insert menu's Razor output is translated as it enters
(`tsx-snippets.js`). The partial view insert is hidden because it needs an
import as well as a tag. Whether a page is the member's is found from the
view files it renders (263: `memberFiles` on a render, logged in development),
and nobody in the back office sees it: a developer finds out that a page is
not shared with members only after building it.

## Decisions

- **How the Info panel finds out. Decided (2026-11-04): it renders the page
  when opened.** The server renders the published page as a signed-out
  visitor, sends it nowhere, and reports its lifetime, whether a check is
  answered without rendering (258), and the files that mention the member
  (263's `memberFiles`), blocks included. One render each time the panel
  opens. Working it out from the template's files alone was turned down for
  missing the views a page's blocks bring in, and remembering the last real
  render for showing nothing on a page nobody has visited.
- **When the template editor warns. Decided (2026-11-04): in any file that
  mentions the member** and is not itself a `'use deferred'` part, worked out
  from the file alone, as 263 reads it: pages that show it are rendered for
  each signed-in member, and how to move that part out. A file only a
  members-only page uses is noted too, where it changes nothing. Warning only
  where a page using it would otherwise be shared was turned down for having
  to find and render those pages.
- **What the back office calls them. Decided (2026-11-04): "Personalised
  part" and "Interactive part"**, and the Insert entry "A personalised part",
  matching 263's name; no implementation term reaches the back office.
- **Previewing as a member. Decided (2026-11-04): a real member, by someone
  with the Members section.** Only a user who can open Members may pick one;
  the preview renders as that member, their name, groups and whatever their
  pages read about them, and each switch is recorded in the audit log. A
  made-up member in chosen groups was turned down because a part that looks
  the member up would show nothing, and letting any editor pick any member
  because it shows a member's details to someone without Members access.

## Acceptance criteria

- [x] **A page's Info panel says whether copies are shared:** "kept for 5
      minutes, checked without rendering", or "rendered for each member:
      `layout.tsx` mentions the signed-in member; move that part into its own
      file and mark it to load separately", with a link that opens the file.
- [x] **The template editor notes** in a file that mentions the member, and
      is not a part that loads separately, that pages showing it are rendered
      for each signed-in member, and how to move that part out.
- [x] **An Insert entry, "A personalised part",** writes a
      `'use deferred'` component's tag with a `fallback`, and its import, for
      a chosen or new one. Inserting an import also brings back the partial
      view insert.
- [x] **The create menu offers "Personalised part" and "Interactive part"**:
      a `'use deferred'` component reading the member, and a `'use client'`
      island, each a working starter whose comments say which to use when.
- [x] **Preview switches** between a signed-out visitor and a chosen member,
      for a user with the Members section only, each switch in the audit
      log.
- [x] No implementation terms in the back office's words. Tests cover each
      piece, and the browser suite covers the Info panel and the insert.

## Out of scope

- Editing personalised parts without code.

## Implementation

- **The Info tab:** `/crombolo/crombolo/api/page-sharing/{key}` (`server.ts`,
  `pageSharing`) renders the published page as a signed-out visitor, sends
  it nowhere, and answers its status, how long copies are kept, whether a
  check is answered without rendering, and 263's `memberFiles` as paths under
  `components/`. A user who cannot read the page gets `404`.
  `page-sharing.js` words it (`describeSharing`) and links each file to the
  partial view editor; `page-sharing-info.js` is the Info box.
- **The editor's note:** `view-parts.js`'s `memberNotes`, from the file alone,
  comments blanked; `tsx-editors.js` puts each as an information marker on
  its line, refreshed as the file is edited. A file starting with
  `'use deferred'` or `'use client'` has none.
- **The inserts:** a fork commit adds `showPartialViewInsert` and
  `extraInserts` to `umbCromboloHooks` and the Insert menu (`3f6e2681`,
  pinned). The view editor's `insert` writes a partial view, or a
  personalised part with a `fallback`, as a tag at the cursor and an import
  beside the others, relative to the open file (from the address; a
  template's alias from the template API). `personalised-part-modal.js` picks
  one, or makes one from the starter.
- **The starters:** `PersonalisedPart` and `InteractivePart` in
  `component-snippets.ts`, which the "from snippet" menu lists.
- **Preview as a member:** `/crombolo/crombolo/api/preview-member` answers
  and sets the choice for a user with Members, as a cookie signed with their
  key, and audits each one (`preview as`, `preview signed out`);
  `renderPreview` renders as that member. `preview-member.js` and
  `preview-member-app.js` are the preview toolbar's switch, using Umbraco's
  member picker. `MemberAuth.byKey` gives the member.
- Tests: `tests/personalised-parts-backoffice.test.ts`;
  `tests/browser/personalised-parts.browser.ts` (the Info tab, and the
  Insert entry making a part and writing its tag and import).
