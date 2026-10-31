# 232 — Plain Signal, a magazine demo

**Epic:** O — Building a site · **Priority:** could · **Size:** L
**Depends on:** 058, 209, 228

## Story

As someone trying Crombolo, I want a second demo site that is a publication
rather than a shop: articles with images, sections, a newsroom's approval
workflow and a contact form, so that I can see how an editorial team would run
a site on it.

## Decisions (2026-10-31)

1. **The name is Plain Signal:** AI news with the noise taken out.
2. **A Crombolo-rendered site,** as Harbourstone is, with the contact form as a
   React island (`'use client'`) that draws its form definition from
   `schema/forms/` through the Delivery API and submits it from the browser.
   Not chosen: a Next.js front end; both.
3. **Openly licensed images, each licence read from its source page,** recorded
   in `CREDITS.md`: public domain, CC0, CC BY and CC BY-SA only. Not chosen:
   SVG illustrations; placeholders.
4. **The approver groups are declared in files** (story `228`, built first):
   Writers, Sub-editors and Editors in `schema/user-groups/`.
5. **Distributed as a template,** `crombolo init --template demo/plain-signal`.
6. **A two-stage workflow for articles:** Sub-editors approve, then Editors,
   which publishes. Sub-editors send back to the writer; Editors back to the
   sub-editors' stage. A writer's edit to a waiting article goes into the
   request (`approve-latest`); nobody approves their own; everyone goes through
   it, administrators included; a send-back needs a comment; publishing may be
   scheduled. Not chosen: a parallel standards stage; one stage of two.

## The stories

Six articles on real advances, written for a general reader, each with its
sources: AI weather forecasting (GenCast), AI-supported breast screening (the
MASAI trial), a speech implant for a man with ALS (BrainGate, UC Davis),
AI-designed antibiotics (MIT), an AI at the Mathematical Olympiad (Gemini Deep
Think) and the 2024 chemistry Nobel for protein structure (AlphaFold). The
facts are checked against the primary sources named in each article.

## Acceptance criteria

- [x] `sites/plain-signal` runs with `crombolo start --seed --publish`: a home
      page of the latest articles, sections, six articles with images, captions
      and credits, and a contact page.
- [x] Articles go through the two-stage workflow, the groups coming from
      `schema/user-groups/`.
- [x] The contact form is a React island drawn from `schema/forms/`, working
      without JavaScript through its server-rendered fallback.
- [x] Every image has its source, licence and attribution in `CREDITS.md`, and
      the packaging test passes.
- [x] `crombolo init --template demo/plain-signal` makes a site that checks and
      renders.
- [x] README and docs name the template.

## What was built

- **`sites/plain-signal`** (`demo/plain-signal`, distributed): `homePage`,
  `sectionPage`, `article`, `contactPage` and `siteSettings` types; the views
  in `components/` (a shared layout reading the settings page, article cards,
  the four page templates) and `css/site.css`, light and dark.
- **The newsroom:** `schema/user-groups/` (Writers, Sub-editors, Editors) and
  `schema/workflows/article-approval.toml`, two stages as decided.
- **The contact form:** `schema/forms/contact.toml`, drawn by
  `components/shared/contact-form.tsx`, a `'use client'` island reading
  `GET forms/writeToTheDesk`, checking mandatory fields and conditions as the
  reader types, and posting with the form's token and honeypot; the page's
  server `<Form>` is its fallback.
- **The seed:** three sections, six articles (GenCast, MASAI, BrainGate,
  MIT's antibiotics, the 2025 Olympiad, the 2024 chemistry Nobel), each with
  its image, caption, credit, "why it matters" and sources; a contact page; the
  settings page. Six images from Wikimedia Commons, each licence read from its
  file page, in `CREDITS.md`.
- **Found while building:** an unquoted TOML date in a seed was always refused,
  because Bun's TOML gives a Temporal value; dates are now read from it and
  stored as a save stores them (`packages/server/src/seed/compile.ts`, covered
  in `tests/seed.test.ts`, `docs/seeds.md`).
- **Tests:** `tests/plain-signal.test.ts` (the site booted with its seed: front
  page, an article, the island and its built code, the groups, an article sent
  for approval); the CLI end-to-end suite makes and serves a site from the
  template; the site and template lists.
- **Docs:** the README and `docs/configuration.md` name the template.
