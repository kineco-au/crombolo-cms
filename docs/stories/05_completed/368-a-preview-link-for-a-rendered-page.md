# 368 — A preview link for a rendered page

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** S
**Depends on:** 364

## Story

As a developer whose tools change drafts, I want a link that opens one page's draft in
any browser for a few minutes, so that a tool with its own browser can see what it made
without holding a back-office sign-in.

## Context

The rendered site shows a draft only to a signed-in editor (`docs/rendering.md`,
"Preview"): the `UMB_PREVIEW` cookie plus the back office's access-token cookie. A tool
that changed a page through the Management API, for example with a token exchanged
through a provider (364), has its own browser but no back-office session in it.
Putting one there would hand a back-office credential to a page's own scripts. A
headless app already has a preview token for the Delivery API (053), but nothing serves
a rendered page that way.

## The design

- **Asking for a link:** `POST <backoffice>/crombolo/api/preview-link`
  `{ document, culture? }` (D1), by anyone who may read the document as the back office's Preview
  does (`canReadDocument`), answers `{ url, expiresAt }`. The address is
  `<site>/<page's route>?crombolo-preview=<token>`.
- **The token:**
  - signed with a key derived from the preview token's (053), and never stored: only its
    single-use id is, once used (D2);
  - names the user, the document, the culture and a single-use id;
  - lasts 5 minutes before first use.
- **On first use:**
  - **The exchange:** the site checks the token, spends its id, and answers with a
    `303` to the same address without the parameter.
  - **The cookie:** it sets `crombolo_preview_link`, httpOnly, `Secure`,
    `SameSite=Lax`, path `/`, lasting 30 minutes. It names the user and the document.
  - **The token stays out of reach:** it never stays in the address bar, the history,
    or a `Referer` the page's scripts and analytics could read.
- **With the cookie,** the front end renders drafts as the back office's preview does:
  - **Who reads:** that user, with their read rights checked again on every request.
  - **Ended at once:** by locking them out, unapproving them, or a change of password,
    as preview tokens are.
  - **Not cached:** answered `private, no-store`.
  - **Scope:** the draft of the named document and what it shows (pickers, blocks), and
    published content elsewhere, so a link opens one page's change, not the whole draft
    site.
- **Refused:**
  - a spent, expired or forged token is answered as the page with no draft, and the
    parameter removed;
  - asking for a link without read rights on the document is a `403`;
  - an exchanged token, a command-line token and the back office may all ask, as each
    is a person.
- **The audit** records a link asked for, as the person (through whatever they signed in
  with, and the actor when 366 names one).

## Decisions

- **D1 a: the endpoint is the CMS's own.** `POST <backoffice>/crombolo/api/preview-link`
  `{ document, culture? }`, beside `view-as` and `cli-tokens`, rather than inside
  Umbraco's Management API contract, which 365 keeps to Umbraco's shape.
- **A key of its own.** Links are signed with a key derived from the preview key for
  links alone, so a link can never pass as a Delivery API preview token (053), which
  reads every draft, nor a preview token as a link.
- **D2 b: one table of single-use tokens, renamed for both uses.** Migration 081
  renames 364's `remote_exchange_id` to `single_use_token` (`issuer`, `token_id`,
  `expires_at`), and its unique index with it; `SingleUseTokens.use(issuer, tokenId,
  expiresAt)` replaces `RemoteExchangeIds.spend` for the exchange, and a link uses it
  with the issuer `crombolo:preview-link`. Each id is forgotten once its token expires.
- **The scope is the existing preview's:** `draftModel` renders the one document's
  draft against the published cache, so pickers and blocks show published content.

## Threat model

| Threat | Mitigation |
| --- | --- |
| A link read by the page's own scripts or analytics | Swapped for an httpOnly cookie and redirected away on first use; the token is in the address for one request only. |
| A link forwarded or replayed | Single-use, 5 minutes to first use; the cookie is per browser and 30 minutes. |
| A link showing more than its person may | Rendered as that user, rights checked on every request, and the named document's draft only. |
| A shared cache keeping a draft | `private, no-store`, as every preview is. |
| A forged token | Signed with a key derived from the site's preview key; checked before anything is read. |
| A link used as a Delivery API preview token, or the reverse | Each is signed with its own key, so neither verifies as the other. |

## Acceptance criteria

- [x] `POST <backoffice>/crombolo/api/preview-link` answers a link for a person who may read the
      document, and a `403` otherwise.
- [x] Opening the link once renders the draft in a browser with no other sign-in, after
      a redirect that drops the token. A second opening of the same link renders the
      published page.
- [x] The cookie shows that document's draft for 30 minutes, ends when the person is
      locked out, and shows published content everywhere else.
- [x] Answers are `private, no-store`; the request is audited as the person.
- [x] `docs/rendering.md` ("Preview") describes it, with the endpoint.

## Out of scope

- A link to the whole draft site.
- Links for members or anyone without a back-office account.

## Data

- Migration 081 `RenameSingleUseToken` (release 0.69.0): `remote_exchange_id` is
  renamed `single_use_token`, and `ux_remote_exchange_id` becomes `ux_single_use_token`.

## Built

- **Tokens and cookie:** `packages/server/src/preview-links.ts`. A link and its cookie
  are each signed with a key derived for that purpose from the preview key (053), so
  neither verifies as the other or as a Delivery API preview token.
- **Asking:** `askForPreviewLink` in `server.ts`, at `<backoffice>/crombolo/api/preview-link`:
  `canReadDocument` and the person's standing, the published address or `/<key>`,
  audited as `PreviewLink`.
- **First use:** `usePreviewLink`, before the site's middleware, uses the id through
  `SingleUseTokens` (`crombolo:preview-link`), sets the cookie and answers `303`
  without the token (`no-store`, `no-referrer`).
- **Rendering:** `renderPreview` takes a used link's cookie when there is no editor's
  preview: the person's standing and stamp checked, the named page only, through
  `draftModel`, which checks read rights again; `private, no-store` as any preview.
- **Single-use tokens:** `SingleUseTokens.use` replaces `RemoteExchangeIds.spend`.
- **Tests:** `tests/preview-link.test.ts`; the migration rewinds undo 081.
- **Docs:** `rendering.md` ("Preview") and the release notes.

