# The Delivery API

Umbraco's Content Delivery API v2, at `/crombolo/delivery/api/v2/**` wherever
the back office is mounted, and at Umbraco's own `/umbraco/delivery/api/v2/**`
for Umbraco's headless clients, so a site can
be read headless — from a static-site build, an app or any framework — with the
same requests and the same JSON an Umbraco site answers. Story `050`.

`packages/api-delivery` holds it, over the published cache: every page answer is
read from memory, and media is paged by the database and read through the media
cache (story 197), so it is served by the nodes that render the site (`all` and `web`,
never `api`) and scales with them, not with the backoffice. The contract is
vendored as `packages/contracts/DeliveryApi.json` — Umbraco generates its spec at
runtime and commits none, so this is the integration suite's expected generic
contract at `release-18.2.0`: eight operations, content and media.
`bun run coverage:api` counts it in `docs/api-coverage.md` by sending each
operation to the handler.

The research behind every rule here, with Umbraco file references, is in
[`stories/05_completed/050-research/`](stories/05_completed/050-research/).

## Settings

Off unless a site turns it on, as Umbraco's `DeliveryApi:Enabled` is.

```ts
// crombolo.config.ts
export default defineConfig({
  deliveryApi: {
    enabled: true,
    publicAccess: true,          // false: every request needs the key
    apiKey: process.env.DELIVERY_KEY,
    disallowedContentTypeAliases: ['settings'],
    media: { enabled: true },
    cors: { allowedOrigins: ['https://app.example.com'] },
    preview: { url: 'https://app.example.com/preview?path={path}&token={token}' },
    memberAuthorization: {
      clientCredentialsFlow: {
        enabled: true,
        associatedMembers: [{ userName: 'shop', clientId: 'shop', clientSecret: process.env.SHOP_SECRET! }],
      },
      authorizationCodeFlow: {
        enabled: true,
        loginRedirectUrls: ['https://app.example.com/callback'],
        logoutRedirectUrls: ['https://app.example.com/'],
        loginPage: '/login',
      },
    },
  },
})
```

| Setting | Default | Environment |
| --- | --- | --- |
| `enabled` | `false` | `CROMBOLO_DELIVERY_API` |
| `publicAccess` | `true` | `CROMBOLO_DELIVERY_API_PUBLIC` |
| `apiKey` | none | `CROMBOLO_DELIVERY_API_KEY` |
| `allowedContentTypeAliases` / `disallowedContentTypeAliases` | none | — |
| `media.enabled`, `media.publicAccess` | `false`, `true` | `CROMBOLO_DELIVERY_API_MEDIA` |
| `cors.allowedOrigins` | none | `CROMBOLO_DELIVERY_API_CORS_ORIGINS`, comma separated |
| `preview.url` | none | `CROMBOLO_DELIVERY_API_PREVIEW_URL` |
| `preview.urls` | none — per content type alias, winning over `url` | — |
| `preview.tokenMinutes` | `60` | `CROMBOLO_DELIVERY_API_PREVIEW_TOKEN_MINUTES` |
| `memberAuthorization.*` | both flows off | — |
| `memberAuthorization.timeoutMinutes` | `20` | — (Umbraco's `Global:TimeOut`) |

## Access

As Umbraco's `ApiAccessService`: content needs `enabled` and either
`publicAccess` or the exact `Api-Key` header; media needs `media.enabled` too and
both public flags, or the key. A refused request, including one to a disabled
API, is a **401 with an empty body**; so are 403 and 404. A `Preview: true`
request needs the key or a preview token, and reads drafts ("Preview" below).

## Preview

A `Preview: true` request reads every page as an editor last saved it, published
or not: a page never published, the newer draft of one that is, and the pickers
and blocks pointing at either. Story `053`.

- **Who may.** A request carrying the API key, as in Umbraco — for a server, since
  a key cannot be kept out of a browser — or a **preview token** in
  `Preview-Token`, for an app in the browser. Without either, `Preview: true` is a
  401, even on a public API. A token without `Preview: true` reads what is
  published, like any request.
- **A token** is issued by the backoffice's Preview button to the editor who
  pressed it, and lasts `preview.tokenMinutes`. It reads only what that editor may
  read in the backoffice — the Content section, their start nodes, Read on the
  page (`canReadDocumentAt`) — checked page by page: any other page is answered as
  if it were not there, and keeps only its route in a picker. Who the editor is
  is checked again on every request, so locking them out, unapproving them or a
  change of password (their security stamp) ends every token they hold. A token
  is signed, not stored (`packages/server/src/preview-tokens.ts`, its key in the
  database as `crombolo/previewTokenKey`).
- **What changes.** Item, items, path and query requests read the drafts.
  `item/preview-<key>` answers a page by key, Umbraco's preview address, only in
  preview. Members-only rules still apply; with a member's token as well, the app
  sees what that member would. Search stays published, because its index is;
  media has no drafts. A preview answer is `Cache-Control: no-store`.
- **The draft cache** is a second published cache over every page's latest saved
  version (`DocumentRepository.loadDrafts`), built on the first preview after a
  change and dropped whenever the published cache is, so a site nobody previews
  never holds it. A save on another node announces nothing, but always adds a
  version, so each preview request compares the newest version id
  (`latestContentVersionId`) with the one the cache was built at. Moves, sorts,
  deletes, publishes and restores announce themselves as content instructions.

### The Preview button

With `preview.url` set — or `preview.urls` for the page's content type alias —
the backoffice's Preview button opens the app; Umbraco's own preview stays in the
button's menu. Without either, nothing changes: the option's manifest
(`plugin/app-preview/`, `Crombolo.AppPreview`) is not served. The option is a
`previewOption` workspace action menu item, provider `cromboloAppPreview`, which
`GET document/{id}/preview-url` answers with the app's address, `isExternal:
true` and no preview cookie; the backoffice opens it in a window of its own and
asks for a new address, and so a new token, on every click.

The address fills `{path}` (the page's path, as its route's), `{id}`,
`{culture}` and `{token}`, each escaped:

```
https://app.example.com/preview?path={path}&token={token}
```

The app reads the token and sends it, with `Preview: true`, on every request
while it shows the preview. An address without a scheme and host is said at boot
and never used. A page whose type has no address answers a message the
backoffice shows instead of opening anything.

## Requests from another origin

An app served from another origin — `https://app.example.com` calling the CMS at
`https://cms.example.com` — can call the API from the browser only when its
origin is listed in `cors.allowedOrigins`, in `crombolo.config.ts` or
`CROMBOLO_DELIVERY_API_CORS_ORIGINS`; code wins when both are set. None are
listed by default, and then nothing about the API changes. Story `051`;
`packages/api-delivery/src/cors.ts`.

- An origin is a scheme and host, with a port if it has one and nothing after:
  `https://app.example.com`, `http://localhost:5173`. Anything else — no scheme,
  a path, a query — is said at boot and ignored. Origins compare without case.
- `*` lets any origin in, and is ignored, with a warning, while `publicAccess` is
  off: a private API is opened with a key, and a key must not be usable from any
  page on the web.
- A listed origin's request is answered with `Access-Control-Allow-Origin`
  naming it, on every answer — including the API's empty 401, 403 and 404, so
  the app can read the status. Every answer on these paths gets `Vary: Origin`.
  Credentials are never allowed: the key and member tokens travel in headers,
  never cookies.
- A pre-flight (`OPTIONS` with `Access-Control-Request-Method`) answers `204`.
  For a listed origin it allows `GET, HEAD` on content, media and search, `POST`
  on `token` and `revoke`, and `GET, POST` on `userinfo`, with the headers the
  API reads: `Accept-Language`, `Api-Key`, `Authorization`, `Content-Type`,
  `Preview`, `Preview-Token` and `Start-Item`, cached for ten minutes. Any other origin gets a
  bare `204`, which the browser treats as a refusal.
- `authorize` and `signout` have no CORS headers: an app navigates to them, it
  never `fetch`es them. The Management API and the backoffice stay same-origin.

## Output

Umbraco's shapes, camelCase, nulls written, dates ISO in UTC. A page:

```json
{
  "contentType": "page", "name": "Story",
  "createDate": "2026-10-15T09:12:44.123Z", "updateDate": "2026-10-15T10:00:00.000Z",
  "route": { "path": "/news/story", "queryString": null,
             "startItem": { "id": "…", "path": "home" } },
  "id": "…", "properties": { "title": "Story title" }, "cultures": {}
}
```

- `route.path` is relative to the page's root, whose own segment is
  `startItem.path`; the first root is `/`, another root `/<segment>` when the top
  level is hidden ([`rendering.md`](rendering.md), "URLs"). Paths follow this
  site's own URLs, so they have no trailing slash — Umbraco's
  `AddTrailingSlash = false`. A right-to-left culture keeps the page's segment first.
- `cultures` holds each culture's route; an invariant page has `{}`.
- Pickers are references — `properties` stays `{}` unless expanded. Media
  picker, multinode tree picker and multi URL picker are always arrays. Blocks
  and elements always carry their properties. Rich text is a tree of elements
  ("Rich text", below). A member picker is `"(unsupported)"`, as in Umbraco.
  An empty property is `null`.
- Media answers `path` (names, lowercased, root down, with a trailing slash, as
  Umbraco builds it), `url`, `extension`, `width`, `height`, `bytes`,
  `focalPoint`, `crops`, and its properties other than the `umbraco*` ones.

`expand` and `fields` take v2's grammar — `properties[$all]`,
`properties[picker[properties[$all]]]`, `fields=properties[title]`. `$all`
expands one level; `fields` never expands. Bad syntax is a 400 problem naming it
(Umbraco answers 500).

### Rich text

Every rich-text value is a tree, Umbraco's `RichTextOutputAsJson` form, always
on: there is no HTML form, no setting and no per-request switch (story `216`).
Rich text inside blocks and expanded items is the same tree, and an empty one is
`null`.

```json
{
  "tag": "#root", "attributes": {},
  "elements": [
    { "$type": "RichTextGenericElement", "tag": "p", "attributes": {}, "elements": [
      { "$type": "RichTextTextElement", "text": "Read ", "tag": "#text" },
      { "$type": "RichTextGenericElement", "tag": "a", "attributes": {
          "destinationId": "eed5fc6b-…", "destinationType": "article", "linkType": "Content",
          "route": { "path": "/news/story", "queryString": null, "startItem": { "id": "…", "path": "home" } }
        },
        "elements": [{ "$type": "RichTextTextElement", "text": "the story", "tag": "#text" }] }
    ] },
    { "$type": "RichTextGenericElement", "tag": "umb-rte-block", "attributes": { "content-id": "…" }, "elements": [] }
  ],
  "blocks": [{ "content": { "id": "…", "contentType": "quote", "properties": {} }, "settings": null }]
}
```

As Umbraco's `ApiRichTextElementParser` writes it:
- **`$type`** is on every element below the root, and not on the root.
- **Comments are dropped,** and so is text that is empty or only line breaks;
  whitespace between inline elements stays.
- **`data-*` attributes** lose their prefix, unless an attribute of that name is
  already there.
- **A link to a page** loses `href` and gains `destinationId`,
  `destinationType`, `linkType: "Content"` and its `route`, whose `queryString`
  holds any anchor or query the link had. **A link to media** has `href` set to
  the media's URL, with `destinationId`, `destinationType` and
  `linkType: "Media"`. A local link to something that is gone loses `href`.
- **An image from the media library** has `src` set to the media's URL, keeping
  its query (a crop or width), and loses `data-udi`.
- **A block** is `umb-rte-block` or `umb-rte-block-inline` with `content-id`,
  its entry in `blocks`.
- **Text and attribute values keep their entities** (`&amp;`, `&nbsp;`) as
  stored; `decodeEntities` in `@crombolo/delivery-client` turns them into
  characters.

The contract describes the tree as `RichTextRootElement`,
`RichTextGenericElement` and `RichTextTextElement`, added to Umbraco's
(`DELIVERY_CONTRACT_ADDITIONS` in `packages/contracts`). `@crombolo/delivery-client`
types it as `RichTextValue`, with `a`, `img` and the block tags' attributes
typed, and `walkRichText(tree, visitors)` folds it into whatever an app renders.

## Items and paths

- `item/{id}`, `item/{path}` and `items?id=…`: unknown or disallowed ids are
  omitted from `items`, duplicates once; one members-only item the caller cannot
  open answers 401 or 403 for the whole `items` request, as in Umbraco.
- A path resolves segment by segment, case-sensitively, ignoring trailing
  slashes; with the top level hidden, under any root, first match wins.
  `Start-Item` (a root's id or segment) resolves under that root; one that names
  no root is a 404 saying so.
- `Accept-Language` is used only when it is a single culture name; otherwise the
  default language. Domains are not consulted for the culture.

## Queries

`GET content`: `fetch` (`ancestors:`, `children:`, `descendants:` an id or a
path; `children:00000000-…` is the roots; absent is everything, or the
Start-Item's descendants), `filter` (`contentType:`, `name:` — values OR, `!`
negates, filters AND — and `createDate`/`updateDate` with `:`, `>`, `>:`, `<`,
`<:`; an unparsable date is dropped), `sort` (`createDate`, `updateDate`, `level`,
`name`, `sortOrder`; ascending only when the direction starts with `asc`), `skip`
(0), `take` (10). An unknown option is Umbraco's 400 problem —
`Selector option not found`, `Filter option not found`, `Sort option not found`.
An unresolvable target is an empty page. Without a sort the order is the tree's.

`GET media`: `fetch=children:` is required (`/` for the roots, an id, or a path of
names), filters `mediaType:` and `name:`, and the last sort wins — Umbraco's own
media rules.

**Paged by the database** (story 197). The media library is not held in
memory, so a listing is two indexed queries over `node` (`MediaListingRepository`,
`server/src/delivery-media.ts`): a count of the parent's children that pass the
filters and the caller's access, and the page of their keys, in Umbraco's order
— `sort_order`, then the node id — after any `sort`. The items are then read
through the media cache, and their paths of names in one more query. `item` by
path walks the names a level at a time, in any case. Only the tables a filter
or sort reads are joined, and `ix_node_parent_sort` (migration 051) serves the
order, so a page near the end of a folder of a million files is a few
milliseconds. The documents are the same as when the tree was built in memory.
Access is decided in SQL from the rule above the folder, any child's own rule
and each item's own setting, so `total` counts only what the caller may read.

**Protected media** (story 196) follows the same rules as `/media/`
([`rendering.md`](rendering.md), "Protected media"), with a member's token as
their cookie. A protected item is left out of `media` and `media/items`, and
not counted, for a caller who cannot read it; `media/item` answers **401** to
a caller who is not signed in and **403** to a member not allowed, as for
pages. A media picker, or a multi-node tree picker naming media, in a page's
properties keeps only the item's `id` and `name` for such a caller. The rules
are read once per request (`MediaAccessRepository.allRules`): one per folder
given permissions, so few.

## Search

`GET search?term=…` is a Crombolo addition; Umbraco's Delivery API has no search.
It answers published pages matching every word of `term`, best first, as content
items with two more fields: `score`, and `excerpt`, which is HTML with each
matching word in `<mark>` and everything else escaped. `contentType` (repeatable)
keeps to those types; `skip` (0) and `take` (10, at most 100) page through; the
culture is `Accept-Language`. `total` counts only what the caller may open: a
members-only page is left out unless the bearer token's member may see it. An
empty `term` answers no items. How the index works is in
[`search.md`](search.md#site-search-for-visitors).

## Caching

Answers carry `Cache-Control`, an `ETag` and, optionally, purge tags, as the
site's pages do: nothing is kept unless the site sets a lifetime, a list takes
the shortest of its pages', and an answer to a member's token or from a
non-public API is `private, no-store`. A preview stays `no-store`. Story `057`;
[`operations.md`](operations.md), "Behind a CDN".

## Typed apps

An app types the API's JSON from the site's own schema, and reads it with
`@crombolo/delivery-client`. Story `052`.

```sh
bunx crombolo generate --delivery --out ../app/src/cms-types.ts
# another repository: point at a checkout of the site
bunx crombolo generate --delivery --schema ../site/schema --out src/cms-types.ts
```

```ts
import { createDeliveryClient, isExpanded } from '@crombolo/delivery-client'
import type { DeliveryTypes } from './cms-types'

const cms = createDeliveryClient<DeliveryTypes>({ baseUrl: 'https://cms.example.com' })

const page = await cms.item('/news/story', { expand: 'properties[related]' })
if (page?.contentType === 'article') {
  page.properties.title            // string | null
  const related = page.properties.related
  if (related && isExpanded(related)) related.properties  // typed once expanded
}
```

**The generated file** (`packages/schema/src/generate-delivery.ts`) is read from
`schema/*.toml`, as `crombolo generate` is, so it needs no running site. It holds
one properties interface per page type, element type and media type, with
compositions merged, and `DeliveryTypes`, the map the client takes as its
generic. Running it again on an unchanged schema writes the same file. A page
type the API does not serve (`allowedContentTypeAliases` /
`disallowedContentTypeAliases`) is left out. Every property is `| null`, because
an empty value is written as `null`. Each editor is typed as "Output" above
describes it: a content picker as a page reference, the media picker as an array
with crops, blocks with the element types the data type allows, a multinode tree
picker narrowed by its start node and `filter`, a member picker as
`'(unsupported)'`. The form picker is `unknown` until forms reach the API
(story `056`).

**References or expanded.** A picker's target carries its properties only when
`expand` names it, so references are typed with properties that may be empty,
and `isExpanded()` narrows one that came back expanded. Typing the answer from
the `expand` string itself was rejected as too fragile to keep right. A request
with `fields` types every property as possibly missing.

**The client** has `item`, `items`, `content` (queries), `mediaItem`,
`mediaItems`, `media`, `search`, `route`, `menu`, `sitemap` and `form`. It sends `Api-Key`, `Accept-Language`,
`Start-Item` and a member's bearer token from its options, each overridable per
request; answers `undefined` for an item that is not there; and throws a
`DeliveryError` carrying the status and body for anything else refused. Story
208 added what an app framework needs:
- `preview`, which sends `Preview: true` and the editor's token;
- `seo: true` per request;
- `onAnswer`, which reports each answer's content keys (`contentKeysIn`), purge
  tags and ETag;
- `conditional`, a store of copies revalidated with `If-None-Match`
  (`memoryConditionalStore`). A member's and a preview's answers are never kept.

It has no dependencies and is published as built JavaScript with declarations,
as `@crombolo/next-integration` is and every other crombolo package is not ([`packaging-and-upgrades.md`](packaging-and-upgrades.md),
"Releasing to npm").

## Search and sharing details

`seo=true` on any content answer — an item, items, a query, search, a route —
adds a `seo` object to each page, worked out by `effectiveMeta`, the function
`<SeoHead>` renders from, with the site's settings. Story `055`.

```json
"seo": {
  "title": "About us | Acme", "description": "Who we are.",
  "image": { "url": "https://www.acme.com/media/…/share.png", "width": 1200, "height": 630 },
  "canonical": "https://www.acme.com/about", "robots": "noindex",
  "alternates": [], "xDefault": null, "siteName": "Acme"
}
```

- It is what `<SeoHead {...props} />` writes for the page with no template
  fallbacks, tested side by side: a template's own `title` or `description`
  props have no equivalent here.
- The image carries a size when it is a media item — the page's own, or a site
  default given by key — and `null` sizes otherwise.
- Left out unless asked for, so default answers stay the size Umbraco's are.

**The sitemap as data.** `GET sitemap?host=…` answers `{ total, items }`, each
`{ id, url, lastmod, alternates }`, exactly the pages `/sitemap.xml` lists for
that hostname (members-only pages and hidden ones left out), so an app can serve
its own. A `404` when the site serves no sitemap or is not indexable.

**The public address.** A site an app serves sets `seo.publicUrl`
(`CROMBOLO_PUBLIC_URL`), such as `https://www.acme.com`; preferred addresses,
`/sitemap.xml`, `robots.txt`, this sitemap and the backoffice's search preview
then use it instead of the CMS's own host ([`seo.md`](seo.md)).

## Menus

`GET menus/{alias}` answers a menu built in the Library, in the request's
culture: `{ alias, items }`, each item `{ label, kind, id, url, route, target,
children }`. A page has its `route`, as a content item's; media and external
links have a `url`; a label has neither. A page the caller may not open, or of a
type the API does not serve, is left out with the items below it. A `404` when no
published menu has that alias. Story `141`; [`rendering.md`](rendering.md),
"Menus". `@crombolo/delivery-client` has it as `menu(alias)`.

## Forms

An app draws a form itself from `GET forms/{key}` (its key or alias), and posts
it to the site as a rendered form does. Story `056`;
`packages/api-delivery/src/forms.ts`.

- **What it holds:** the form's name, labels and message; its pages, groups and
  fields with what a visitor needs — caption, help, whether mandatory and the
  message, pattern, placeholder, default, limits, accepted files, conditions, a
  bundle type's settings, and `options` with any choice source already resolved
  in the requested culture; `types`, describing each field type the form uses —
  label, what it stores, whether it collects anything, and for a bundle's type
  its bundle and declared settings, so an app can recognise one it does not
  know; `redirectTo` as an address; and `submit`.
- **Never** its workflows, notes, storage and approval rules or entry cap: they
  are the site's, and a workflow can hold addresses and secrets.
- **`submit`** is `{ action, method, fields, honeypot, page }`: post the answers
  to `action` (absolute, on the CMS) as multipart or URL-encoded form data with
  `fields` — a token signed for this form and when it was drawn — and the
  `honeypot` field empty; with `Accept: application/json` the answer is
  `200 { ok, message, entryId }` or `422 { ok: false, errors }`
  ([`forms.md`](forms.md), "Submitting"). A stepped form checks one page by
  posting `page` with its index. Files go as multipart parts under the field's
  alias.
- **Never kept** (`no-store`): the token carries the moment the form was drawn,
  and a copy kept for an hour would let a bot past the timing guard.
- **From another origin**, submissions answer with CORS headers on the Delivery
  API's `cors.allowedOrigins` (story `051`), pre-flight included.
- **A form picker** is a reference, `{ id, alias, name }`; expanded
  (`expand=properties[signUp]`) it is the form as above, and the answer holding
  it is `no-store`. Before this story a form picker wrote out the whole stored
  definition, workflows and their settings included.

## Route lookup

`GET route?path=…&host=…` is a Crombolo addition: what the site would answer at
a visitor's address, so an app's router behaves as the rendered site does and
old links keep working. Story `054`. `path` is required; `host` defaults to the
request's own and picks the root and culture as the site's domains do — the
published cache's `resolve`, which the renderer uses.

| Answer | Status | Body |
| --- | --- | --- |
| A page | 200 | `{ kind: 'page', culture, item }`, `item` as `item/{path}` writes it |
| A redirect | 200 | `{ kind: 'redirect', location, statusCode, permanent }` |
| Nothing | 404 | `{ kind: 'notFound', item }`, `item` the site's not-found page or `null` |

- **In the site's order.** A page answers first, so a redirect never hides live
  content. A page whose `umbracoRedirect` names another is a `302`. Then the
  redirect rules, as `PublishedCache.redirect` tries them for the rendered site:
  rules from `crombolo.config.ts`, then the URL tracker's, then the ones
  administrators type in Settings (the `simple-redirects` bundle), all one table.
  Then the not-found page chosen in Settings → Search & sharing.
- A redirect answer is `no-store`, as the site's redirects are, so renaming a
  page back cannot strand anyone. A page answer is kept as its page is.
- Members-only pages answer `401` or `403`, as the item endpoints do. With
  `Preview: true` and a key or preview token, drafts answer as pages; redirects
  and the not-found page are always the published ones.
- `@crombolo/delivery-client` has it as `route(path, { host })`, which returns
  the answer for a `404` rather than throwing.

## Members-only pages

The nearest protected ancestor governs, as on the site: a member is let in by
user name or by a group, both in any case, and must be approved and not locked
out. The check is the site's own (`memberMayOpen` in `@crombolo/core`). An item endpoint answers **401** to a caller who is not signed in and
**403** to a member not allowed. A members-only page is **never listed** in a
query for a caller who cannot open it — Umbraco lists them when member sign-in
is off. An expanded reference to one keeps its route but not its properties.
The rules are read once per request (`PublicAccessRepository.allRules`).

## Member sign-in

Under `/crombolo/delivery/api/v1/security/member/` (Umbraco's
`/umbraco/delivery/api/v1/security/member/` answers too; still v1 in Umbraco 18.2),
whether or not the content API is on. `packages/server/src/delivery-members.ts`.

- **Client credentials**, for a server reading members-only content on its own
  account: `POST token` with `grant_type=client_credentials`,
  `client_id=umbraco-member-<id>` and its secret (form or HTTP Basic). An access
  token only, no refresh. Those members show as kind `Api` in the backoffice,
  derived from the config.
- **Authorization code with PKCE**, for an app a member signs in to: `GET
  authorize` with `client_id=umbraco-member`, a registered `redirect_uri`,
  `response_type=code`, an **S256** `code_challenge`, and `scope` of `openid`
  and `offline_access`. A member not signed in is sent to `loginPage` with a
  `returnUrl`, signs in through the site's member login, and returns; the app
  gets `?code=…&state=…&iss=…` and exchanges it at `token` with the verifier.
  Refresh tokens roll: each is spent on use.
- `signout` clears the member's site session **and ends their tokens**; a
  `post_logout_redirect_uri` must be registered. `revoke` ends one token;
  `userinfo` describes the member.

Tokens are random and opaque; only their SHA-256 is stored
(`delivery_member_token`, migration 037). An access token lasts a quarter of
`timeoutMinutes`, a refresh token all of it, a code five minutes. A token is
accepted from the `Authorization` header only — never `?access_token=` — and an
invalid or expired one counts as anonymous. It is checked against the member as
they are now, so locking a member out, unapproving, deleting or regrouping them
takes effect at once.

Errors follow Umbraco and OpenIddict: authorize and sign-out refuse with plain
`error:` / `error_description:` lines and never redirect; the token endpoint
answers JSON, `invalid_client` with 401.

A misconfigured flow — no or relative redirect URLs, no login page — is said at
boot, and the flow is off, as Umbraco turns it off.

## A Next.js front end

`crombolo init --template next` scaffolds an empty site with a Next.js App
Router app in `web/`. `--next` adds the same app to any template, and
`demo/harbourstone-next` is Harbourstone built that way. `bun run dev` starts
the CMS on `:8080` and the app on `:3000`. Story 208;
`packages/next-integration`, `packages/cli/next-app`. Everything the package
offers, by entry point, is listed in [`next-integration.md`](next-integration.md).

```
my-site/
  crombolo.config.ts  server.ts  schema/  components/  seed/   the CMS
  schema/webhooks/next-revalidate.toml                          clears the app's cache
  web/                                                          the Next.js app
    lib/crombolo.ts      createCrombolo({ url, apiKey, cache: cache16 })
    proxy.ts             cromboloMiddleware(crombolo)
    app/[[...slug]]/page.tsx   every CMS address, generateMetadata included
    app/api/crombolo/…   preview, exit-preview, revalidate, sign-in, callback, sign-out, live
    app/media/[...path]/route.ts   media, with a member's token
```

**Reading pages.** `crombolo.page(path)` is the route lookup as a `Result`.
- **The answers:** a page is `Ok`; a redirect is `foundAt` (302),
  `movedPermanentlyTo` (301), `redirect` (307) or `permanentRedirect` (308); a
  miss is `notFound`; a members-only page is `unauthorized` or `forbidden`.
  This is 206's `Result`, copied into the package and kept identical by a test.
- **`resolvePage(path)`** ends the lookup with Next's own `redirect`,
  `permanentRedirect`, `notFound`, `unauthorized` or `forbidden`.
- **`metadata(item)`** is Next's `Metadata`, from the page's search and sharing
  details.
- **The rest:** `item`, `content`, `menu`, `search`, `form`, `sitemap` and
  `notFoundPage()`. The not-found page is `pages.notFound` when it is set, as
  the route lookup's is.

**Caching** is hybrid:

| What is read | How it is kept |
| --- | --- |
| Public content | Kept in Next's cache, tagged with every content key the answer holds and the site's purge tags. The webhook clears exactly what holds a changed page and its ancestors, and any kept not-found, as a new page may answer one |
| `crombolo.fresh.*`, for a page rendered per request | Revalidated with `If-None-Match` against a kept copy on every call. A `304` reuses it. `revalidate: 'etag'` reads everything this way, for a site with no webhook |
| `await crombolo.member()`, and anything in Draft Mode | Never kept |

**The proxy** (`proxy.ts`; `middleware.ts` on Next.js 15) runs before a page:
- **Sessions.** It refreshes a member's session, since a page cannot set
  cookies.
- **Status.** It answers what a page can no longer change once Partial
  Prerendering has sent its status:
  - a CMS redirect keeps its exact status, 301 and 302 included;
  - a miss is rewritten to `app/crombolo/not-found` and answers 404;
  - a members-only page sends a visitor who is not signed in to sign-in.

  Each lookup is revalidated by ETag, so it is a `304` from the CMS.

**Preview.** `deliveryApi.preview.url` points the Preview button at
`/api/crombolo/preview`.
1. The handler checks the token with a route lookup, which answers 401 for a
   bad one.
2. It turns on Draft Mode and keeps the token in an http-only cookie.
3. Reads then send `Preview: true` with that token.

**Revalidation.** `schema/webhooks/next-revalidate.toml` posts Crombolo's
payload (`payload = "crombolo"`, [`webhooks.md`](webhooks.md)) to
`/api/crombolo/revalidate`.
- Its `X-Crombolo-Secret` header is checked in constant time against
  `CROMBOLO_REVALIDATE_SECRET`.
- The item's and each ancestor's tags are cleared.

**Live reload** in development (story 214). `<CromboloLiveReload />` from
`@crombolo/next-integration/client`, in the root layout, refreshes the page's
server components when the CMS's content or schema changes, keeping client
state. Next.js already reloads the app's own code.
- It listens on `/api/crombolo/live` (`liveReloadHandler(crombolo)`). That
  route passes on the CMS's change stream, plus a `revalidated` event once the
  revalidate route has cleared what a webhook named, so the refresh after it
  shows the new content.
- Outside development the component renders nothing and the route answers 404.

**Members** sign in with PKCE through the CMS's member authorization.
- **Tokens:** the access and refresh tokens are sealed with AES-GCM under
  `CROMBOLO_NEXT_SECRET` (32 or more characters) in one http-only cookie.
- **Refresh:** the proxy refreshes them before they expire.
- **Sign-out:** it revokes the refresh token and ends the CMS session.
- **Media:** `/media/…` passes the member's token, so protected media reaches
  who may read it, `private, no-store`.

**Content.**
- `<RichText>` renders the tree: each tag as itself or through a component in
  `components`, a link to a page as a Next link to its route, and each block
  through the component for its element type in `blocks`.
- `<BlockList>` and `<BlockGrid>` take a component per element type. An
  unknown block renders nothing, or a notice in Draft Mode.
- The image loader writes the CMS's imaging query, and `cromboloImage(media,
  { crop })` carries a crop or focal point.

**Settings.**

| Where | Setting | What it is |
| --- | --- | --- |
| CMS `.env` | `CROMBOLO_DELIVERY_API_KEY` | the API key the app reads with, for preview |
| CMS `.env` and `web/.env.local` | `CROMBOLO_REVALIDATE_SECRET` | the webhook's shared secret |
| `web/.env.local` | `CROMBOLO_URL` | the CMS's address |
| `web/.env.local` | `CROMBOLO_APP_URL` | the app's own address, for sign-in redirects |
| `web/.env.local` | `CROMBOLO_NEXT_SECRET` | seals members' sessions |
| `web/.env.local` | `CROMBOLO_HOST` | the hostname routes resolve for, when the CMS has several |

`init` writes them all, the secrets made fresh for each site.

**Keep a template per page type.** The sitemap, and so the pages built ahead,
and site search count only pages whose type has a template, as Umbraco does.
That holds even when the app renders them. Story `217` would lift that.

**Next.js 16 and 15.** The scaffold is for 16:
- `cacheComponents` and `partialPrefetching` on;
- `'use cache'` through `@crombolo/next-integration/cache-16`;
- `proxy.ts`.

A site on 15 needs four changes:
- import `cache15` from `./cache-15`;
- rename `proxy.ts` to `middleware.ts`;
- drop `cacheComponents` and `partialPrefetching`;
- keep TypeScript at 5, since Next.js 15 reads `next.config.ts` through
  TypeScript's JavaScript API, which TypeScript 7 has not got.

Next.js 15 tags a fetch before it runs, so there every answer is kept under the
site's tag and any change clears them all. `bun run smoke:next --next 15|16`
builds and runs a scaffolded app on either, as CI does.

## Not built

`Accept-Segment`, domain cultures in path resolution, and
external login providers in the sign-in flow.

Planned as a story: translations, menus and site settings (`058`).
