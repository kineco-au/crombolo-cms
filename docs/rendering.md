# Rendering

Umbraco renders with Razor. We render with **TSX executed by Bun**. The goal is
not syntactic similarity but the same *contract*: the same model, the same
fallback semantics, the same layout chain, the same routing.

## Components on disk

Every `.tsx` a site renders lives under one root, `components/`, at whatever
depth suits it. A **template** is one that a content type names; everything
else is only ever reached by an `import`. That is the whole distinction, and it
is recorded in the schema (`templates = ["pages/homePage"]`) rather than in the
directory — so there is no second place that could disagree with it.

**This is a deliberate divergence.** Umbraco splits the two into `~/Views` and
`~/Views/Partials`, with separate trees and separate APIs, because Razor needed
the distinction for master-template inheritance. A TSX layout is an import, so
the split bought nothing here and cost a rule about where a file may live.

A template is still a `template` row (`alias`, plus a `node` row for name and
parent) paired with a file, and **the alias is the path**: `pages/homePage`
means `components/pages/homePage.tsx`. An alias arrives from the database, so it
is checked segment by segment before it is joined to a path — `..`, an absolute
path and a drive letter are all refused.

The **layout chain lives in the file, not the database**. Umbraco parses
`Layout = "master.cshtml";` back out of the Razor source with a regex and treats
it as the source of truth, keeping `node.parent_id` in sync. We do the same with
an exported constant:

```tsx
export const layout = 'master'
export default function HomePage({ model }: PageProps) { … }
```

The template editor is Umbraco's and still speaks Razor. A new template
starts as its Razor scaffold, and picking a layout prepends
`@{ Layout = "master.cshtml"; }`. Removing a layout from a view with no such
block sends `"undefined.cshtml"`. On save the server translates, in
`fromBackofficeTemplate`: the untouched scaffold becomes the TSX starter, and
a layout block becomes the view's `export const layout`, replacing any it had.
Anything else is saved as written.

("Master template" was renamed **layout template** in Umbraco 18;
`MasterTemplateAlias` is obsolete and scheduled for removal in v20, so we use
"layout" throughout.)

Which template a document renders comes from `document_version.template_id` —
*per version*, so a draft and its published version can legitimately differ —
constrained by `content_type_template`. `?altTemplate=` overrides it.

There is no resolution order to mirror, because there is nothing to resolve: a
component is imported by its own relative path, the way any other module is.

```
components/pages/homePage.tsx     a template — homePage's type names it
components/shared/layout.tsx      a component — imported, never routed to
```

### Checking them before a visitor does

A view is compiled when a request renders it, so one that does not compile is a
500 that waits to be found. `crombolo components check` brings that forward: every
`.tsx` under `components/` is transpiled — which gives the line a syntax error is on
— and then imported, which is what a render does, so an import that does not
resolve is caught as well. It also reports a template a content type declares
with no file behind it, the `noTemplate` 404 seen from the other side.

Types are a separate question, because they need the compiler and a site may not
have one: when `typescript` is installed the command also runs `tsc --noEmit`
over the site, and when it is not it says so rather than quietly checking less.

Values that can name media are read asynchronously (story 197, "The media
cache" below), so a view written before that reads a promise as if it were the
value. The check finds it both ways:

- **Without the compiler.** `model.media('hero')[0]`, a property read off it, a
  destructuring `const [hero] = model.media(…)` or a `for … of` over it is a
  problem, named with its line and the change to make:
  `(await model.media('hero'))`, in an async component (`unawaitedMedia`).
  Passing the promise on, or returning it, is left alone.
- **With it.** Generated types give the pickers, links and rich text their
  `Promise<…>` types, so `tsc` reports every other use, and each message about
  one says to await it in an async component (`withAwaitHint`).

`templateAliasesIn` scans the whole tree and the schema validator checks against
it, so a content type naming a template that no file provides is refused by
name. A component nobody declares is left alone: that is the normal case, not a
suspicious one.

A component may only import what the tree contains. A relative import that
climbs out of `components/` resolves on disk and fails the moment the view is rendered, because
it is rendered from a snapshot of the tree and nothing above it; `components check`
refuses one, where the message can explain itself.

## A changed view, without a restart

A view is a module, and the module registry behind `import()` is keyed on the
resolved path, has no eviction, and ignores a cache-busting query on Bun. Even
where the query works — Node does honour it — the graph *beneath* a re-imported
file stays pinned, so re-reading a template would still render the layout it
first imported. Clearing any cache this codebase owns changes none of it.

Only a new path is read fresh, so each node renders from a content-addressed copy
of the tree (`render/snapshots.ts`):

    alias  →  <componentsCacheDir>/<hash>/<alias>.tsx

The hash covers the whole tree, because a template's behaviour is its import
graph: `homePage.tsx` can be byte-identical while its layout changed. Structure
is preserved, so relative imports resolve inside the snapshot and no request can
pair a new template with an old layout.

`componentsDir` stays the truth — the template editor, `listComponents` and `components check`
all read it, and a snapshot is only ever an import target. Render errors are
mapped back through `Renderer.inSource`, so a stack trace names the file somebody
can open rather than the generation it was imported from.

Two things notice a change. A template saved in the backoffice is snapshot before
the save returns and announced as a `views` cache instruction carrying the hash it
produced; an announced change skips the coalescing floor, because the floor exists
to absorb a flapping sync and a deliberate save is not one. Everything else — a
deploy, a mounted bucket syncing, a file written in the container — is caught by
a periodic re-hash on the render path, behind a TTL and single-flight, with the
current snapshot serving while it runs.

Because the name is the content, an unchanged tree means no copy and no
re-import, and a reverted change returns to a generation already loaded. What
bounds it is the generation limit: every generation stays in the runtime's
registry until the process exits, so at the limit a node freezes — keeping the
views it has, refusing newer ones, and saying so in its log and on `/health`,
which stays `ok` so a stale template cannot drain the whole set. See the README's
"How a changed view reaches a running node" for the settings.


**The template editor writes TSX.** Umbraco's client hard-codes a Razor
scaffold for a new template and writes a Razor `Layout = "x.cshtml"` block when
a master template is chosen. Our backoffice plugin
(`backoffice-host/plugin/tsx-editors.js`, a `backofficeEntryPoint`)
patches the two methods that write Razor — the template repository's scaffold
and the workspace's master-template update — on Umbraco's own classes. It does
not re-register the extensions: changing the registry while the backoffice is
rendering makes open sections re-evaluate their extensions, and a route set up
in that window throws inside Umbraco's code. So a new template starts as a TSX view and a master becomes
`export const layout = '<alias>'`. The server still translates Razor it
receives from anything else. `GET /template/{id}` answers the master as both
`layoutTemplate`, which the client reads, and the contract's older
`masterTemplate`.

The editor's inserts are Razor too, built by functions Umbraco does not export,
so `tsx-snippets.js` translates their output as it enters a view's editor:
a value becomes `{model.text('alias', { fallback, default })}`, a dictionary item
`{dictionary('key')}`, and a query its selection mapped to a list of links. Each
builder has one fixed output shape, and `tests/tsx-snippets.test.ts` runs the
vendored builders through the translation, so a change upstream fails a test. The
two inserts with no TSX equivalent are hidden: a partial view, which needs an
import as well as a tag, and sections, which a TSX layout replaces with props.

### Emitting markup

Values escape by default: `renderChild` runs everything but `RawHtml` through
`escapeHtml`, so `{model.text('title')}` cannot inject. Markup reaches the page two
ways.

`model.html('alias')` returns `RawHtml` and is the short route — rich text hands a
template its markup, so this is what a body field wants. Rich text that links to
media is a promise of it, which JSX renders as it is: `<div>{model.html('body')}</div>`
needs no `await`. `text()` never waits, so a rich text's media links are `#`
there: write rich text with `html()`.

The **`setInnerHTML` attribute** covers markup from anywhere else, and takes React's
`{ __html }` shape with one addition:

```tsx
<div setInnerHTML={{ __html: markdownToHtml(model.text('notes')), dangerously: true }} />
```

Without `dangerously` the content is **escaped**. That is the deliberate difference
from React's `dangerouslySetInnerHTML`, which is always verbatim and whose only
guard is how alarming the name is — a guard that stops working the moment the
attribute is copied from one template to another. Here the decision lives in the
value, so forgetting it fails closed. The attribute never appears in the output, and
a void element has no content to set, so it is ignored there. Pinned by
`tests/documents.test.ts` "setInnerHTML emits markup verbatim only when told to".

React's `dangerouslySetInnerHTML={{ __html }}` is accepted too, and means what it
means in React: verbatim. It exists so markup pasted from a React codebase works;
`setInnerHTML` stays the one to reach for. Either refuses to be combined with
children, or with the other.

### Coming from React

[`writing-components.md`](writing-components.md) has a worked example of
each of these.

Templates are JSX, but they render once, on the server, to a string, through
Crombolo's own runtime rather than React. What a React author writes mostly works:

| Written as in React | Here |
| --- | --- |
| `className`, `htmlFor`, `httpEquiv`, `acceptCharset` | `class`, `for`, `http-equiv`, `accept-charset` |
| SVG `strokeWidth`, `fillRule`, `xlinkHref`, … | `stroke-width`, `fill-rule`, `xlink:href`, … |
| `tabIndex`, `readOnly`, `maxLength`, … | written as given: HTML attribute names ignore case |
| `style={{ marginTop: 4, zIndex: 2 }}` | `style="margin-top:4px;z-index:2"`: `px` where React adds it, custom properties as written |
| `aria-hidden={true}`, `data-open={false}` | `"true"` and `"false"`; `aria-*`, `data-*`, `draggable`, `spellCheck`, `contentEditable` |
| `disabled={true}`, `required={false}` | present, or absent |
| `key`, `ref` | dropped |
| `<input defaultValue defaultChecked>` | `value`, `checked` |
| `<textarea value>` | the escaped text inside it |
| `<select value>` (a list for `multiple`) | `selected` on the matching options, through an `<optgroup>` too |
| `dangerouslySetInnerHTML` | verbatim, as above |
| `<html>` at the top of a page | preceded by `<!DOCTYPE html>`, which JSX cannot write |

What fails, and why, rather than writing something wrong:

- **An event handler, or any function, as an attribute.** A page is static HTML
  and nothing can run the function. Interactive code is a separate script: render
  an element for it to mount on and load the script from `/scripts/`. A React
  element rendered in a template is refused for the same reason.
- **An attribute name that is not one**, so the keys of an object spread into an
  element cannot inject markup.
- **An object, function or symbol as a child**, or an object with no text of its
  own as an attribute. React refuses these too; printed, they would be
  `[object Object]`.
- **A `<select value>` none of whose visible options has.** Options are built
  before the select that holds them, so the select can mark only the ones written
  directly inside it (or inside an `<optgroup>`). One inside a fragment, or
  returned from a component, is already written by then: put `selected` on it.

Context and `useId` work, with one difference (see "Context" below). There are
no other hooks, no `Suspense` and no error boundaries, and React component
libraries do not run here, since they need React itself. Pinned by
`tests/jsx-attributes.test.tsx`.

#### Types

Each tag's attributes are type-checked, in `tsc`, `crombolo components check` and
the backoffice's view editor alike. They are React's (from `@types/react`, a
type-only dependency), adapted to this runtime in `jsx-attributes.ts`:

- the HTML spellings are accepted beside React's: `class`, `for`, and every
  attribute in lower case (`charset`, `tabindex`, `datetime`)
- `children` may be async; a `style` object is checked against every CSS
  property (`csstype`), and takes custom properties (`--gap`)
- any attribute may be `null`, which leaves it out, and is what `model.value()`
  returns for an empty property
- an event handler is a type error, as it is an error when rendered
- a hyphenated attribute (`data-*`, `aria-*`, `hx-get`) and any attribute on a
  custom element (`<my-widget>`) are not checked, as TypeScript never checks them

A JSX expression is typed as what it is, `RawHtml` or a promise of it, so calling
a string method on markup is caught rather than failing when the page renders.

An attribute the types do not know yet is declared once for the site:

```ts
// components/attributes.d.ts
declare module '@crombolo/crombolo' {
  interface ExtraAttributes {
    popover?: 'auto' | 'manual'
  }
}
```

or spread from an object, whose extra properties are not checked:
`<div {...{ popover: 'auto' }} />`.

A site that is upgrading and has views these types flag can switch them off with
`"jsxImportSource": "@crombolo/crombolo/loose"` in its `tsconfig.json`: any attribute on any
tag, and a JSX expression typed as text, as before. What renders is identical,
and the view editor follows the site's choice. Pinned by
`tests/editor-types.test.ts`.

### Context

Any component can read the page being rendered, without it being passed down:

```tsx
import { usePage } from '@crombolo/crombolo'
import type { HomePage } from '../schema/content-types'

function Breadcrumbs() {
  const { model, nav } = usePage<HomePage>()
  return (
    <nav>
      {nav.ancestors(model).map((page) => <a href={page.url}>{page.name}</a>)}
    </nav>
  )
}
```

`usePage()` returns what the template was given (`model`, `nav`, `culture`,
`dictionary`, `member`, `request`, `urls`, `seo`, `signal`), in layouts too. A
template's own values are handed down the same way:

```tsx
import { createContext, useContext } from '@crombolo/crombolo'

const Theme = createContext('light')

<Theme.Provider value="dark">
  {() => <Sidebar />}
</Theme.Provider>

// in Sidebar, however deep:
const theme = useContext(Theme)
```

**The provider takes its children as a function.** React builds a description
of the tree and renders it afterwards, so a provider runs before what is inside
it. This runtime renders as it goes, and JavaScript evaluates arguments first:
written plainly, `<Sidebar />` would render before the provider had set its
value. The function holds it back until then. Plain children are a type error,
and throw when rendered rather than silently reading the default. React 19's
`<Theme value="dark">` works too, under the same rule.

`useId()` gives an id unique within the render (`:b0:`, `:b1:`, …), for tying a
`<label>` to its input or `aria-describedby` to its text.

These are not hooks in React's sense: they can be called anywhere while a page
renders, conditionally or after an `await`. The values live in storage scoped to
the render (`AsyncLocalStorage`), which follows every call and `await` within it,
so two requests rendering at once each see their own page. Outside a render (at
the top of a module, or later in a timer) `usePage()` and `useId()` throw;
`useContext()` returns the default. A layout cannot provide a context to the
page inside it, because the page has already rendered by the time its layout
runs. Pinned by `tests/context.test.tsx`.

### Async components

A template, a layout or any component it renders may be `async`, so a page can
fetch what it shows:

```tsx
async function Weather({ city, signal }: { city: string; signal: AbortSignal }) {
  const forecast = await fetch(`https://api.example/weather/${city}`, { signal })
  return <p>{(await forecast.json()).summary}</p>
}

export default async function Home({ model, signal }: PageProps) {
  return (
    <main>
      <h1>{model.text('title')}</h1>
      <Weather city="Perth" signal={signal} />
    </main>
  )
}
```

The runtime still renders straight to a string and stays synchronous until it
meets a promise; from there `jsx()` hands back a promise of the markup, and the
renderer awaits the page and then each layout. A tree with nothing async renders
exactly as it did before. Text from an async component is escaped like any other.

- **Siblings run together.** JSX evaluates its children before the element that
  holds them, so two async components side by side both start before either is
  awaited. Awaits *inside* one component still run in turn — fetch two things with
  `Promise.all`.
- **Children and `setInnerHTML.__html` may be promises; attributes may not.** A
  promised attribute throws, naming the attribute and the tag, rather than printing
  `[object Promise]`.
- **Every render has a deadline**, `renderTimeoutMs` (10 seconds by default; 0 for
  none), covering the page and its layouts. Past it the render fails like any
  template error — logged, naming the template it was in, a 500 to the visitor.
- **`signal` aborts** when the deadline passes or the visitor disconnects. Pass it
  to whatever a component waits on. A visitor who left is not logged as a
  template error.
- **The built-in components stay synchronous.** `<Form>` and `<SeoHead>` return
  markup, not a promise, so a custom form-field component must be synchronous too;
  an async one is refused with an error saying so.

Pinned by `tests/async-rendering.test.ts`. [`adding-a-page.md`](adding-a-page.md)
walks through a whole page built this way.

## The model a template sees

Umbraco's `IPublishedContent` is deliberately tiny, and notably has **no `Parent`
or `Children`** — tree navigation moved out to separate services. We keep that
split; it is what makes the published cache cheap.

```ts
interface PublishedElement {
  key: string; id: number; name: string; contentType: { alias: string }
  sortOrder: number; createDate: Date; updateDate: Date
  creatorId: number; writerId: number
  cultures: Record<string, PublishedCultureInfo>
  properties: PublishedProperty[]
  getProperty(alias: string): PublishedProperty | undefined
  isDraft(culture?: string): boolean
  isPublished(culture?: string): boolean
}
interface PublishedContent extends PublishedElement {
  urlSegment?: string; templateId?: number; level: number; path: string
}
```

Navigation and URLs are injected services, not properties:
`nav.parent(content)`, `nav.children(content)`, `nav.ancestors(content)`,
`nav.descendants(content)` — each filtering by published status and culture — and
`urls.get(content, { mode, culture })`.

Beside the model, a template receives the **signed-in member**, or `undefined` for
an anonymous visitor. `roles` are member group *names*, which is the currency
public-access rules deal in, so a template can ask the same question a rule does:

```tsx
export default function Page({ model, member }: PageProps) {
  if (!member) return <SignInForm returnUrl={model.url} />
  return member.roles.includes('Subscribers') ? <Full model={model} /> : <Teaser model={model} />
}
```

A page whose scripts call a server bundle's member routes puts
`<AntiforgeryMeta />` in its layout's `<head>`: it writes the signed-in
member's anti-forgery token, which `/crombolo/bundle.js` sends with their
writes, and nothing for a visitor (`docs/bundles.md`, "Routes for members and
visitors").

### `value()` — the ergonomic core

`@Model.Value("alias")` is the single most-used API in an Umbraco view, and its
behaviour is more subtle than it looks:

```ts
model.value(alias, { culture?, segment?, fallback?, default? })
```

1. get the property; if it has a value for `(culture, segment)`, return it
2. otherwise run the fallback strategy
3. otherwise return the property's raw value anyway

Fallback strategies, from `Fallback.cs`: `None`, `DefaultValue`, `Language`
(follow `language.fallback_language_id` up the chain), `Ancestors`.

**Culture is ambient.** `model.value('title')` with no culture argument returns
the *current request's* culture value, resolved from a per-request variation
context. Reproducing this is what makes variant templates readable; without it
every call site has to thread a culture through.

### Typed pages

`crombolo generate` writes `schema/content-types.d.ts`, an interface per document
type with every property it carries, compositions included, the built-in
`seoFields` among them. Naming one in `PageProps` types the page:

```tsx
import type { PageProps } from '@crombolo/crombolo'
import type { HomePage } from '../schema/content-types'

export default function Home({ model }: PageProps<HomePage>) {
  const title = model.value('title')   // string, because the type makes it mandatory
  return <h1>{model.text('titel')}</h1> // a compile error: HomePage has no 'titel'
}
```

`value()` returns the property's type, and `value()`, `text()`, `html()`,
`media()`, `hasValue()` and `getProperty()` accept only the type's aliases. A
property that is not mandatory is typed as possibly undefined, though a missing
value reads as `null` at run time, so test it for being empty rather than for
`undefined`.

Without a type argument, `PageProps` and `PublishedContent` take any alias and
`value()` returns `unknown`, as before. A typed page still fits anywhere a page is
accepted, such as `nav.children(model)`, `<SeoHead {...props} />` or a component's
own `page: PublishedContent` prop. The import is type-only and erased when the
component is compiled, so reaching outside `components/` for it is allowed. Run
`generate` again after changing a type; the interfaces are not updated on their
own.

### Value conversion

Umbraco converts in three memoised stages (source → intermediate → object),
with cache levels per converter. Here a value is converted when a template
reads it (`convertValue`, by editor alias, with the data type's
configuration), against the published snapshot and the media cache; see
*Property values* below for what each editor yields. Memoising per request,
which Umbraco does for block elements, is left until profiling asks for it.

**Read asynchronously, where media can be named** (story 197). Media is not in
the page snapshot, so the four editors that can name it look it up as they are
read, and their values are promises:

| Accessor | Returns | In a view |
| --- | --- | --- |
| `model.media(alias)` | `Promise<MediaWithCrops[]>` | `const [hero] = await model.media('hero')` |
| `model.value(alias)` for a Media Picker | `Promise<MediaWithCrops \| MediaWithCrops[] \| null>` | `const hero = await model.value('hero')` |
| `model.value(alias)` for a Multinode Treepicker | `Promise<Array<PublishedContent \| PublishedMedia>>` | `const related = await model.value('related')` |
| `model.value(alias)` for a Multi URL Picker | `Promise<Link[]>` | `const links = await model.value('links')` |
| `model.html(alias)` | `RawHtml`, or `Promise<RawHtml>` when it links to media | `{model.html('body')}`, unchanged |
| `model.value(alias)` for rich text | the markup, or a promise of it when it links to media | prefer `html()` |

Elements have the same: a block's `content.media('image')`, read in the block's
own async component. Every other editor is read synchronously as before, and
`text()` never waits. A component that awaits is `async`, which JSX renders as
any other (see *Async components*). Lookups made in the same tick go to the
database as one query, so a page's pickers read together cost one.

## Request pipeline

Mirrors `PublishedRouter` → `UmbracoRouteValuesFactory`. A site's middleware
runs around these steps, in the stages "Middleware" below describes: the
`request` stage before step 1, the `route` stage after step 2, and the `page`
stage after step 5.

1. **Resolve the domain** for the request URI → sets the request's domain and culture
2. **Run content finders in order** until one sets content:
   by page-id query → by URL → by key/id path → by URL alias → by redirect →
   last chance: the configured 404. A page with `umbracoRedirect` answers 302 to
   the page it picks instead of rendering ([`seo.md`](seo.md))
3. **Pick the template** the content names: `components/<alias>.tsx`, or
   `components/<alias>/page.tsx` for a folder template
4. **No template ⇒ 404**, re-run through the last-chance finders
5. **Enforce public access** (`public_access` + `public_access_rule`) before rendering
6. **Render**, the page's own code included: it can read the request, load data
   as the visitor and end the page with a redirect or a refusal. What Umbraco does
   with a controller named for a content type, a template does in itself, the
   Next.js way. See "Server code" below.

Step 5, in detail, because it is the one that surprises people: a protected page
is **rewritten**, not redirected. The visitor keeps the URL they asked for and the
login or error page renders at it, with a 200 — which is what Umbraco's
`PublicAccessRequestHandler` does. The nearest protected ancestor governs,
resolved against `node.path` rather than by walking parents. A login or error page
that sits inside the branch it serves renders as itself, or the substitution would
never terminate; beyond that the renderer caps substitutions at 8, as Umbraco
does, and a rule pointing at a page that no longer exists is a 404 rather than an
open door.

The decision itself is the server's, not the renderer's: `Renderer.render` takes
an optional `access(content)` hook and a `member`, so the policy lives where the
database is and the renderer keeps knowing only about templates and layouts.
Preview is exempt — only a signed-in editor reaches it.

URL aliases (`umbracoUrlAlias`) are claimed in the published cache after every
real route, so an alias can never take an address a page answers on. The
configured 404 is the not-found page chosen in Search & sharing, rendered with
status 404 once the redirect lookup below has also found nothing.

### Redirects, at step 2's end

Umbraco's redirect lookup is a *content finder*, which is to say it runs only
after every other finder has failed. Ours sits in the same place — the 404 branch
of `renderSite` asks `PublishedCache.redirect(host, pathname)` — with the same
consequence: a redirect can never shadow a page that exists. The rules live in the
cache's snapshot, so a publish, a cache instruction from another node, or a
redirect being written drops them together with everything else derived from the
published tree.

Matching order within a request is configured rules, in the order the site
declares them, then the rules an administrator wrote in the backoffice
(`@crombolo/simple-redirects`, [`bundles.md`](bundles.md)), then tracked
rules, newest first. A rule scoped to a hostname is
tried only against a request that hostname roots, and its pattern is the route
*below* the rooting document, keyed by that document's key rather than by the
hostname's name — so renaming `example.com` to `example.co.uk` leaves every
redirect below it working. Umbraco keys the same thing by the domain root's node
id, for the same reason.

A rule naming a document resolves through the cache at request time. That gives
two behaviours worth stating: two successive renames leave the oldest URL pointing
at wherever the page is *now* rather than chaining 301s, and a rule whose document
has been unpublished or deleted simply does not match, so the visitor gets the 404
instead of being sent somewhere that is no longer there.

The 301 carries the request's query string and is sent with `no-store,
must-revalidate`. Umbraco does both, the second deliberately: browsers cache 301s
hard enough that renaming a page and renaming it back would otherwise leave
anyone who saw the first answer stuck on the redirect.

**The tracker** captures the routes a branch answers on before a publish or a
move, compares them after, and records a 301 for each one that changed. It has to
be a before-and-after pair because a route is derived from names and tree position
and cannot be reconstructed afterwards — which is exactly why Umbraco uses a
notification pair (`ContentPublishing`/`ContentPublished`,
`ContentMoving`/`ContentMoved`) rather than a single hook. Recycle-bin moves are
excluded, as upstream. See `packages/server/src/redirects.ts`.

**A rule has one of three sources**, and the column is what orders them:
`config` for one the site declares in code, `manual` for one an administrator
added through the redirects bundle, `tracked` for one the tracker recorded. Only
`manual` is editable in the backoffice — the file owns a configured rule and the
tracker owns a tracked one, and the API says so rather than letting a change be
undone at the next boot or publish.

Sorting is tracked too, which Umbraco does not do. It normally changes no URL — a
segment comes from the name — but `HideTopLevelNodeFromPath` makes the *first* root
page `/` and the others `/<segment>`, so re-ordering the roots moves them. The
capture is by parent rather than by node there, because the write is on the parent
and the URLs that move belong to its children.

## Server code

A template is close to a React server component already: an async function that
renders on the server and awaits what it needs. Story 206 lets it do what a
Next.js App Router page does, with the same names (a table mapping each
convention is in [`writing-components.md`](writing-components.md), "Coming from
Next.js").

```tsx
// components/pages/my-records.tsx
import { notFound, redirect } from '@crombolo/crombolo/navigation'
import { site } from '@crombolo/crombolo/server'

export default async function MyRecords({ member, searchParams }: PageProps<MyRecordsPage>) {
  if (!member) redirect('/sign-in')
  const { folder } = await searchParams
  if (typeof folder !== 'string') notFound('Choose a folder')
  const photos = (await site().media.children(folder)).unwrap()
  return <PhotoList photos={photos} />
}
```

### Ending a page early

`@crombolo/crombolo/navigation` mirrors `next/navigation`. Each function throws
from any component, layout or block, and the page answers its status:

| Function | Status | |
|---|---|---|
| `redirect(url)` | 307 | as in Next.js |
| `permanentRedirect(url)` | 308 | as in Next.js |
| `notFound(message?)` | 404 | as in Next.js |
| `forbidden(message?)` | 403 | as in Next.js |
| `unauthorized(message?)` | 401 | as in Next.js |
| `foundAt(url)` | 302 | the everyday redirect `umbracoRedirect` answers |
| `movedPermanentlyTo(url)` | 301 | |
| `seeOther(url)` | 303 | after a POST |
| `badRequest(message?, errors?)` | 400 | a request the page cannot use |
| `gone(message?)` | 410 | |
| `unprocessableContent(errors, message?)` | 422 | input that failed validation |

Throwing is safe here, unlike in Next.js's streamed responses: Crombolo renders
the whole page before it answers, so nothing has been sent when an outcome is
thrown. An outcome thrown after the render's time limit is ignored. Errors are
`{ field, message }[]`. A message is visitor-facing text for the status page.
Code that catches errors for its own reasons calls `rethrow(error)` first, as
Next.js's `unstable_rethrow`, so outcomes pass through.

A redirect target must be a path or an `http(s)` address. A protocol-relative
address (`//host`), any other scheme (`javascript:`) or a value with control
characters is refused as a template error, a 500, never sent as a `Location`.

### The request

- `await searchParams`, a page prop, is the query as Next.js 15 hands it: a
  name given twice is an array.
- `await cookies()` and `await headers()` from `@crombolo/crombolo/headers`
  are read-only. Outside a page render they throw, naming themselves.
- There are no `params`: a page's address comes from the content tree, and its
  content is `model`.

### `site()` and `Result`

`site()` from `@crombolo/crombolo/server` is the site's services acting as
whoever is asking. Each returns a `Result<T>`, either `Ok<T>` or an `Outcome`
tagged by status. Data code composes with `map`, `andThen` (and `mapAsync`,
`andThenAsync`), `match` (exhaustive over the statuses it can hold, or with an
`outcome` catch-all) and `Result.all`, and builds failures with
`Outcome.notFound()`, `Outcome.forbidden()` and the rest. These are values:
only the navigation functions and `unwrap()` throw. A component ends the chain
with `unwrap()` (the value, or the outcome thrown) or `unwrapOr(fallback)`.

- `site().media.get(key)` and `site().media.children(folderKey)` answer only
  what the visitor may read ("Protected media", below). Anything else is
  `notFound`, never `forbidden`, so code cannot learn a protected file exists.
- `site().sql` (story 189) and `site().members` (story 207) are slots. Until
  they are filled each call answers `notFound`, saying so.
- In preview the visitor is the previewing editor, with no member. Templates
  are trusted code; the scoping keeps one member's page from reaching another
  member's data by mistake, not a sandbox.

### Status pages

`pages` in `crombolo.config.ts` names a page in the content tree, by path, for
each status a visitor can be shown:

```ts
export default defineConfig({
  pages: {
    notFound: '/not-found',          // 404, and any address nothing answers
    unauthorized: '/sign-in',        // 401
    error: '/something-went-wrong',  // 400, 403, 410, 422 and 500
  },
})
```

- A path resolves as a request for it would, on the request's hostname, and
  renders in the request's culture. A rule list, `[{ path, host?, culture? }]`,
  picks one per hostname or language, the most specific match winning.
- The page renders in its own template, with the outcome's status, at the
  address the visitor asked for. It is not a redirect. Its template reads
  `usePage().outcome`: `status`, `name`, `message`, `errors`, and for a 500 a
  `reference` and, when allowed, `details` (message, `location`, `stack`).
- `pages.notFound` wins over Search & sharing's not-found page
  (`seo.notFoundPage`, a page key), which still answers when `pages.notFound`
  is unset.
- A path that resolves to nothing, or a status page that fails or itself
  throws an outcome, falls back to a generic page for the status, once. The
  boot logs a warning for each configured path no page answers. An address
  nothing answers, on a site with no not-found page at all, keeps the plain
  `Not Found`.
- A server error logs a reference with its stack, and the page shows the same
  reference. `CROMBOLO_SHOW_ERROR_DETAILS` (`errors.showDetails`), on in
  development and off otherwise, also shows the message, the template's file
  and line, and the stack.

### Caching, inferred

A page that reads nothing about the request is cached exactly as before
(["Behind a CDN"](operations.md)). One that awaits `searchParams`, calls
`cookies()` or `headers()`, or reads media from `site()` that is closed to
strangers, is sent `private, no-store`, as reading request-time values makes a
Next.js route dynamic. A page rendered for a signed-in member always is.

Handing `searchParams` on, as spreading a page's props does, reads nothing;
only awaiting it does. Reading `member` on a signed-out request does not make
the page personal, for the same reason: spreading props reads every one.

A template's route segment config overrides the inference:

- `export const dynamic = 'force-dynamic'`: always personal;
- `export const dynamic = 'force-static'`: `cookies()`, `headers()` and
  `searchParams` are empty and `member` is undefined, so the page can always
  be shared, even with a member signed in;
- `export const revalidate = <seconds> | false`: the page's lifetime,
  overriding its content type's and the site's, while a page's own "Keep
  copies for" still wins. `0` keeps nothing; `false` keeps it a year, for a
  CDN that purges by tag.

### Metadata

An optional `export async function generateMetadata(props)` returns the part
of Next.js's `Metadata` that `<SeoHead>` writes: `title`, `description`,
`alternates.canonical`, `alternates.languages`, `robots` and
`openGraph.images`. Each value given wins over the page's own search and
sharing fields. It runs before the page, in its render, so it may await
`searchParams` or call `site()`, and may throw an outcome.

### Folder templates

A template may be a folder, as a Next.js route is: the alias `pages/my-records`
resolves to `pages/my-records.tsx` or `pages/my-records/page.tsx`, the file
winning if both exist, so a page's own parts can sit beside it.
`crombolo components new --folder` makes one. In `blocks/` and `emails/`,
where each file is one component, `page.tsx` is a component named `page`.
Next.js's `not-found.tsx` and `error.tsx` beside a page are not supported; the
status pages and the message an outcome carries cover them.

## URLs

Segment generation: the `umbracoUrlName` property if set, else the published name,
run through a URL-segment helper (diacritic folding, lowercase, `-` separators,
culture-aware). Pluggable, as upstream.

Resolution walks the tree segment by segment, **checking that each ancestor is
published in the requested culture** — an unpublished ancestor breaks the route.
URLs follow Umbraco's default `HideTopLevelNodeFromPath = true`: the first root
page (by sort order) is `/`, any other root page is `/<segment>`, and no root's
segment appears in the URLs below it, so Home's child is `/about-us`, not
`/home/about-us`. Where two pages claim one URL, the shallower and then the
first-sorted wins, as Umbraco resolves it.

**Showing the top level** (`HideTopLevelNodeFromPath = false`) is
`hide-top-level = false` under `[urls]` in `schema/schema.toml`, or the
**Page addresses** dashboard in Settings, which writes that file — read-only
where the schema files are. Every path then starts with its top-level page's
segment, the first one's included (`/home/about-us`); `/` still answers with
the first top-level page. The setting is synced into the database
(`key_value`, `crombolo:urls`) like the rest of the schema, and is hashed only
when it is not the default, so sites that predate it kept their hash.

**Right-to-left cultures** keep the page's own segment first, as Umbraco does:
it gathers a path from the page upward and reverses it into root-first order
only for a left-to-right culture. Whether a culture is right to left comes from
`Intl.Locale`'s text direction (`isRightToLeft`), as .NET's
`TextInfo.IsRightToLeft` decides it.

**Changing the setting moves every URL**, so it is tracked as a rename is.
Whichever applies the change — a sync from the files, at boot, from the
watcher or the schema import, or a save in Settings — builds a second view of
the published cache with the old setting, captures every route from it, and
hands them to the redirect tracker against the routes the site has now. Each
page that moved answers its old URL with a 301. Story `110`.

## Property values

Structured editors hand the client an object, not text. Their values are stored
as JSON text and parsed on the way back out, by editor alias
(`JSON_VALUE_EDITORS` in `@crombolo/core`), as Umbraco's value editors do.
Rich text is always `{ markup, blocks }` for the editor, including a legacy plain
HTML string, and just its markup for a template, so `model.html('bodyText')`
renders it. An upload is stored as its path and edited as `{ src }`; true/false
reads back as a boolean; a date is the wall-clock time the picker sent. An element
picker stores a bare `Guid[]` — keys, not the `umb://…` udis a content picker
stores — which is why `Umbraco.ElementPicker` is in `JSON_VALUE_EDITORS`.

What a template receives is converted on read, through a context the published
cache supplies (`@crombolo/render` `values.ts` and `media.ts`):

| Editor                  | `model.value()`                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Content Picker          | the published page, or null                                                                                 |
| Multinode Treepicker    | a promise of the published pages and media items, in order                                                  |
| Element Picker          | `PublishedElement[]`, always a list, dropping any not published in the page's culture                       |
| Multi URL Picker        | a promise of `Link[]`, with page and media URLs resolved                                                    |
| Block List / Block Grid | items with `content` and `settings` as `PublishedElement`s (same `value()`, and `contentType.alias` names the element type); grid items add spans, `areaGridColumns` and areas (with their alias and spans), and the list carries `gridColumns`. `<Blocks>` renders them (see "Blocks") |
| Media Picker            | a promise of `MediaWithCrops`, one or a list as the data type says; `await model.media(alias)` always lists |
| Image Cropper           | `ImageCropperValue` (`src`, `crops`, `focalPoint`, `cropUrl()`)                                             |
| Rich text               | the markup, with `/{localLink:…}` links resolved (`#` when gone); a promise when a link names media          |

References to anything unpublished or deleted are dropped. `crombolo
generate` types all of these, down to a block editor's element types.

Umbraco denormalises segments into `document_url` / `document_url_alias` for
throughput. We defer both and walk the tree; the tables are a pure optimisation
with a rebuild signature, and can be added when profiling asks.

Outbound URL generation goes through a provider chain with modes
`Default | Relative | Absolute | Auto`, and cultures that are not published
resolve to an explicit "unroutable" marker rather than a broken link.

### Domains

Culture and hostnames live in `domain` (migration 010): hostnames, with an
optional path prefix, that root the site at a document in a culture, plus an
optional wildcard (`*<node id>`) that only sets the culture of a branch. A
request takes the longest hostname and prefix that match its host; the rest of
its path routes below that document, which is `/` there. A page under a
hostname reports a protocol-relative URL (`//example.com/about`). A host with
no domain routes as above. The request's culture reaches the view as
`culture`.

#### Where they come from: `domains.toml`

A hostname is the one piece of site metadata that differs in every environment,
so it is neither content nor schema. A site may keep `domains.toml` beside
`crombolo.config.ts`:

```toml
[[domain]]
node = "/"
host = "${SITE_HOST}"

[[domain]]
node = "/Home/French"
host = "fr.harbourstone.example"
culture = "fr-FR"
```

`node` is a content path, a node uuid, or `/` for the site's root page — refused
rather than guessed at when more than one page sits at the root. `${VAR}` is
read from the environment when the file is applied, which is how one committed
file serves development, staging and production; a variable that is not set
there leaves that hostname unbound and says so, rather than binding a
half-built name that answers for nobody. A culture may be left out, and the
hostname then serves the site's default one.

**The file is the truth.** Boot converges the `domain` table onto it, so
deleting an entry unbinds that hostname — the same bargain
`syncConfiguredRedirects` makes for rules declared in the config. Each entry
states a page's *whole* assignment, so two entries naming the same page in
different words (`/` and `/Home`) are refused rather than silently replacing
one another. A site with no `domains.toml` is left alone entirely: nothing to
converge onto means the backoffice stays the only way, as it was before.

Applying the file — at boot, after a push, or from `crombolo domains` in another
process — posts a cache instruction when the bindings changed, signed by nobody,
so every running node rebuilds its routing, the one it ran in included. Applying
the same file again changes nothing and says nothing.

`crombolo domains` prints what the file declares, what each `${VAR}` comes to
here, and what is actually bound. `domains set` and `domains clear` write the
file *and* apply it, keeping the file they replaced so `domains undo` puts it
back — a wrong hostname takes a site off the air, since a root page with one
answers on nothing else. `domains apply` is what a deploy step runs; it is what
boot does.

A save in the backoffice's own dialog writes the file too, so the next boot does
not undo it, and says so in the notification it returns. Only that page's
entries are rewritten: regenerating the file from the database would resolve
every `${VAR}` in it into whatever this machine happens to have, baking one
environment's hostnames into a file meant for all of them.

### Cultures

A page that varies by culture routes and renders per culture. A hostname
serves its own culture: `da.example.com` → the Danish view, where a page's
name, URL segment (its culture's `umbracoUrlName`, else its culture's name)
and URL are Danish, and a page not published in Danish does not exist. Without
a hostname, routes are the default language's; a varying page's URL in another
culture with no hostname for it is `#`, Umbraco's unroutable marker. Invariant
pages appear in every culture. `GetDocumentUrls` lists one URL per published
culture.

`fallback: 'language'` walks the culture's `fallbackIsoCode` chain, stopping at
a cycle. The dictionary follows the same chain: templates receive
`dictionary(key)`, the item's translation in the page's culture, then its
fallbacks, else `''` (Umbraco's `GetDictionaryValue`).

## The published cache

Published only — drafts are never cached. The writing node invalidates its own
cache after the change commits. Every other node learns of the change through
the content checkpoint (story 174, below).

**Two caches** (story 197). The page snapshot holds pages, elements, domains,
the dictionary and redirects, and is rebuilt whole when any of them changes.
Media is held apart, in the media cache below, item by item: a library of
millions of files is never loaded, and an upload never rebuilds the pages.

| A change to | The page snapshot | The media cache |
| --- | --- | --- |
| a page, an element, a domain, the dictionary, a redirect, URL settings | rebuilt | kept |
| a media item: saved, created, moved, sorted, trashed, restored, deleted | kept | drops the item, and everything below a moved one |
| an item's own access settings | kept | drops the item |
| the schema, a bundle or site import, a revert, `crombolo cache rebuild` | rebuilt | emptied |
| anything a server missed (a gap, or more than 5,000 changes behind) | rebuilt if pages changed | emptied |

### The media cache

`MediaCache` (`packages/render/src/media-cache.ts`) answers `byKey`, `byKeys`
and `byUrl`, all asynchronous, from a least-recently-used map of
`PublishedMedia` held within a memory budget.

- **Filled by indexed queries.** A miss reads the item by its node key, or by
  the `/media/…` address `content.file_url` indexes (story 196), with its
  current values and its own access settings: `createMediaSource` over
  `DocumentRepository.loadCurrent({ keys })` or `({ urls })`. Nothing reads the
  library whole.
- **Shared lookups.** Lookups made in the same tick are sent as one query, and
  one already in flight for a key is shared rather than repeated. A miss is not
  remembered, so a new item is found at once.
- **Within a budget.** Each item's size is estimated from the JSON of its
  values, its name and path; once the total passes the budget the least
  recently used are evicted. `CROMBOLO_MEDIA_CACHE_MB` sets it, 64 by default
  (`mediaCacheMegabytes`): a plain image estimates at under a kilobyte, an
  image with crops and several values at a few, so some tens of thousands. An
  item larger than the whole budget is answered and not held.
- **Per item.** A media operation's cache instruction is `{ media: [keys],
  moved?: [paths] }`: the items it touched, and the old paths of any that moved,
  so their descendants, whose paths changed with them, are dropped too
  (`dropUnder`). A load in flight when its item is dropped answers its caller
  and is not kept.
- **Every server, its own changes included.** Each poll reads every instruction
  numbered after the checkpoint it followed last, in checkpoint order
  (`instructionsBetween`, indexed on `cache_instruction.checkpoint`), and applies
  what each says (`instructionEffects`). Checkpoints count up by one, so a
  number with no instruction means one was pruned before this server read it:
  the server cannot know what it missed, so it empties the media cache
  (`clear()`) and refills it as items are asked for. So it does when more than
  5,000 changes behind (`MEDIA_REPLAY_LIMIT`), or when the count was reset.
- **The page snapshot stays.** A change that touched only media leaves the
  pages alone, so the poller tells the page cache its snapshot also holds that
  checkpoint (`PublishedCache.covered`) rather than rebuilding it. Only a
  page change after its own checkpoint rebuilds it.

The published and draft caches share one media cache: media has no drafts.
Rendering reads it through the value context (`media: (key) =>
media.byKey(key)`), `/media/…` through `byKey` of the item `file_url` names,
the Delivery API through `byKeys` once the database has paged the keys, and
search and sharing (`<SeoHead>`, `seo=true`, the default share image) through
`byKey`. Menus are read whole before a page renders, their media in one
`byKeys`, so `menu('main')` stays synchronous.

### Freshness: the content checkpoint

**What it is.** `content_checkpoint` counts the committed changes to anything
the published cache reads:

- pages, media and elements;
- domains and the dictionary;
- redirects and languages;
- URL settings and schema sync;
- imports and reverts.

**How it moves.** Every such change increments it inside its own transaction
(`appendCacheInstruction`). The row stays locked until that transaction
commits, so on both dialects the checkpoint's order is the commit order: no
change can commit later with a smaller number. A change that rolls back moves
nothing. A views change is code, not content, and moves nothing either.

Tracked redirects are the one exception, because they are computed from the
published cache once the publish has committed. They move the checkpoint just
after the change, never before it.

**One consistent read per build.** Each build reads every source inside one
read snapshot (`Db.readSnapshot`). It reads the checkpoint first, so the
snapshot holds exactly the changes numbered up to it.
- On Postgres this is a `REPEATABLE READ, READ ONLY` transaction.
- On a SQLite file it is a read-only connection of its own. WAL gives it a
  snapshot as of its first read, it never blocks a writer, and it never sees
  another request's uncommitted rows.
- In memory (tests) it is a transaction on the one connection.

**Labels.** `CacheSnapshot.checkpoint` and `builtAt` label the result. A
snapshot may be older than the latest committed change, but never newer than
its data. A build of an older checkpoint never replaces a newer one, whichever
finishes last.

**Catching up.** Each poll compares the latest committed checkpoint with the
one served. A node behind it rebuilds at once rather than on its next read, so
an idle node catches up too. Instructions only wake the poll. A lost, pruned or
late instruction therefore cannot leave a node permanently stale: the
checkpoint still says it is behind. A rebuild that does not take is asked for
again after 30 seconds.

**Failure.** A build that fails leaves the previous snapshot serving, labelled
with its own, older checkpoint. The node keeps reporting that it is behind, and
the Servers health check warns after a minute.

**Not schema revisions.** The checkpoint orders content changes. A schema
revision (`schema_state`) says which definitions a node deploys, and which
values it may read. A node behind on schema is read-only; a node behind on the
checkpoint is serving older content.

Umbraco runs three tiers: an in-process converted-object cache, a hybrid
memory/distributed cache of serialised nodes, and the `content_cache` table.
**We implement tier 1 only** and read through the canonical join in
`data-model.md`. A single Bun process does not need the rest, and the table is
rebuildable at any time.

The cache holds one view per language — a model for each page in each culture
it is published in — so the ambient culture, pickers, links and `nav` all
resolve within the culture of the page asking. Each culture's values are read
as of the publish that culture went live with (see `data-model.md`), so a
culture published later never exposes another culture's newer draft.

### Published elements

Elements (the Library section, story `027`) are publishable content with no URL, so
nothing routes to one: a template reaches an element only because a property points
at it. A published element **is** readable by a template, held in this cache, so
publishing an element means something a visitor can see and unpublishing one drops
it from the pages that picked it. What follows is Umbraco's own design, read from
its source rather than invented.

**The editor is a first-class one, not a repurposed picker.** `Umbraco.ElementPicker`
(UI `Umb.PropertyEditorUi.ElementPicker`), with its own tree picker data source and
its own configuration — `ignoreUserStartNodes`, a min/max `ValidationLimit`,
`AllowedContentTypeIds`, a start node, and a folder-only mode. Umbraco seeds **no**
built-in data type for it: the schema ships and a site makes its own data type, so
`DEFAULT_DATA_TYPES` needs no new entry.

**The stored value is a plain JSON array of keys** — `Guid[]`, not
`umb://element/…` udis. Simpler than the content picker, where `values.ts` has to
match both spellings.

**Resolution is by key against a cache of its own.** Umbraco reads
`IPublishedElementCache.GetById(preview, key)` at `PropertyCacheLevel.Elements`,
separate from the content cache, and the converter's value type is
`IEnumerable<IPublishedElement>` — always a collection, even where the configuration
allows one pick. Culture filtering happens **on read, not on store**: an element not
published in the ambient culture is dropped from the array, which is what the content
and media pickers here already do for unpublished targets.

**How it is built here.** Culture filtering falls out of the structure rather than
needing a filter: elements live in the **culture views**, not in a single global map
like media, so `elements` on a view holds only what that culture can see. An
invariant element is in every view; a varying one only in the cultures it is
published in. The context a culture builds resolves `element(key)` against its own
view, so a picker inside an element resolves in the same culture as the page that
asked.

- `loadElements()` on `PublishedContentSource` feeds it. It reuses the same query
  that builds the content cache: `DocumentRepository.loadPublished()` is keyed on
  the repository's own object type, so `kind: 'element'` returns published elements
  with no second query to maintain.
- `values.ts` converts `Umbraco.ElementPicker` by resolving each key through the
  context and dropping the misses — an element unpublished, trashed or deleted
  simply is not in the view, so no gap is left in the array.
- Invalidation was already there: the element port appends a
  `{ elements: true }` cache instruction on every write, which drops the snapshot on
  this node and on every other one through the poll.
- `crombolo generate` narrows a picked element to its type. `allowedContentTypes` is
  a comma-separated list of element type keys, as Umbraco's
  `AllowedContentTypeKeysParser` reads it, so a picker allowing one type generates
  `Array<TypedElement<Quote>>` and one allowing two generates
  `Array<TypedElement<Quote> | TypedElement<Aside>>`. `Array<…>` rather than `…[]`
  deliberately: a union written as `A | B[]` binds as `A | (B[])`.

A picker always yields a collection, as Umbraco's converter does, even where its
configuration allows one pick — so a template writes `model.value('hero')[0]` for a
single. Pinned by `tests/elements.test.ts` "published elements in a template" and
"`crombolo generate` for the element picker".

Cache entries must be tagged by content type (`ct:{id}`) so a content-type change
can evict selectively. Content-type changes split into *rebuild* (alias or
variation changed — stored values are now invalid) versus *evict only* (name,
icon, description, added property).

## Preview

Asking for a document's preview URL sets the `UMB_PREVIEW` cookie and returns
Umbraco's `preview?id=…`, the backoffice's own preview app, which frames
`/<document key>`. With the cookie and a signed-in editor (the backoffice's
access-token cookie), the front end renders the draft, for routed URLs too;
without an editor the cookie changes nothing. The editor must be able to read
that document: the Content section, a start node above it, and Read on it
(`canReadDocument`). Otherwise the draft isn't there and the published page, or a
404, renders. The search-snippet preview applies the same check. Saving a document tells an open
preview to reload over `/umbraco/PreviewHub` (`refreshed`).
`DELETE /umbraco/management/api/v1/preview` ends it.

A page whose code redirects shows the editor a notice naming the status and
the target instead, so the preview frame stays where it is (story 206).

A preview, like a member's page, is sent `private, no-store`, so nothing in
front of the site keeps it ([`operations.md`](operations.md), "Behind a CDN").

A headless site previews in its app instead: with an app preview address set,
the Preview button opens the app with a preview token, and the Delivery API
answers it from drafts ([`delivery-api.md`](delivery-api.md), "Preview").

## Menus

Editors build a site's menus in the Library: a **Menu** is an element made there,
with an **Alias**, which templates name it by, and its **Items**, dragged into
order. Each **Menu item** is a link to a page, a media item or an address, an
optional **Label**, and **Items below**, which nest as deep as the design wants. An
item with no link is a heading for the items below it. Story `141`;
`packages/render/src/menus.ts`.

```tsx
export function SiteHeader(props: PageProps) {
  return (
    <nav>
      {props.menu('main').map((item) => (
        <a href={item.url ?? undefined}>{item.label}</a>
      ))}
    </nav>
  )
}
```

`menu(alias)` is on `PageProps`, so `usePage().menu('footer')` works from any
component; it answers the menu's items in the page's culture, or `[]` when no
published menu has that alias. Each item is `{ label, url, target, kind, key,
content, children }`: `label` is the item's own, else the page's or media item's
name, else the link's text; `content` is the page, for `aria-current`.

- **Pages are read as they are now.** A renamed or moved page shows its new name
  and address. One unpublished or in the recycle bin drops out, with the items
  below it, and comes back when it is published again. An address that would run
  script (`javascript:` and the like) is dropped as the multi-URL picker drops it.
- **Cached with the published content.** Menus are published elements, held in
  the published cache per culture like any other, so publishing a menu or a page
  in it is what changes it. The media items a menu links to are read from the
  media cache in one lookup, before the page renders, so `menu()` stays
  synchronous and a renamed file shows its new name at once.
- **The alias** is filled from the menu's name when left empty — "Main
  navigation" becomes `mainNavigation`, Umbraco's safe-alias rule
  (`safeAlias` in core) — and stays when the menu is renamed. Two menus may not
  share one: the second is refused when saved.
- **The types** are shipped: `menu` (an element type offered in the Library) and
  `menuItem`, with the `menuItems` block list and the `menuLink` multi-URL picker
  data types, all ensured at boot by fixed keys. They travel in bundles and in
  content transfer as any element does; an export does not list them as needing
  to exist at the destination, because every site has them.
- The Delivery API answers `menus/{alias}` ([`delivery-api.md`](delivery-api.md)).

The starter template's header reads `menu('main')`, falling back to the home page
and its children when the menu is empty.

## Media and imaging

Media items are documents of the media object type, never published. A file
is uploaded as a temporary file, then placed when a value that names it is
saved, at `<8 hex>/<safe name>` in the site's **media store**, and served at
`/media/…`.

Where those bytes live is one interface, `MediaStore`: the file system by default
(`CROMBOLO_MEDIA_DIR`, default `media`), or an S3 bucket or Azure container — see
the README's *Media storage*. Nothing here depends on which: the database holds
the path a value names, and serving either streams the bytes or, for a store that
returns a `publicUrl`, redirects the browser to a CDN or a presigned URL.

A `/media/…` URL with a query is an imaging request in the vocabulary
Umbraco's ImageSharp URL generator writes: `width`, `height`, `rmode` (crop,
max, stretch, pad, boxpad, min), `rxy` (focal point), `cc` (crop coordinates
as fractions trimmed from each edge), `format`, `quality`. Each variant is
computed once and cached in the store under `.cache/`, keyed by the source's
etag — so replacing an original invalidates its crops with nothing tracking
that, and one node's work serves every node. Bun's `Image` decodes, resizes
and encodes; cropping and padding go through raw RGBA pixels via a small PNG
codec in `@crombolo/server` `imaging.ts`.

### Protected media

A media folder or item's **Permissions** (in its actions menu) hold a **Public
Access** section (story 205) with two toggles. Read offers **Enabled** (the
default: anyone with the link), **Disabled** (back-office users only) and
**Custom**; Write offers **No Public Access** and **Custom**. Custom grants
access to the selected member groups or individual members, independently for
reading and writing. Public write is never allowed.

A child file or folder shows **Inherit parent permissions**, ticked unless it
has settings of its own. Inheritance is live: it follows the nearest folder
above that has settings, or the defaults (Enabled / No Public Access) when none
has, so changing a folder applies at once to everything below that inherits.
Unticking it starts the item's own settings from what it inherited; ticking it
again takes them off. The line above the section, and the media workspace's
info panel, say where the settings come from and who they let in.

Existing saved settings are preserved, including older all-members and creator
settings on files, which show as overrides.

- **The nearest rule wins.** A folder's rule governs everything below it, and
  a rule on a child folder or item replaces it: stricter, looser, or open to
  anyone again. Rules are rows in `media_access` and `media_access_rule`, one
  per folder or item given permissions, with groups named as page rules name
  them. `media_access_member` holds individual member UUIDs with independent
  read/write flags. Custom accepts a matching group or a selected member.
- **New files inherit.** A file is created with `inherit` (null) in its
  `read_policy` and `write_policy` columns on `content`, following the nearest
  rule live, so millions of files cost no rule rows. An override from the
  dialog is a rule on the item itself, with its policies left at `inherit`.
  A rule may still carry an explicit default for new files (`new_read`,
  `new_write`: all signed-in members, members of its groups, only the member
  who added the file, or no member), from older settings or a transfer; it is
  stamped on each new file as it is created. The dialog no longer offers it,
  and keeps only "only the member who added it" when a folder is saved.
- **The creator.** `content.creator_member_key` records the member who created
  a file. "Only the member who added it" means that member, and being its
  creator grants nothing else. Members create media through a server bundle
  ([below](#what-members-may-upload)).
- **Who else may read.** A back-office user with the Media section may read a
  protected file within their Media start nodes; an API client acts with its
  user's rights. A Delivery API member token counts as the member's site
  cookie. The check is `memberMay` in `@crombolo/core`, one function for
  `/media/`, the Delivery API and the back office.

**Serving.** Every `/media/…` request finds the media item that owns the file
through `content.file_url`, an indexed column written whenever the file value
is saved. A file a page's own upload field holds is listed in `node_file`, and
a back-office user's avatar is on their account: both are served as before. A
key nothing owns answers 404 — a visitor's form upload among them, which a
workflow still attaches — and `.cache/` and `.temp/` are never reachable by
URL.

- A protected file, and every crop of it, is checked, then streamed by this
  server with `Cache-Control: private, no-store`. It is **never redirected** to
  the store's public address, whatever the store.
- Anyone who may not read it gets **404**, so a shared or guessed link does not
  confirm that the file exists.
- A file in the recycle bin has left the folder that protected it, so only a
  back-office user may read it.
- An open file keeps its caching headers and its redirect.

**What a CDN must not front.** A CDN or a public bucket in front of the media
store serves whatever it holds to anyone who has the address, and this server
never sees the request. Keep protected files in a store nothing public serves:
point `CROMBOLO_MEDIA_PUBLIC_URL` (or the S3 or Azure public address) only at a
store whose files are all open, and never cache `/media/` at a CDN by path
alone, since a protected file's answer is `private`. The server says so at boot
when a store has a public address.

**Pages.** A media picker on a page still renders the file's URL; the file
itself is guarded when it is fetched. A page's own access is separate, as
before.

**The item behind a file** is read through the media cache (story 197): its
type and its own `cacheKeepFor` decide how long an open file may be kept, and
its key tags the answer when tagging is on. No map over all media is built.

#### What members may upload

A member uploads only through a server bundle's `media` capability
(`docs/bundles.md`, "Media as the member", story 198), and only into a folder
whose rule lets one of their groups change it. The same rule says what they may
upload there, under **File types members may upload here** in the Permissions
panel:

- **The file types**, ticked from a fixed list: JPEG, PNG, GIF, WebP, AVIF,
  HEIC, PDF, MP3, WAV, MP4 and QuickTime (`MEMBER_FILE_TYPES` in
  `@crombolo/core`). Nothing is accepted that is not ticked, so a folder with
  none ticked, or no rule at all, accepts nothing from a member. A file is
  recognised by its first bytes, and its extension must agree; the site's
  disallowed extensions still apply. A bundle may narrow the list for its own
  uploads, never widen it.
- **The largest file**, in MB, optional. The smallest of this, the bundle's own
  limit and the site's applies, counted while the upload is read.

Both are part of the folder's rule (`media_access.member_types`, a
comma-separated list, and `member_max_bytes`, migration 052), so they are
inherited by the folders below and replaced, with the rest of the rule, by a
nearer one: give a subfolder its own rule and tick its types again. An image a
member uploads is stored upright and without its metadata; see the bundle docs.

A folder a bundle uses shows **Used by** with the bundle's name, in the
Permissions panel and the media workspace, and the back office asks before it,
or a folder above it, is renamed, moved or deleted, since the bundle finds it
by its path and the site will not start again until the bundle is changed to
match.

## Components

A view is reached only through a content type's template alias, and it is
loaded when a request renders it — so a view that does not compile is a 500 that
waits for a visitor to find it. `components check` is that failure brought forward:

```bash
bunx crombolo components check             # compile every view; report a template with no file
bunx crombolo components list              # what is in components/, and which type declares each
bunx crombolo components new shared/header        # components/shared/header.tsx
bunx crombolo components new --block quote        # components/blocks/quote.tsx, for an element type
bunx crombolo assets list             # the stylesheets and scripts beside them
bunx crombolo assets new stylesheet print.css
```

Every `.tsx` is transpiled and then imported, which is what a render does, so an
import that does not resolve is caught as well as a syntax error. Types need the
compiler: when the site has `typescript` installed — `crombolo init` puts it in
`devDependencies` — it also runs `tsc --noEmit` over the site, and says so when
it cannot. A component is a template only when a content type names it, so a shared one
belongs in a subdirectory, where the template scan never looks.

`components new` writes a page for an alias a content type names, an e-mail
template (over `EmailProps`) for one a form's Send email workflow names as its
`template` ([`forms.md`](forms.md#an-e-mail-template)), and a plain component
otherwise. An e-mail template renders through `Renderer.renderEmail`, with the
same time limit and layout chain as a page.

## Middleware

A site's middleware is code it imports and lists in `crombolo.config.ts`, by
stage, each run in the order given (story 210):

```ts
import { securityHeaders } from '@acme/crombolo-security'
import { regionRedirect } from './middleware/region.ts'

export default defineConfig({
  middleware: {
    request: [securityHeaders(), regionRedirect({ default: 'en' })],
    route: [legacyPaths()],
    page: [auditTrail],
  },
})
```

**The contract** is `@crombolo/common`'s, re-exported by
`@crombolo/crombolo/middleware` with crombolo's types bound. Anything that meets
it can be listed: the site's own code, an npm package's factory, or a server
bundle's `middleware`. Nothing joins the chain without a line in the config.

```ts
type MiddlewareHandler = (request: Request, next: (request?: Request) => Promise<Response>, context: MiddlewareContext) => Response | Promise<Response>
type Middleware = MiddlewareHandler | { name: string; matcher?: Matcher | Matcher[]; handle: MiddlewareHandler }
// context: url, cookies, site(), page, member, preview, signal, stage
```

Each stage is an onion, outermost first:
- **Answer outright:** don't call `next`, for example
  `Response.redirect(url, 308)` or a `401`.
- **Change the request:** call `next(changed)`. Changed headers and cookies
  reach 206's `headers()` and `cookies()`.
- **Rewrite:** call `next(rewrite(request, '/other'))`.
- **Change the answer:** return `next()`'s `Response` altered.
  `withCookie(response, name, value)` sets a cookie.

| Stage | Runs | Sees | May |
|---|---|---|---|
| `request` | first, before the redirect tables and content finding | the request | answer, redirect, rewrite, change headers and cookies |
| `route` | after content finding; an address the redirect tables answer skips it | `context.page` | redirect, rewrite (resolved again from the start), answer |
| *public access* | *always, on the page that finally renders* | | |
| `page` | after access, before rendering | `context.page`, `context.member` | change the answer; a rewrite is refused |

- **Site requests only:** pages, the not-found page included, story 211's
  routes, `/css/` and `/scripts/`.
  - **Never** the back office, the APIs, member, form, island and bundle
    endpoints, `/media/`, `/sitemap.xml`, `/robots.txt` or `/health`. They
    are answered before the chain is reached.
  - **A rewrite into any of them is refused,** as is one to another origin.
- **Rewrites** are resolved in full at the new path, so redirects and public
  access apply there too.
  - **Query:** the page sees the rewritten query, or the original one when the
    rewrite gives none.
  - **Address and caching:** the address stays as the visitor asked, and the
    answer is cached under it. `<SeoHead>`'s canonical names the page that
    rendered.
- **Matchers** use the built-in `URLPattern`, with Next.js's syntax:
  - `'/shop/:path*'`;
  - `'/((?!api|_next).*)'`;
  - `{ source, has, missing }` on headers, cookies and the query.

  A middleware that doesn't match costs nothing.
- **Caching.** Reading `context.cookies`, or a `Set-Cookie` on the answer,
  makes it `private, no-store`. A redirect or rewrite decided from the path
  alone stays cacheable. A middleware deciding per visitor from the raw
  request must say so with `context.cookies` or a `Cache-Control` of its own.
- **Time limit.** The whole chain shares one,
  `CROMBOLO_MIDDLEWARE_TIMEOUT_MS` (2 seconds). A middleware's clock stops
  while it awaits `next()`, so crombolo's own work and the page's rendering
  never count. A throw, or running past the limit, answers the error page with
  a reference, and the log names the middleware.
- **Preview.** The chain runs with the previewing editor as the visitor and
  `context.preview` true. A redirect shows the editor a notice instead of
  moving the frame.
- **The member's session** is looked up only when it is needed: for the `page`
  stage, or when `context.site()` reads something personal.
- **Next.js code.** `fromNextMiddleware(fn, { matcher })` runs a Next.js-style
  middleware as one link: `NextResponse.next()` carries on (with replaced
  request headers if given), `rewrite()` renders another site path,
  `redirect()` and any other response answer, and headers and cookies set on a
  `NextResponse` reach the final answer. This is unrelated to
  `@crombolo/next-integration/middleware`, which is a Next.js app's own.

The runner is `packages/server/src/middleware.ts`, and the stages are wired in
`server.ts` (`siteRequest`, `renderSite`, `pageStage`).

## Route handlers

A site's own endpoints are listed in `crombolo.config.ts` (story 211):

```ts
import { Outcome, ok, route } from '@crombolo/crombolo/routes'

export default defineConfig({
  routes: [
    route('/api/records/:species', {
      GET: (_request, { params, site }) => site().sql.recordsFor(params.species),
      POST: async (request, { member }) => {
        const signedIn = await member()
        if (!signedIn) return Outcome.unauthorized('Sign in to add a record.')
        return Response.json(await addRecord(signedIn, await request.json()), { status: 201 })
      },
    }, { members: true }),
  ],
})
```

**The contract** is `@crombolo/common`'s (`route`, `RouteHandler`,
`RouteContext`, `SiteRoute`), re-exported by `@crombolo/crombolo/routes` with
crombolo's types bound. A server bundle declares its routes the same way
([`bundles.md`](bundles.md#routes)).

- **A handler** is `(request, context) => Response | Result`:
  - a `Response` is sent as it is;
  - an `Ok` is sent as JSON, so a `Result`-returning query can be the answer;
  - an `Outcome`, returned or thrown, answers its status. A redirect redirects,
    and an error is problem+json (`{ type, title, status, detail, errors }`).
    A request that prefers HTML gets the status page instead.
- **The context** holds `params`, `url`, `cookies`, `setCookie(name, value,
  options)`, `site()` (206's services, acting as the caller), `member()` (the
  signed-in member by cookie or bearer token, looked up when asked) and
  `signal`. 206's `cookies()`, `headers()` and navigation work inside a
  handler too.
- **Paths** use `URLPattern` syntax (`/api/:id`, `/files/:path*`) and start
  with `/`. The boot refuses, by name:
  - a path under `/umbraco`, `/crombolo`, `/media` or the back office;
  - two routes on one path.
- **A route wins at its path**, ahead of content finding. When it hides a
  published page, the "Routes and pages" status check (group Site) names both.
- **Methods:** as declared. `HEAD` comes from `GET`, `OPTIONS` answers with
  `Allow`, and any other method gets a 405 with `Allow`.
- **Middleware:** only the `request` stage runs before a route; `route` and
  `page` are about pages.
- **Errors and time.** A throw is a 500 with a reference that the log line
  shares; the message is shown only where error details are.
  `CROMBOLO_ROUTE_TIMEOUT_MS` (10 seconds) answers 504 and aborts `signal`.
- **Caching.** Every answer is `private, no-store` unless a `GET` or `HEAD`
  handler sets its own `Cache-Control`.
- **Nodes:** routes answer where the site is served (`all` and `web`), never
  on an `api` node.

| Option | Default | |
|---|---|---|
| `members` | anyone | `true` for any signed-in member, or `{ groups: [...] }` (in any case): 401 or 403 before the handler runs |
| `csrf` | on | a cookie-authenticated `POST`, `PUT`, `PATCH` or `DELETE` must come from this site or carry the anti-forgery token; `false` for a webhook receiver |
| `rateLimit` | the site's | `{ perMinute, by: 'member' \| 'caller' }`, or `false` for none |
| `cors` | off | answers the Delivery API's allowed origins (`deliveryApi.cors.allowedOrigins`), pre-flights included |

**CSRF.** A request counts as from this site when its `Sec-Fetch-Site` says
`same-origin`, or its `Origin` is the site's. Otherwise it needs the member's
anti-forgery token: a `Crombolo-Antiforgery` header, or an `__antiforgery`
form field. The layout writes the token with `<AntiforgeryMeta />`, and
`crombolo.fetch` from `/crombolo/bundle.js` sends it. A bearer-token call is
never checked, and neither is a visitor's.

**Rate limits.** Every route has the site-wide default:
`CROMBOLO_ROUTE_RATE_LIMIT_PER_MINUTE` (2000 a minute per caller; 0 for none).
That is high enough to stop only a flood. A caller is the member when signed
in, otherwise the address, which is the connection's or the last
`X-Forwarded-For` entry behind a private proxy. Each server counts in its own
memory, so behind N servers the limit is N times as large. A caller over the
limit gets 429 with `retry-after`.

**Next.js route modules.** `fromRouteModule('/api/hello', module)` takes a
Next.js-style `route.ts`: its exported `GET`, `POST` and so on, called with
`{ params }` as a promise. Its exported `csrf`, `rateLimit` and `members` are
honoured.

The pipeline is `packages/server/src/routes.ts`.

## Islands

A view whose first statement is `'use client'` runs in the browser (story 209;
writing one: [`writing-components.md`](writing-components.md), "Interactive
parts").

1. **On the server it is a stub.** While views are copied into a snapshot
   generation, a client module is written as a stub:
   - each of its exports renders a `<crombolo-island>` holding its props as
     JSON in a `<script type="application/json">`, then its `fallback` or its
     `children`;
   - the JSON has `<`, `>`, `&`, U+2028 and U+2029 escaped, so nothing in it
     can close the script;
   - the source is kept under the generation's `.islands/src/`.

   The server never imports React. The snapshot transform is
   `islandTransform` (`packages/render/src/islands.ts`).
2. **Its browser code is built with the generation.** `buildIslands`
   (`packages/server/src/islands.ts`) bundles, in one `Bun.build` before the
   generation is rendered:
   - the client modules, from their source;
   - `components/client/*`, which `<Island>` mounts;
   - React's mount, `@crombolo/crombolo/islands-react`.

   The output, with code splitting and hashed names, goes to `.islands/out/`
   with a `manifest.json`, and is served at `/crombolo/islands/<generation>/…`
   with immutable caching. A page always loads the code built from the views
   it rendered with, and an edit in development is a new generation like any
   other. A failed build is logged and the generation still serves: its
   islands show their fallback.
3. **A page with an island ends with two tags**, before `</body>`: a `<meta
   name="crombolo-islands">` naming its manifest, and `<script type="module"
   src="/crombolo/islands.js">`.
   - **The loader** finds each island, waits for its `data-load` (`visible`,
     `idle` or `load`), imports its module once however many islands share
     it, and mounts it. A client component is rendered with React, with the
     server-rendered children as its `children`. An `<Island>` module is
     given the element and its props. A missing or failing island keeps its
     fallback and says so in the console.
   - **No inline script.** Crombolo writes no inline executable script: the
     props are data and everything else is a file. A strict `script-src
     'self'` policy works, and the pages stay cacheable at a CDN, where a
     per-request nonce could not.

**The boundary.** A client module importing server-only code
(`@crombolo/crombolo/server`, `/headers`, `/navigation`, Crombolo's internal
packages, `node:` and `bun:` modules) fails the build with both files named,
and `crombolo components check` reports it without importing the module.
Those three entry points also throw if a browser ever loads them.

**A Vite build instead.** With `islands: { manifest: 'dist/.vite/manifest.json' }`:
- **Production:** Crombolo bundles nothing. It serves the files Vite built at
  `/crombolo/islands/vite/…`, and makes Vite's manifest over into its own by
  source path. The site's Vite config lists its client modules,
  `components/client/*` and `@crombolo/crombolo/islands-react` as inputs.
- **Development:** `islands.devServer` points at Vite's dev server, and the
  islands load from it.

Templates are the same either way. Building ahead, for hosts that cannot
write at runtime, is story `218`.

Islands need snapshots, which the server always takes. A `Renderer` built
without them, as some unit tests build one, imports client modules as they
are.

## Blocks

A block renders with its own component, found by its element type (story 184):
`<Blocks items={model.value('sections')} />` renders each block with
`components/blocks/<element alias>.tsx`'s default export, given `{ content,
settings, block }`. A new kind of block is one new file, not an edit to every
template that lists blocks. It is Umbraco's partial-per-element-type convention
(`blocklist/Components/<alias>`), for TSX.

- **The lookup** goes through the render scope (`blockComponent`), which the
  renderer fills for each page with `Renderer.blockComponent`. It imports from
  the page's own views generation, so a changed block component is taken up
  as a changed template is. The alias must be one plain segment
  (`[A-Za-z0-9_-]`), so an element type alias cannot reach outside
  `components/blocks/`.
- **A template's own mapping wins**, there only: `<Blocks items={…}
  components={{ quote: PullQuote }} />`. Harbourstone renders its `highlight`
  blocks as rows through the file, and as figures on the home page by mapping
  the type.
- **A missing component** renders nothing to visitors. In preview, which is
  the one render that passes `preview: true` (`RenderRequest`), it renders a
  placeholder naming the element type and the file to create.
- **A Block Grid** renders Umbraco's block-grid markup, so Umbraco's default
  stylesheet and CSS written for it apply unchanged:
  - `umb-block-grid` with `--umb-block-grid--grid-columns`;
  - `umb-block-grid__layout-container`;
  - `umb-block-grid__layout-item` with `data-content-element-type-alias` and
    `--umb-block-grid--item-column-span` / `--umb-block-grid--item-row-span`;
  - `umb-block-grid__area-container` with
    `--umb-block-grid--area-grid-columns`;
  - `umb-block-grid__area` with `data-area-alias`.

  A block's areas, rendered, are its component's `children`; it places
  `{children}` where they go, as Umbraco's `GetBlockGridItemAreasHtmlAsync`
  does.
- **Tooling:**
  - `crombolo components new --block <alias>` writes the file, typed with
    `BlockProps<Alias>` from `schema/content-types.d.ts`;
  - `components check` warns of a block component whose name is no element
    type.

The code is in `packages/render/src/blocks.ts`.

## Hostnames

Schema travels between environments; hostnames cannot, because they mean
something different in each one. A site may keep them in `domains.toml` beside
`crombolo.config.ts`, with `${VAR}` read from the environment when it is
applied, so one committed file serves them all:

```toml
[[domain]]
node = "/"
host = "${SITE_HOST}"

[[domain]]
node = "/Home/French"
host = "fr.harbourstone.example"
culture = "fr-FR"
```

```bash
bunx crombolo domains                 # what the file declares, and what is bound here
bunx crombolo domains set / --host '${SITE_HOST}'      # writes the file, then applies it
bunx crombolo domains set /Home/French --host fr.example=fr-FR
bunx crombolo domains apply           # what a deploy step runs; what boot does
bunx crombolo domains undo            # put back the file the last write replaced
```

The file is the truth: boot converges the `domain` table onto it, so deleting an
entry unbinds that hostname. A site with no `domains.toml` is left alone, and
the backoffice stays the only way — and on a site that has one, a save in the
backoffice writes the file too, so the next boot does not undo it.
`docs/rendering.md` has the routing rules.

## How a changed view reaches a running site

A view is a module, and `import()` caches modules in the runtime keyed on the
resolved path. There is no eviction; a cache-busting query works on Node but not
on Bun; and on every runtime the graph *beneath* a re-imported file stays pinned,
so re-reading `homePage.tsx` would still render the layout it first imported.
That is why a saved template cannot simply be read again.

Only a **new path** is read fresh. So the server renders from a content-addressed
copy of the tree:

```
<site>/.crombolo/components/<hash>/homePage.tsx          ← imported
<site>/.crombolo/components/<hash>/components/layout.tsx ← resolves inside the snapshot
```

The hash is of the whole tree, because a template's behaviour is its import
graph: `homePage.tsx` can be byte-identical while the layout it uses changed.
Structure is preserved, so a view's own relative imports resolve unchanged, and
no request can mix a new template with an old layout.

A change is noticed two ways. A template saved in the backoffice is snapshot
before the save returns. Anything else — a deploy, a file written in the
container — is caught by a periodic re-hash on the render path, behind a TTL,
single-flight, with the current snapshot serving while it runs. One render after a
change may still be the old generation; the next is not.

Because the name is the content, nothing is wasted: an unchanged tree yields the
same hash, so no copy and no re-import, and reverting a change returns to a
generation already loaded. It also takes the mount off the request path entirely
— the bucket is read when the tree changes, never per render.

| Setting | Default | Development |
| --- | --- | --- |
| `CROMBOLO_COMPONENTS_CACHE_DIR` | `<site>/.crombolo/views` | same |
| `CROMBOLO_COMPONENTS_GATE_MS` — how often a node looks | 5,000 | 500 |
| `CROMBOLO_COMPONENTS_SWAP_MS` — floor between generations | 10,000 | 0 |
| `CROMBOLO_COMPONENTS_GENERATION_LIMIT` | 250 | 250 |
| `CROMBOLO_COMPONENTS_KEEP` — generations left on disk | 3 | all, until boot |

Three things to know before changing them:

- **The cache directory must sit inside the site**, for the `jsx-runtime` reason
  above, and outside `components/`, or it would snapshot itself. Both are refused at
  boot, and `crombolo status` reports the same check so a deploy learns first.
- **It is cache, and cleared at boot**, so it must not be anything you would mind
  losing — it is rebuilt from `components/` in milliseconds. Compose keeps it on a
  tmpfs so it never reaches the bind mount, where `--watch` would see it.
- **Each generation stays in the runtime's registry until restart** — about 88 KB
  for a small tree. That is what the generation limit bounds: at the limit a node
  **freezes**, keeps serving the views it has, refuses newer ones and says so in
  its log and on `/health`. It stays `ok` deliberately: a runaway writer should not
  turn a stale template into an outage. Restarting clears it.
