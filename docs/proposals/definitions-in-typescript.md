# Definitions in TypeScript

**Status:** proposed · **Date:** 2026-11-21

Replace every TOML file a site holds with a TypeScript file in a restricted form,
read and never run, so that views are checked against their types by the compiler
and a save from the back office keeps the file's comments.

## The problem

Type, view and page are three things, in Umbraco and here. Agents now do most of
the development, and the question was whether a simpler design would suit them.

What costs an agent, or a person, is not the count of three. It is that the link
between a type and its views is unchecked:

- **A view can read a property its type no longer has.** Views are typed only
  through `schema/content-types.d.ts`, which `crombolo generate` writes and nobody
  is made to re-run (`docs/rendering.md`, "Typed pages"). Nothing says so until the
  page renders.
- **References are strings.** A property's data type, a composition, a workflow's
  approver group: a wrong one is found at validation, not while editing.
- **Comments are lost on a save.** No TOML writer keeps them, which is why the
  format carries `notes` (`docs/schema-as-code.md`, "Format: TOML").

Much of what a redesign would want already exists: types, forms and workflows are
files, the back office writes them, and views are TSX. So this is a change of
format, not of architecture.

## The proposal

### Type, view and page stay

A type keeps naming its views (`components`, `defaultComponent`) and a page picks
one. Many views of one type share one declaration of its properties, so none is
retyped. Shared markup is a component that takes the properties it uses.

### A type is a TypeScript file in a restricted form

One per file, in today's folders; the exported name is the alias.

```ts
// schema/content-types/blog-post.ts
import { contentType, textstring, richtext } from '@crombolo/crombolo/schema'
import { personPicker } from '../data-types/person-picker.ts'
import { seoFields } from './seo-fields.ts'

export const blogPost = contentType({
  name: 'Blog Post',
  icon: 'icon-edit',
  variesByCulture: true,
  compositions: [seoFields],
  components: ['pages/blogPost', 'pages/blogPostCard'],
  defaultComponent: 'pages/blogPost',
  tabs: [
    {
      name: 'Content',
      properties: {
        // Shown as the page heading
        title: { type: textstring, name: 'Title', mandatory: true, siteSearch: 'high' },
        body: { type: richtext, name: 'Body' },
        author: { type: personPicker, name: 'Author' },
      },
    },
  ],
})
```

- **The form:** imports, and one exported call to `contentType`, `mediaType`,
  `memberType` or `dataType` whose argument is literals, arrays, object literals and
  imported names of other definitions. No functions, computed values, spreads or
  conditionals. The vocabulary is today's, in camelCase.
- **Read, never run:** the CMS reads the file's syntax and never imports it. A type
  arriving in a bundle, a change or a workspace stays data, and reading one cannot
  run a stranger's code. The helpers exist for the compiler and completion only.
- **Outside the form is refused,** naming the file, the line and what is allowed, by
  `types check --static` and by boot. Every type that loads can therefore be shown
  and edited as a list.
- **A reference is an import:** data type, composition, allowed child, block element.
  A missing one is a compile error and a rename is a refactor.
- **The same model underneath:** the reader gives the `SchemaSet` the TOML reader
  does, so sync, validation, hashing, versions, `since`, keys and what a change costs
  are unchanged. Comments and layout do not change the hash.

### A save edits the file in place

One writer for the type editors, the CLI (`types new`, `property add`, `update`,
renames) and a hosted site's schema landing in its checkout. An edit touches its own
node, so comments and hand-made order survive. A new file is written canonically. A
rename renames the export, the file and every import, and records itself so stored
values follow; a hand edit that renames says so the same way, or the check sees a
removal and an addition.

### A view is typed from the type it names

```tsx
// components/pages/blogPost.tsx
import type { PageProps } from '@crombolo/crombolo'
import type { blogPost } from '../../schema/content-types/blog-post.ts'
import { Layout } from '../shared/layout.tsx'
import { Byline } from '../shared/byline.tsx'

export default async function BlogPost(props: PageProps<typeof blogPost>) {
  const { model, culture } = props
  const tags = model.value('tags') ?? []     // string[] | undefined, no cast
  return (
    <Layout {...props}>
      <article>
        <Byline page={model} culture={culture} />
        <h1>{model.text('title')}</h1>       {/* 'titel' would not compile */}
        <div class="prose">{model.html('body')}</div>
      </article>
    </Layout>
  )
}
```

- **A second view of the same type** takes the same `PageProps<typeof blogPost>` and
  redeclares nothing.
- **A partial asks for properties, not a type:**
  `PublishedContent<{ publishDate: string; author?: PublishedElement[] }>` accepts any
  type that has them.
- **Blocks and Library elements** are typed the same way (`BlockProps<typeof heroBlock>`).
- **`types check` type-checks the views.** `generate` stops writing
  `content-types.d.ts`; `generate --delivery` stays for apps outside the site.
- The import is type-only and erased when the view is compiled.

### Design and Source in the back office

The type editor gets a switch between *Design*, today's editor, and *Source*, the
file's text and path. Both edit the same file; a save from Source is checked and
refused with the line when it is outside the form. Read-only where code is locked
(`391`, `388`); the workspace's copy in a workspace (`376`). Data, media and member
types, forms and workflows get the same switch.

### Everything else a site holds, in the same form

- **Set-up:** `schema/schema.ts`, `languages.ts`, `relation-types.ts`,
  `user-groups/*.ts`, `webhooks/*.ts`, and `domains.ts` at the root. Values that
  differ per environment are named by key (`387`).
- **Forms and workflows are code** (decided 2026-11-21: both change with a deploy or
  a change, not on the serving site): `schema/forms/*.ts`, `schema/workflows/*.ts`.
  Logic is named, never written, in the file: a validator or a submit step is a
  function elsewhere. A handler is typed by its form (`FormEntry<typeof contact>`),
  and a workflow imports the types it covers and the groups that approve.
- **Content files:** pages, Library items, media sidecars and the dictionary, typed
  by their content type.

  ```ts
  // content/pages/home.ts
  import { page } from '@crombolo/crombolo/content'
  import { homePage } from '../../schema/content-types/home-page.ts'

  export default page(homePage, {
    name: { 'en-US': 'Home', 'es-ES': 'Inicio' },
    values: { 'en-US': { title: 'Crombolo' } },
  })
  ```

### No TOML left

Both formats load while sites convert; then the readers, writers and every mention
go. `bunfig.toml`, Bun's own file, is the one exception.

## Alternatives considered

- **One file per kind, fields and render together** (collapsing type and view).
  Dropped: a type has many views, and the back office needs the type as a thing of
  its own to list and edit.
- **Forms as content, workflows as code.** Considered because editors often make
  forms on the live site. Not chosen: both as code.
- **A data file (JSON or YAML) with generated types.** Round-trips trivially, but
  keeps the generation step and loses or mangles comments.
- **Declaration files (`.d.ts`), a type as an interface of literal types.** The
  language itself forbids code, and a view writes `PageProps<BlogPost>`. But typos
  stop being caught (no excess-property check on an interface), completion is worse,
  `skipLibCheck` hides errors inside `.d.ts`, type-level programming still needs
  refusing, and content files would need the value form anyway, giving two styles.
- **Keep TOML and close the gap** (the cheap alternative): run `generate` on every
  schema change in development and make `types check` type-check the views. One
  story. It gives the checked views and nothing else on the list of pros.

## Pros and cons

**Pros**

- Views are checked against types with no step in between.
- References are imports: checked by the compiler, renamed by a refactor.
- Comments survive a back-office save.
- One language and one error list for an agent.
- Seed content is checked before it is imported.

**Cons**

- A large migration for a change of format: about 460 TOML files, some 200 test
  files and 76 source files that name TOML, bundles, change bundles, the schema
  store and the public package.
- Reading gets harder: Bun parses TOML natively; TypeScript needs a syntax parser at
  run time and a subset checker maintained from then on.
- "TypeScript you may not program in" needs explaining; TOML cannot be misused.
- Noisier to edit by hand for a non-developer, content files most of all.
- A line-by-line merge can leave a file that does not parse.
- Breaking for everything outside the repository: sites convert, old bundles and
  changes stop applying, and the Umbraco converter in Crombolo Cloud moves in step.

## Recommendation

Try the cheap alternative first: it is one story, gives the most valuable benefit
and blocks nothing. Go on to the full switch if comments, references as imports and
typed content prove worth the migration. If the switch goes ahead with less scope,
content files are the part to leave out: most of the file count, least of the gain.

## Open decisions

- **Whether to do it at all,** and whether the cheap alternative goes first.
- **Whether content files are in scope.**
- **What reads the syntax:** the TypeScript compiler's parser as a run-time
  dependency, or a lighter parser shown to cover the form. Bun exposes no syntax tree.
- **`notes`:** retired now that comments survive, or kept because the editor shows it.
- **Tabs holding their properties,** or a flatter form with the tab named on each.
- **Source: editable or read-only at first,** and under which permission.
- **How large exports are checked** without the compiler importing thousands of pages,
  and whether long HTML is a template literal or a file beside the page.
- **How long both formats load:** one release to convert in, or convert before
  upgrading.

## Outline of the work

Eleven pieces, in dependency order. Sizes are estimates.

| | Piece | Size | Needs |
|---|---|---|---|
| A | The format and its reader, for content, media and member types and data types; both formats load | L | — |
| B | The in-place writer, used by the editors and the CLI | L | A |
| C | Views typed from the definition; `types check` checks them | M | A |
| D | Design and Source in the back office | M | A, B |
| E | Languages, version, URL settings, user groups, webhooks, relation types, domains | M | A, B |
| F | Forms and workflows, with typed entries | L | A, B |
| G | Content files: pages, Library, media sidecars, dictionary | L | A |
| H | Carriers: workspaces and their merge, changes, change bundles, bundles, the schema store, a hosted site's checkout | M | A, B, E, F, G |
| I | Converting a site with one command, and this repository's sites, templates and fixtures | L | A, C, E, F, G, H |
| J | The public package's writers, for tools outside the CMS | M | A, C, E, F, G |
| K | TOML removed, with a check that keeps it out | M | all |

Notes for whoever cuts the stories:

- **H:** carriers class a file by folder and kind, not extension, since a type's file
  is schema and a view is code and their permissions differ (Apply changes, Install
  code). A merge whose result does not read is a conflict, never a broken Shared.
  Story `392` names `.toml` paths and should be read against F and H.
- **I:** `crombolo upgrade definitions`, with `--dry-run`. The schema hash is equal
  before and after, so the next boot syncs nothing. Comments are carried where they
  can be placed. A view listed on one type is typed, and each view that then fails
  the check is reported; a view of several types is left untyped and listed.
- **J:** the Umbraco converter left this repository in `279` and writes through
  `@crombolo/crombolo/transfer` (`278`). The same exports would write TypeScript, and
  a scaffolded view would be typed. The converter's own change is made where it
  lives; a fixture of converter-shaped output kept here would stop the writers
  breaking it unnoticed. The subpath has a compatibility promise, so what changes
  for a caller is listed in the release notes.
- **K:** a site, bundle or change still holding TOML is refused, naming the files and
  the last release that converts them.
