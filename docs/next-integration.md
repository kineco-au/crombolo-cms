# The Next.js integration

`@crombolo/next-integration` (story 208) is a Next.js App Router front end for
a crombolo site. It reads the site through the Delivery API and handles the
parts a front end needs: caching, preview, members, images and live reload. It
supports Next.js 15.5 and 16, with React 19.

The quickest way to start is a scaffold that is already wired:
`bunx @crombolo/cli init --next`, or the `next` and `demo/harbourstone-next`
templates, put the app in `web/`. How the pieces fit together is in
[`delivery-api.md`](delivery-api.md), "A Next.js front end". This page lists
what the package offers, by entry point.

## Reading content: `@crombolo/next-integration`

`createCrombolo({ url, apiKey, cache, revalidate, host, culture, startItem, secret, apiPath })`
wraps the typed Delivery API client for server components.

| What | Gives |
| --- | --- |
| `item`, `items`, `content`, `mediaItem`, `media`, `menu`, `search`, `form`, `sitemap` | the client's reads, typed from the site's schema; `content` filters, sorts and pages |
| `page(path)` | the page at an address, or the redirect or refusal the site would answer, as a `Result` |
| `resolvePage(path)` | the same, ended with Next's `redirect`, `permanentRedirect`, `notFound`, `unauthorized` or `forbidden` |
| `notFoundPage()` | the site's not-found page for a hostname |
| `host`, `culture`, `startItem` | the root and language a lookup resolves for, as the site's domains pick them |
| Draft Mode | reads give drafts, with the editor's preview token |
| `member()` | the signed-in member's reads with their token, never kept, and their session; undefined for a visitor |
| `fresh` | reads revalidated by ETag on every call, for a page rendered per request |
| `metadata(item, extra)`, `metadataOf()` | Next's `Metadata` from a page's search and sharing details |
| `revalidate(keys)` | clears every kept answer holding those keys |

## Caching: `./cache-16`, `./cache-15`

| Adapter | How answers are kept and cleared |
| --- | --- |
| `cache16` | `'use cache'` with `cacheTag`: each answer is tagged by the content keys it holds, so a publish clears exactly what holds the page and its ancestors. Needs `cacheComponents: true` in `next.config.ts` |
| `cache15` | Next 15 tags a fetch before it runs, so every answer is kept under the site's tag and any change clears them all |

Both honour the site's instruction not to keep an answer (a redirect, a form,
anything personal), and clear kept not-found answers on every change, since a
new page may answer one. Without an adapter, every read revalidates by ETag.

## Route handlers: `./route-handlers`

| Handler | Mounted at, for example | Does |
| --- | --- | --- |
| `previewHandler(crombolo)` | `app/api/crombolo/preview/route.ts` | what the CMS's Preview button opens: checks the token, turns on Draft Mode, lands on the page |
| `exitPreviewHandler()` | `app/api/crombolo/exit-preview/route.ts` | leaves Draft Mode and forgets the preview token |
| `revalidateHandler(crombolo)` | `app/api/crombolo/revalidate/route.ts` | takes the CMS's webhook, checks its shared secret, and clears the item and its ancestors |
| `memberHandlers(crombolo, options)` | `app/api/crombolo/sign-in`, `callback` and `sign-out` | member sign-in with PKCE, and sign-out; a return path is only ever a path on this app |
| `mediaHandler(crombolo)` | `app/media/[...path]/route.ts` | the CMS's media file, sent with the member's token, for protected media |
| `liveReloadHandler(crombolo)` | `app/api/crombolo/live/route.ts` | the CMS's content and schema changes, streamed in development (story 214) |

## Middleware: `./middleware`

`cromboloMiddleware(crombolo)`, exported from `middleware.ts` (`proxy.ts` in
Next.js 16):

- **Refreshes a member's session.** A page cannot set cookies, so an access
  token close to running out is exchanged with the refresh token here, and the
  page sees the new session at once.
- **Answers redirects, misses and members-only pages before a page renders.**
  With Partial Prerendering a page's status is sent before its content streams,
  so a page can no longer turn itself into a redirect or a 404; this can.

## Components: `./components`, `./client`

| Component | Does |
| --- | --- |
| `<RichText>` | rich text from the Delivery API's tree (story 216): each tag as itself, or through your component for it in `components`; a link to a page as a Next link to its route; each block through the component for its element type in `blocks`. Entities are decoded, and attributes that are event handlers are never rendered |
| `<BlockList>`, `<BlockGrid>` | block editors rendered through a component per element type; the grid laid out in its columns, areas included |
| `<CromboloLiveReload />` | in development, refreshes the server components when content or the schema changes, keeping client state; renders nothing, and does nothing in production |

## Images: `./image-loader`

- **A loader for `next/image`.** The CMS does the resizing, so the loader writes
  its imaging query (width, quality, a modern format), keeping any crop, rather
  than Next's optimiser doing the work:

  ```ts
  // next.config.ts
  images: { loader: 'custom', loaderFile: './lib/image-loader.ts' }
  // lib/image-loader.ts
  export { default } from '@crombolo/next-integration/image-loader'
  ```

- **`cromboloImage(picked)`** turns a picked image into what `<Image>` needs: an
  address carrying its crop or focal point, and its size.

## Sessions

A member's tokens, a sign-in in progress and the editor's preview token are
kept in cookies. The member's are sealed with AES-GCM under
`CROMBOLO_NEXT_SECRET`, which must be at least 32 characters. Cookies are
http-only and `SameSite=Lax`, and `Secure` except on plain http. Only Web Crypto
is used, so it runs in Node and at the edge alike.
