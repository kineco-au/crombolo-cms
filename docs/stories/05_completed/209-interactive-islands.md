# 209 — Interactive islands

**Epic:** O — Building a site · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As a developer building a page in Crombolo's TSX templates, I want to mark a
component `'use client'`, as I would in Next.js, and use it in a template like
any other. Crombolo should bundle it, pass it its props safely and load it in
the browser when it is needed. Then interactivity is one line at the top of a
file, not a hand-wired script.

## Context

A Crombolo page is static HTML. `docs/writing-components.md`, "Interactive
parts", tells a developer to:
1. render an element with JSON in a `data-props` attribute;
2. bundle a script themselves with `bun build`;
3. add a `<script type="module">` and find the element by id.

That works, but every site re-invents it: the bundling, the serialisation
(and its escaping), loading only when visible, and several on one page.

Next.js's App Router draws the line with one directive: code is server-side by
default, and a module whose first statement is `'use client'` runs in the
browser. A server component imports a client one and passes it props; the
framework does the rest. Story 206 brought the App Router's server conventions
to Crombolo's templates. This brings its client boundary, rendered as islands,
as Astro and Fresh do, rather than by hydrating whole pages. Sites being
rebuilt on crombolo plan interactive parts on server-rendered pages, some in
Vue.

## Decided (2026-10-29)

- **`'use client'` marks an island.** A template imports the component and
  renders it; nothing else is written. This replaces the `<Island name>`
  element and `client/` folder the story first proposed as the main way in.
- **React in the browser.** A `'use client'` file is compiled with
  React's JSX runtime, which the site installs. Crombolo depends on no
  framework.
- **No server rendering of the island in this story.** Crombolo's own runtime
  has no hooks, so a client component cannot render to HTML on the server. The
  island shows its fallback until it mounts. Story 215, React on the server,
  is what would render the same files there, unchanged.
- **`<Island>` stays for what is not TSX.** A Vue or Lit component is mounted
  through `<Island name>` and a module exporting `mount(element, props)`, the
  escape hatch for frameworks the directive does not fit.

**Decided when planning (2026-10-29):**
1. **A client file is swapped for a stub while views are copied into a
   snapshot.** The copy is the one place every view passes through. The stub
   has one export per original export, each rendering the placeholder. The
   original stays on disk for the browser build. No Bun runtime plugin.
2. **The browser code is built at runtime, once per snapshot version.** It is
   bundled with `Bun.build` beside the snapshot and served at
   `/crombolo/islands/<version>/…` with immutable caching, so a page and its
   browser code always match. Development needs no extra watcher. A
   `crombolo build` command, for read-only hosts and writing the same
   manifest, is a follow-up story.
3. **React only,** a peer the site installs. No Preact option.
4. **Props are written as `<crombolo-island>` with a JSON script inside.**
   `<`, `>`, `&`, U+2028 and U+2029 are escaped. A function, a cycle, a class
   instance or a `Date` is a template error naming the prop's path.
5. **`children` and `fallback` do different jobs.**
   - `children` are content the component wraps. They are rendered on the
     server, passed to the component as `children` (rendering that HTML), and
     shown as they are until it mounts.
   - `fallback` is a placeholder only. It shows until mount, never reaches the
     component, and is stripped, like `load`.
   - Before mount the page shows the fallback, else the children, else
     nothing.
6. **No nonces.** Crombolo writes no inline executable script:
   - the loader and every chunk are same-origin files, and the props are
     `application/json`, which browsers never run;
   - a strict `script-src 'self'` policy works, and pages stay cacheable at a
     CDN, where a nonce could not be;
   - a test keeps inline executable script out of what Crombolo renders;
   - hash-based CSP for a site's own scripts can be a later story.
7. **A Vite manifest is supported in this story.** `islands.manifest` names
   it, and islands are looked up by source path. `islands.devServer` serves
   them in development. With it set, Crombolo does not bundle. Templates are
   the same either way.
8. **The boundary is checked when the client code is built, with a runtime
   guard behind it.**
   - An import reaching a server-only entry point fails that snapshot's client
     build, naming both files, in the log and in `crombolo components check`.
     The page still renders, with the island's fallback.
   - The server-only entry points also throw if they are ever loaded in a
     browser.

## The design

```tsx
// components/shared/record-wizard.tsx
'use client'
import { useState } from 'react'

export default function RecordWizard({ speciesId, maxPhotos }: Props) {
  const [step, setStep] = useState(1)
  return <form>…</form>
}
```

```tsx
// components/pages/record.tsx — a server template, as today
import RecordWizard from '../shared/record-wizard.tsx'

export default async function Record({ model }: PageProps<RecordPage>) {
  return (
    <main>
      <h1>{model.text('title')}</h1>
      <RecordWizard
        speciesId={model.value('speciesId')}
        maxPhotos={3}
        load="idle"
        fallback={<p>Loading the recording form…</p>}
      />
    </main>
  )
}
```

**On the server.** A Bun loader plugin, registered before the renderer imports
views, finds modules whose first statement is `'use client'`. Their exports
are replaced with stubs. A stub renders:
- a placeholder element;
- the props as JSON in a `<script type="application/json">`, escaped so it
  cannot close the script or inject markup;
- its `fallback` until it mounts, else its `children`. Children are rendered
  on the server and reach the component as `children`, as Next.js passes
  server children into client components (decision 5).

`load` is Crombolo's, not the component's. It is stripped before the props
are serialised:
- `visible` (the default) loads on `IntersectionObserver`;
- `idle` loads on `requestIdleCallback`;
- `load` loads immediately.

Next.js has no such prop; it follows Astro's `client:*` directives.

**Bundling.** Every `'use client'` module the views reach is an entry for
`Bun.build`:
- with code splitting and hashed names;
- at boot, with a watch, in development;
- by `crombolo build` for production, writing a manifest.

A site may point `islands.manifest` at a Vite manifest instead: the same
modules resolve to what Vite built. The server serves the output with
long-lived immutable caching.

**In the browser.** A small loader, added once per page that has an island,
imports each island's module when its `load` condition is met. It renders the
default export with React into the placeholder, replacing the fallback. A
module shared by several islands loads once.

**The boundary.** As in Next.js:
- a server template may import a client component;
- a client component may not import a server-only module:
  `@crombolo/crombolo/server`, `/headers` and `/navigation`, or anything
  importing `@crombolo/crombolo`'s render scope. Doing so is a build error
  naming both files.

**Other frameworks.**

```tsx
import { Island } from '@crombolo/crombolo'

<Island name="species-map" props={{ speciesId }} load="visible">
  <p>Loading the map…</p>
</Island>
```

```ts
// components/client/species-map.ts
import { createApp } from 'vue'
import SpeciesMap from './SpeciesMap.vue'
export default function mount(element: HTMLElement, props: { speciesId: number }) {
  const app = createApp(SpeciesMap, props)
  app.mount(element)
  return () => app.unmount()
}
```

`<Island>` uses the same placeholder, props script, loader and bundling. Its
`name` resolves to `components/client/<name>`, whose default export is a
`mount` function returning an optional unmount.

## Harbourstone's comparison page, as an island

`demo/harbourstone-next` (208) has a whisky comparison page built with
Next.js's own `'use client'`. The TSX `demo/harbourstone`, which Crombolo
renders itself, gains the same page built as an island. It is the worked
example of this story, and shows the two front ends side by side.

- **The page:**
  - Harbourstone gains `comparisonPage` (eyebrow, title, standfirst), as
    harbourstone-next has, and a seed page "Compare" at `/compare`, allowed
    under the home page.
  - `components/pages/comparisonPage.tsx` reads every expression on the
    server: the range under the whisky list, with kind, product type, ABV,
    age, batch, summary, bottle and tasting notes.
  - It renders the page header and `<Compare bottlings={…} />`.
- **The island:**
  - `components/shared/compare.tsx` starts `'use client'`, a React component
    with the same behaviour as harbourstone-next's `web/components/compare.tsx`:
    - pick bottlings from a list filtered by kind and product type, up to four
      side by side;
    - rows aligned, tasting notes by aspect, differences highlighted;
    - a table on wide screens, cards on narrow ones.
  - It uses plain `<a>` and `<img>` (the media URLs carry Crombolo's imaging
    query) in place of `next/link` and `next/image`, and the History API in
    place of Next's router:
    - `?compare=a,b` is pushed on each change, so Back steps through them;
    - `popstate` restores a selection.
- **Before it mounts,** its `children` are the whole range as a plain server
  list of links to each bottling, so the page works, and is indexed, without
  JavaScript. The island takes them over when it mounts. It shows no
  `fallback`.
- **Site setup:**
  - Harbourstone's `package.json` gains React as a peer, as this story's
    decision 3 requires of a site with islands.
  - The scaffold of `demo/harbourstone` installs it.
- **Two copies, not one.** The two comparison components stay separate files.
  Each site ships as its own template, and a component shared between them
  would be a package of its own for one page. They should match, and a test
  checks both pages offer the same rows for the same seed.

## Acceptance criteria

- [x] A component module whose first statement is `'use client'` renders on
      the server as a placeholder, its props in an escaped
      `<script type="application/json">`, and its `fallback`, else its
      `children`, until it mounts.
      Nothing else about the template changes.
- [x] The loader is added once per page however many islands it holds. It
      imports each island's module when its `load` condition (`visible`,
      `idle`, `load`; default `visible`) is met, and renders it with React into
      the placeholder.
- [x] A missing or failing island leaves its fallback and logs to the console
      with the component's file. Nothing else on the page is affected.
- [x] Every island on a page whose module is shared loads it once. Islands
      can sit inside blocks and layouts, and be nested in server markup.
- [x] Props must be JSON-serialisable. A function, a class instance or a cycle
      is a template error naming the component's file and the prop. `load` is
      never passed to the component.
- [x] A client module that imports a server-only entry point is a build error
      naming both files.
- [x] **Bundling:** every reachable `'use client'` module, and every
      `components/client/*` named by an `<Island>`, is bundled with
      `Bun.build`. It is bundled at boot with a watch in development, and by
      `crombolo build` for production, with code splitting and hashed names.
      The output is served with immutable caching.
- [x] **Manifest:** a site may point `islands.manifest` at a Vite manifest,
      and the same modules resolve to the files Vite built.
- [x] `<Island name props load>` mounts a `components/client/<name>` module's
      default `mount(element, props)` function, keeping its unmount for a
      later swap, for Vue, Lit or plain TypeScript.
- [x] `children` reach the component as rendered HTML, and `fallback` and
      `load` never do.
- [x] Crombolo writes no inline executable script, a test holds it to that,
      and a page with islands works under `script-src 'self'`.
- [x] Server-only entry points throw if loaded in a browser.
- [x] `crombolo components check` type-checks client files against React's
      JSX types and server files against Crombolo's.
- [x] `demo/harbourstone` has the comparison page above, built as an island:
      `/compare` lists the range on the server before the island mounts, and
      with the island it compares up to four bottlings, keeping the selection
      in `?compare=` with Back stepping through it. Its rows match
      harbourstone-next's for the same seed. The template still scaffolds,
      seeds and boots through `crombolo init`, and the integration suite's
      Harbourstone site serves `/compare`.
- [x] `docs/writing-components.md`:
  - "Interactive parts" is rewritten around `'use client'`, with `<Island>`
    for other frameworks and the hand-wired pattern kept as the last resort;
  - the Next.js mapping table gains `'use client'`.
- [x] Unit tests cover the loader plugin's detection, stubs, escaping,
      children as fallback, the loader's conditions, bundling, the manifest,
      the boundary error and `<Island>`.

## Implementation (2026-10-29)

- **`packages/render/src/islands.ts`**:
  - `isClientModule`;
  - `serializeProps`, which refuses what JSON cannot carry, naming the path,
    and escapes for a script;
  - `islandStub` and `islandTransform`, the snapshot transform;
  - the island renderer, reached by stubs through
    `globalThis[Symbol.for('crombolo.island')]` so generated code imports
    nothing;
  - `<Island>`, and `withIslandTags`.
- **`islands-loader.ts`:** the loader, written as a function and served as its
  source, so `tests/islands.test.ts` drives it with stand-ins for the browser.
- **The render scope** records that a page used an island. The renderer then
  adds the manifest meta and the loader for the generation it imported from.
- **`ViewSnapshots`** gained `transform`, which writes the stub and keeps the
  source in `.islands/src/`, and `beforeSwap`, which builds before the
  generation is rendered.
- **`packages/server/src/islands.ts`:**
  - `buildIslands` (one `Bun.build`, splitting, the boundary checked from each
    module's source as well as at resolve, since the bundler drops an unused
    import before resolving it);
  - `builtIslandFile`;
  - `viteIslandManifest`, `viteOutDir` and `devServerIslandManifest`;
  - `isServerOnly`.

  `server.ts` serves `/crombolo/islands.js` and `/crombolo/islands/<generation
  | vite | dev>/…`. `config.islands` holds `manifest` and `devServer`.
- **`@crombolo/crombolo/islands-react`** (`mount`) is the one browser entry
  point. React and React DOM are optional peers. `Island` is exported from the
  root. `/server`, `/headers` and `/navigation` throw in a browser.
- **Crombolo's JSX types** recognise a client component, one returning a React
  element, through `JSX.LibraryManagedAttributes`. A template may then give it
  Crombolo children, `load` and `fallback`.
- **`components check`** holds client files and `components/client/*` to the
  boundary instead of importing them.
- **A template's `site.json` may declare `dependencies`,** which its scaffold's
  `package.json` gets. Harbourstone declares React.
- **Harbourstone:** `comparisonPage`, the "Compare" seed page,
  `components/pages/comparisonPage.tsx` (the range as links, as the island's
  children) and `components/shared/compare.tsx` (the island: plain `<a>` and
  `<img>`, the History API). The comparison styles are in `css/site.css`. The
  seed now matches harbourstone-next's.
- **Tests:** `tests/islands.test.ts` (detection, stubs, props, the loader, a
  server site end to end, the boundary, a Vite build, and the two comparisons'
  rows), plus additions to `templates`, `sites` and the integration suite
  (`/compare` and its built code).

**Found while building:**
- Biome cannot select files by their `'use client'` line, so React's lint
  rules do not apply in `components/`.
- There is no Fast Refresh: an edit takes a new generation and a reload.
- The Vite dev-server path is covered by its manifest, not by a running Vite
  server.
