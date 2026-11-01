# 236 — An overview to sign in to, and a guide in the empty site

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As an editor signing in, I want the first page to show what is happening with
the site's content (what changed lately, what is waiting as a draft, who did
what), and a quick way to start something new, so that I pick up where the
team left off instead of reading about how Crombolo works.

As someone who has just run `crombolo init`, I want the new site's home page
to be a one-page guide to getting started, so that the first thing I open
tells me what to do next.

## Context

Found 2026-11-01, with a mock-up of an Overview page.

- **The Content section's home** is the Welcome dashboard
  (`plugin/welcome-dashboard.js`, `Crombolo.Dashboard.Welcome`, in place of
  Umbraco's news). It shows four steps about modelling content, TSX templates,
  publishing and schema files. That is a developer's introduction, shown to
  every editor on every sign-in.
- **The empty site** is what `crombolo init` makes without `--template`: no
  content types, so every address answers the "Nothing is published yet"
  holding page (`packages/server/src/no-nodes.ts`), a 404 with three
  one-line steps.
- **The mock-up** has:
  - a greeting by first name;
  - Recent content: title, type, status, updated, author, and a menu per row;
  - Quick stats: drafts and published, each linking to the list;
  - an Activity feed;
  - a New content button.

  Around that it also shows its own top navigation, a content tree, search,
  notifications, a user menu and a date range.
- **What exists to read from:**
  - documents, with their content type, state and update date;
  - the audit log (`crombolo/api/audit`), which only some users may read.

## Decisions (2026-11-01)

1. **The dashboard alone.** The Overview replaces the Welcome dashboard
   (`Crombolo.Dashboard.Overview`, `overwrites: ['Umb.Dashboard.UmbracoNews']`).
   The mock-up's navigation, content tree, search, notifications and user menu
   are the back office's frame, not its home page, and are not part of this
   story. There is no date range: recent is ordered by time.
2. **Everything is narrowed to what the reader may see.**
   - Recent content and the counts are a content query (`queryDocuments`) in
     the reader's scope: start nodes and Browse, as story 183's endpoint.
   - The activity feed is the audit log's content entries, kept only for pages
     the reader may read. A deleted page has no place left to check, so it is
     left out.
   - "View all" on the feed shows only to someone who may read the audit log,
     and opens its Settings card.
3. **The guide is the empty site's holding page.** It is what everyone sees
   after `init`, `bun install` and `bun start`. It stays a 404 with `noindex`,
   and it is the same page in production, since it only shows while nothing is
   published. The `basic` template's home page was the alternative.
4. **The holding page is styled as Crombolo:** the brand palette
   (`docs/brand.md`), the logo inline for light and dark, and the favicon.

## Plan

1. **Server:** `GET <backoffice>/crombolo/api/overview?list=recent|drafts|published&skip=&take=`
   (`packages/server/src/overview.ts`). It needs the Content section. Data
   comes from `overviewPageFacts` (`packages/data/src/overview.ts`): a page's
   type name, the author of its current version, and its key chain.
2. **The dashboard:** `plugin/overview-dashboard.js`, with its words in
   `plugin/overview-format.js`, which is pure. It has:
   - the greeting;
   - Recent content, with View all paging 25 at a time;
   - Quick stats, whose links list drafts or published in place;
   - Activity;
   - New content, which opens Umbraco's create dialog at the root or under
     the reader's first start node.
3. **The guide:** `no-nodes.ts`, in four steps (sign in, describe a page,
   write its template, create and publish), then where things live and a link
   to the full guide.
4. **Tests:**
   - `tests/overview.test.ts`: an administrator, the lists and paging, a
     branch editor's narrowing, refusals, and the words;
   - `tests/no-nodes.test.ts` and the new-site integration test for the
     guide;
   - `tests/browser/overview.browser.ts`.
5. **Docs:** the README, the product site's getting started page, and the
   release notes.

## Acceptance criteria

- [x] Signing in opens the Content section on the Overview: greeting, Recent
      content, Quick stats, Activity and New content, and nothing about how
      Crombolo is built.
- [x] Pages, counts and activity are only those the reader may see.
- [x] The feed's View all shows only to someone who may read the audit log.
- [x] An empty site's every address is a one-page getting-started guide in
      Crombolo's styling, light and dark, still a 404.
- [x] Tests and docs as in the plan.

## Implementation (2026-11-01)

As planned:
- `logoDarkSvg` was added to `@crombolo/backoffice-host/branding`, beside
  `logoSvg`.
- The page's counts come from the same query as its list, so a restricted
  user's counts are as exact as story 183's query is (`exact`).
- A row's title opens the page's editor. The mock-up's row menu was left out,
  since its only item would be "Open".
