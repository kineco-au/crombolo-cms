# Writing components

A component is a function that takes props and returns markup. Templates and
the components they import are ordinary `.tsx` files under `components/`, written
in JSX the way a React component is, but rendered once, on the server, to HTML.
[`adding-a-page.md`](adding-a-page.md) walks through making a page;
this is the cookbook for what goes inside one.

Every example below is a real file. Together they make the page at the end, and
`tests/docs-components.test.ts` renders that page from the blocks in this
document, so they stay correct.

## A component, and its props

```tsx
// components/shared/badge.tsx
import type { Child } from '@crombolo/crombolo'

interface BadgeProps {
  tone?: 'info' | 'warning'
  children: Child
}

export function Badge({ tone = 'info', children }: BadgeProps) {
  return <span class={`badge badge--${tone}`}>{children}</span>
}
```

- **Props are typed like any function's.** Give the props an interface, and every
  `<Badge>` is checked against it: a missing `children`, or `tone="error"`, is a
  type error.
- **`Child` is anything that renders:** text, numbers, markup, an array of them,
  `null` or `false` for nothing, or a promise of any of those.
- **`class` or `className`, `for` or `htmlFor`.** Both spellings work; HTML's are
  shorter.
- **Text is escaped.** `{children}` cannot inject markup; see "Raw HTML" for when
  markup is what you have.

## Lists and conditions

```tsx
// components/shared/card-list.tsx
import type { PublishedContent } from '@crombolo/crombolo'
import { Badge } from './badge.tsx'

const WEEK = 7 * 24 * 60 * 60 * 1000

export function CardList({ pages }: { pages: PublishedContent[] }) {
  if (pages.length === 0) return <p>Nothing here yet.</p>
  return (
    <ul class="cards">
      {pages.map((page) => (
        <li>
          <a href={page.url}>{page.name}</a>
          {Date.now() - page.updateDate.getTime() < WEEK && <Badge>New</Badge>}
        </li>
      ))}
    </ul>
  )
}
```

A list is an array: `map` over the items. `false`, `null` and `undefined` render as
nothing, so `condition && <Element />` shows the element only when the condition
holds. There is no `key` to give a list item; it is accepted and ignored.

## Styles and SVG

```tsx
// components/shared/hero.tsx
import type { Child } from '@crombolo/crombolo'

export function Hero({ image, children }: { image?: string; children: Child }) {
  return (
    <section
      class="hero"
      style={{
        backgroundImage: image ? `url(${image})` : undefined,
        minHeight: 320,
        '--hero-gap': '2rem',
      }}
    >
      {children}
    </section>
  )
}
```

```tsx
// components/shared/arrow-icon.tsx
export function ArrowIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden={true}>
      <path
        d="M3 8h10M9 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
```

- **A `style` object is CSS.** `minHeight: 320` is `min-height:320px`: a number
  gets `px` where React would add it, and not on unitless properties like
  `opacity` or `zIndex`. A property set to `undefined` or `null` is left out.
  Custom properties (`--hero-gap`) are written as they are. A plain string works
  too: `style="color: red"`.
- **SVG attributes are written in camelCase** and come out as SVG spells them:
  `strokeWidth` is `stroke-width`.
- **`aria-*` and `data-*` take booleans** and write them as `"true"` and `"false"`.

## Raw HTML

Rich text is stored as HTML, so it is written out as HTML, not escaped:

```tsx
<div>{model.html('body')}</div>
<div setInnerHTML={{ __html: markdownToHtml(model.text('notes')), dangerously: true }} />
<div dangerouslySetInnerHTML={{ __html: markupFromElsewhere }} />
```

`model.html()` is the short way for a property. `setInnerHTML` escapes unless
told `dangerously: true`, so forgetting the flag fails safe. React's
`dangerouslySetInnerHTML` is accepted as React writes it, verbatim. Never pass a
visitor's input to either.

## Forms, and ids

```tsx
// components/shared/newsletter-form.tsx
import { useId } from '@crombolo/crombolo'

export function NewsletterForm({ topics }: { topics: string[] }) {
  const email = useId()
  const topic = useId()
  const notes = useId()
  return (
    <form method="post" action="/newsletter">
      <label for={email}>Email</label>
      <input id={email} name="email" type="email" required />

      <label for={topic}>Topic</label>
      <select id={topic} name="topic" defaultValue={topics[0]}>
        {topics.map((name) => (
          <option value={name}>{name}</option>
        ))}
      </select>

      <label for={notes}>Notes</label>
      <textarea id={notes} name="notes" rows={3} defaultValue="" />

      <label>
        <input type="checkbox" name="updates" defaultChecked /> Send me updates
      </label>
      <button type="submit">Subscribe</button>
    </form>
  )
}
```

- **`useId()` gives an id unique within the page**, so two of these forms on one
  page do not share their labels' targets.
- **React's form props work.** `defaultValue` and `defaultChecked` are an input's
  `value` and `checked`; a `<textarea>`'s value is its text; a `<select>`'s
  `value` or `defaultValue` marks the matching `<option>` selected (a list, for
  `multiple`). The select can see only options written directly inside it, or
  inside an `<optgroup>`: one returned by another component has been written
  already, so put `selected` on it instead.
- A form built in the backoffice's Forms section is rendered with
  [`<Form>`](forms.md) rather than by hand.

## Blocks

A Block List or Block Grid property is rendered with `<Blocks>`, and each block
with its own component, `components/blocks/<element alias>.tsx`:

```tsx
// components/pages/landingPage.tsx
import { Blocks, type PageProps } from '@crombolo/crombolo'
import type { LandingPage as Page } from '../../schema/content-types'

export default function LandingPage({ model }: PageProps<Page>) {
  return (
    <main>
      <Blocks items={model.value('sections')} />
    </main>
  )
}
```

```tsx
// components/blocks/quote.tsx
// `crombolo components new --block quote` writes this.
import type { BlockProps } from '@crombolo/crombolo'
import type { Quote } from '../../schema/content-types'

export default function QuoteBlock({ content, settings }: BlockProps<Quote>) {
  return <blockquote>{content.text('said')}</blockquote>
}
```

- **A new kind of block** is one new file: every template that renders that
  property with `<Blocks>` picks it up.
- **To render a type differently in one place,** pass `components={{ quote:
  PullQuote }}`.
- **A block with no component** shows nothing to visitors, and in preview a
  note naming the file to create.
- **In a grid,** a block's areas arrive as `children`: put `{children}` where
  they belong. The grid's markup is Umbraco's, so its block-grid stylesheet
  applies ([`rendering.md`](rendering.md#blocks)).

## Async components

A component can wait for something: another service, a file, a slow query.

```tsx
// components/shared/upcoming-events.tsx
import { usePage } from '@crombolo/crombolo'

interface UpcomingEvent {
  title: string
  startsAt: string
}

export async function UpcomingEvents({ feedUrl }: { feedUrl: string }) {
  const { signal } = usePage()
  let events: UpcomingEvent[] | undefined
  try {
    const response = await fetch(feedUrl, { signal })
    events = response.ok ? ((await response.json()) as UpcomingEvent[]) : undefined
  } catch (error) {
    if (signal.aborted) throw error
  }
  if (!events) return <p>Upcoming events can't be shown right now.</p>
  return (
    <ol class="events">
      {events.map((event) => (
        <li>
          <time datetime={event.startsAt}>{event.startsAt.slice(0, 10)}</time> {event.title}
        </li>
      ))}
    </ol>
  )
}
```

- **The page waits for it** before anything is sent. Async components side by
  side start together; to wait for two things inside one, start both and
  `await Promise.all([...])`.
- **Pass `signal` to what you wait on.** It aborts when the page runs out of time
  (10 seconds by default) or the visitor leaves. `usePage()` hands it to any
  component without it being passed down.
- **Decide what a failure looks like.** An error a component throws fails the
  page. Catch the ones that should leave the rest of the page standing, and let an
  abort through.

## Searching the site

`search()` finds the site's published pages by what they say, best match first.
It's what a search results page is written with:

```tsx
// components/pages/searchPage.tsx
import { type PageProps, search } from '@crombolo/crombolo'

export default async function SearchPage({ request }: PageProps) {
  const query = new URL(request.url).searchParams.get('q') ?? ''
  const results = query ? await search(query, { take: 10 }) : { total: 0, items: [] }
  return (
    <ol>
      {results.items.map((item) => (
        <li>
          <a href={item.url}>{item.name}</a>
          <p>{item.excerpt.map((s) => (s.match ? <mark>{s.text}</mark> : s.text))}</p>
        </li>
      ))}
    </ol>
  )
}
```

- **Options:** `culture` (the page's own by default), `types` (content type
  aliases), `skip` and `take` (10, at most 100).
- **Each item** is the published page as `content`, with its `url`, `name`,
  `score`, and an `excerpt`: the text around the words searched for, in
  segments, with `match` set on each word that matched. Render the segments as
  above, rather than as HTML.
- **`total`** counts every match the person searching may open, for paging.
- **Members-only pages** are left out unless the signed-in member may open
  them.

What is searchable, and how much each property counts, is set in the schema
(`site-search`, [`schema-as-code.md`](schema-as-code.md)). The starter template's
`pages/searchPage.tsx` is a complete results page, with paging.

## Context: values without props

Any component can read the page being rendered with `usePage()`, and a template's
own values can be handed down with a context:

```tsx
// components/shared/breadcrumbs.tsx
import { usePage } from '@crombolo/crombolo'

export function Breadcrumbs() {
  const { model, nav } = usePage()
  const trail = nav.ancestors(model).reverse()
  if (trail.length === 0) return null
  return (
    <nav aria-label="Breadcrumbs">
      {trail.map((page) => (
        <a href={page.url}>{page.name}</a>
      ))}
      <span aria-current="page">{model.name}</span>
    </nav>
  )
}
```

```tsx
// components/shared/theme.tsx
import { type Child, createContext, useContext } from '@crombolo/crombolo'

export const Theme = createContext<'light' | 'dark'>('light')

export function Panel({ children }: { children: Child }) {
  return <div class={`panel panel--${useContext(Theme)}`}>{children}</div>
}
```

A provider sets the value for what it renders, and **takes its children as a
function**:

```tsx
<Theme.Provider value="dark">
  {() => <Panel>Dark, without a prop.</Panel>}
</Theme.Provider>
```

React renders the tree after building it, so a provider there runs before its
children. This runtime renders as it goes, so `<Panel>` written plainly would
render before the provider had set its value; the function holds it back.
Plain children are a type error. [`rendering.md`](rendering.md), "Context",
has the detail.

## A layout

```tsx
// components/shared/layout.tsx
import { type Child, SeoHead, usePage } from '@crombolo/crombolo'
import { Breadcrumbs } from './breadcrumbs.tsx'
import { Theme } from './theme.tsx'

interface LayoutProps {
  theme?: 'light' | 'dark'
  children: () => Child
}

export function Layout({ theme = 'light', children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <SeoHead {...usePage()} />
        <link rel="stylesheet" href="/css/site.css" />
      </head>
      <body class={`theme-${theme}`}>
        <Breadcrumbs />
        <Theme.Provider value={theme}>{children}</Theme.Provider>
      </body>
    </html>
  )
}
```

The layout is a component the page imports. It takes its children as a function
because it provides a context to them, as any provider must. A page that starts
with `<html>` gets `<!DOCTYPE html>` in front of it. A template can instead name
its layout with `export const layout = 'shared/site'`; that layout renders
around the finished page, so it cannot provide a context to it.

## The page

```tsx
// components/showcasePage.tsx
import type { PageProps } from '@crombolo/crombolo'
import type { ShowcasePage as Page } from '../schema/content-types'
import { ArrowIcon } from './shared/arrow-icon.tsx'
import { CardList } from './shared/card-list.tsx'
import { Hero } from './shared/hero.tsx'
import { Layout } from './shared/layout.tsx'
import { NewsletterForm } from './shared/newsletter-form.tsx'
import { Panel } from './shared/theme.tsx'
import { UpcomingEvents } from './shared/upcoming-events.tsx'

export default function ShowcasePage({ model, nav }: PageProps<Page>) {
  return (
    <Layout theme="dark">
      {() => (
        <main>
          <Hero>
            <h1>{model.value('title')}</h1>
            <a href="#events">
              Upcoming events <ArrowIcon />
            </a>
          </Hero>
          <Panel>{model.html('body')}</Panel>
          <CardList pages={nav.children(model)} />
          <section id="events">
            <UpcomingEvents feedUrl={model.text('feedUrl')} />
          </section>
          <NewsletterForm topics={['News', 'Events']} />
        </main>
      )}
    </Layout>
  )
}
```

`PageProps<Page>` types the page by the interface `crombolo generate` writes for
its content type, so `model.value('title')` is a `string` and a misspelt alias
is a type error.

## Server code, coming from Next.js

A page can read the request, load data as the visitor and end early with a
redirect or a refusal, with the App Router's names (story 206;
[`rendering.md`](rendering.md), "Server code"):

```tsx
import { cookies } from '@crombolo/crombolo/headers'
import { notFound, redirect } from '@crombolo/crombolo/navigation'
import { site } from '@crombolo/crombolo/server'

export async function generateMetadata({ searchParams }: PageProps) {
  return { title: `Photos: ${(await searchParams).folder}` }
}

export default async function Photos({ member, searchParams }: PageProps) {
  if (!member) redirect('/sign-in')
  const { folder } = await searchParams
  if (typeof folder !== 'string') notFound('Choose a folder')
  const theme = (await cookies()).get('theme')?.value ?? 'light'
  const photos = (await site().media.children(folder)).unwrap()
  return <ul class={theme}>{photos.map((photo) => <li>{photo.name}</li>)}</ul>
}
```

| Next.js | Crombolo |
|---|---|
| `app/…/page.tsx` | a template a content type names: `components/<alias>.tsx` or `components/<alias>/page.tsx` |
| `params` | none: the address comes from the content tree, the content is `model` |
| `searchParams` (a promise) | the same prop, the same shape |
| `cookies()`, `headers()` from `next/headers` | the same, from `@crombolo/crombolo/headers` |
| `redirect`, `permanentRedirect`, `notFound`, `forbidden`, `unauthorized`, `unstable_rethrow` | the same from `@crombolo/crombolo/navigation`, `rethrow` for the last; plus `foundAt`, `movedPermanentlyTo`, `seeOther`, `badRequest`, `gone`, `unprocessableContent` |
| `not-found.tsx`, `unauthorized.tsx`, `error.tsx` | pages in the content tree named by `pages` in the config, reading `usePage().outcome` |
| `export const dynamic`, `revalidate` | the same; caching is inferred from reading the request as in Next.js |
| `generateMetadata` | the same, for what `<SeoHead>` writes |
| `'use client'` | the same: an island, mounted in the browser with React (story 209) |
| fetching in a server component | `site()`, the site's services as the visitor, returning `Result`s you `unwrap()` |
| `middleware.ts` | `middleware` in the config, by stage; `fromNextMiddleware` runs a Next.js one ([`rendering.md`](rendering.md#middleware)) |
| `app/api/…/route.ts` | `routes` in the config, `route(path, { GET, POST })` from `@crombolo/crombolo/routes`; `fromRouteModule` takes a `route.ts` as it is ([`rendering.md`](rendering.md#route-handlers)) |
| server actions | not yet (story 219); a `POST` route handler |

A page that awaits `searchParams` or reads `cookies()` or `headers()` is never
shared by a cache; one that reads none is kept as the site is configured.

## An e-mail

A form's Send email workflow can name a component as its e-mail design, with
`template = "emails/receipt"` in its settings or the "E-mail design" picker in
the forms designer ([`forms.md`](forms.md#an-e-mail-template)). The component
takes `EmailProps` rather than a page's props: the form, its fields in order,
`value(alias)`, the entry, the site and the subject. The picker offers the
components in `components/emails/`, other than layouts.

```tsx
// components/emails/receipt.tsx
import type { EmailProps } from '@crombolo/crombolo'

export const layout = 'emails/shell'

export default function Receipt({ form, fields, value }: EmailProps) {
  return (
    <>
      <h1>{form.name}</h1>
      <p>Thanks{value('name') ? `, ${value('name')}` : ''}. This is what you sent us.</p>
      <table>
        {fields
          .filter((field) => field.answered || field.leftOut)
          .map((field) => (
            <tr>
              <th>{field.caption}</th>
              <td>{field.leftOut ? 'Not included in e-mail' : field.values.join(', ')}</td>
            </tr>
          ))}
      </table>
    </>
  )
}
```

```tsx
// components/emails/shell.tsx
import type { EmailLayoutProps } from '@crombolo/crombolo'

export default function Shell({ site, subject, children }: EmailLayoutProps) {
  return (
    <html lang="en">
      <head>
        <title>{subject}</title>
      </head>
      <body style={{ fontFamily: 'sans-serif' }}>
        {children}
        <p>
          <a href={site.url}>{site.name}</a>
        </p>
      </body>
    </html>
  )
}
```

- **One shell serves every form.** `export const layout` works as it does for a
  page: the layout gets the same props plus `children`, the finished template.
- **There is no page.** No route, no member, no navigation, so `usePage()` and
  `search()` throw and say so. `useId()` and context work as they do on a page.
- **The text part is written for you**, from the HTML: headings and paragraphs
  as lines, table rows as one line each, links as "text (address)".
- **A field left out** is a sensitive one on a workflow without
  `include-sensitive = true`: `leftOut` is true and `values` is empty, so the
  answer cannot reach an inbox by accident.

## Interactive parts

A page is static HTML. Code that runs in the browser goes in a component whose
first line is `'use client'`, as in Next.js; a template uses it like any other
(story 209; [`rendering.md`](rendering.md), "Islands"):

```tsx
/** @jsxImportSource react */
'use client'
import { useState } from 'react'

export default function Counter({ start, children }: { start: number; children?: React.ReactNode }) {
  const [count, setCount] = useState(start)
  return <button type="button" onClick={() => setCount(count + 1)}>{count} {children}</button>
}
```

```tsx
import Counter from '../shared/counter.tsx'

export default function Page() {
  return (
    <Counter start={2} load="idle" fallback={<p>Loading…</p>}>
      <span>votes</span>
    </Counter>
  )
}
```

- **React** runs it in the browser, and the site installs it (`react`,
  `react-dom`). The `@jsxImportSource react` line makes TypeScript and the
  build read its JSX as React's. Crombolo's own JSX types accept it in a
  template, with `load` and `fallback` as well as its own props.
- **Its props travel as JSON,** so they are data: a function, a class instance,
  a `Date` or a cycle is a template error naming the prop. The one function it
  may be given is one of the site's server actions, which it calls as a
  function from the browser ([`rendering.md`](rendering.md), "Server actions"):
  `<Enquiry send={enquiries.send} />`, typed in the component as
  `send: ClientAction<typeof send>` from `@crombolo/common`.
- **`children`** are rendered on the server, shown until the component mounts,
  and passed to it as `children`. **`fallback`** shows instead until it
  mounts, and never reaches it.
- **`load`**: `visible` (the default, as it scrolls into view), `idle`, or
  `load` for at once.
- **The boundary:** browser code cannot import
  `@crombolo/crombolo/server`, `/headers` or `/navigation`, `#actions/…`, or
  anything else that runs only on the server. The build refuses it, naming both files, and
  `crombolo components check` says so too.

**Other frameworks.** `<Island name="species-map" props={{ speciesId }} />`
mounts `components/client/species-map.ts`, whose default export is
`mount(element, props)`, returning an optional unmount. That is how a Vue or
Lit component, or plain TypeScript, joins a page.

**By hand**, as a last resort: render an element with its props, and add your
own bundled script with `<script type="module" src="/scripts/…">`. A page that
does this needs no islands at all.

## The development loop

`bun run dev` serves the site and restarts it when `crombolo.config.ts`, or
code it imports, changes. Open pages keep up by themselves (story 214):

- **They reload** when you save under `components/` (on disk or in the back
  office's template editor, islands included), change `schema/`, publish,
  unpublish or delete content, or the server restarts. A burst of changes is
  one reload.
- **A template error** answers the error page with the message, the file and
  line, the code around that line with it marked, the components that were
  rendering (`homePage › Layout › Card`), and the stack. Fix the file and the
  page reloads.
- **Type errors** are checked in the background after each save
  (`crombolo components check`'s `tsc`, when the site has `typescript`
  installed). They are printed in the terminal, and a banner on open pages
  shows how many there are and the first one, until they are fixed. A type
  error never stops a page rendering.

Pages carry a small script, `/crombolo/dev/live.js`, served as a file so a
strict `script-src 'self'` still holds. It listens on `/crombolo/dev/events`.
`CROMBOLO_LIVE_RELOAD` turns this on or off. It is on in development, and off
in production and under `bun test`, where pages carry nothing and both paths
answer 404. The error page's details follow `CROMBOLO_SHOW_ERROR_DETAILS` as
before.

## When something is refused

| Written | Why it fails | Instead |
| --- | --- | --- |
| `onClick={…}`, or any function as an attribute | nothing in the browser runs it | a script mounted on the element |
| `<Theme.Provider value="x"><Child /></Theme.Provider>` | `<Child />` rendered before the value was set | `{() => <Child />}` |
| `{someObject}` as a child | it has no text of its own | render its fields, or `JSON.stringify` it |
| a React component imported from a library | it needs React itself | a script mounted on the element |
| `usePage()` at the top of a module | there is no page outside a render | call it inside the component |
| `<select value="x">` with its options from another component | they were written before the select could mark them | `selected` on the option |
