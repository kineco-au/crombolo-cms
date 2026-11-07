# 292 — Plain `.ts` files beside the views

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As someone building a site in the back office, I want to see, edit and create plain `.ts`
files beside my views, so that the code a component imports isn't hidden from me.

## Context

A view can import a `.ts` file from `components/`, and the code editor resolves it (v0.52.1).
But the back office lists only `.tsx` files, so such a file can be read and changed only on
disk. `sites/crombolo-demo` has two, `shared/categories.ts` and `shared/dates.ts`.

## Findings (2026-11-07)

- **The list is one setting, repeated.** `createFileSystemPort(componentsDir, { extension: '.tsx' })`
  appears in `ports.ts`, `bundle-build.ts` and `site-file.ts`. The tree, open, save, rename and
  delete all go through that port, which takes one extension today.
- **A bundle drops `.ts` files today.** `siteSections` lists `components/` through the same port,
  so a site built into a bundle loses them, and a view importing one then fails. Widening the
  port fixes that too. `sites/crombolo-demo` has two such files, though its template ships as
  files and its bundle is content-only, so it is not broken by this.
- **Rebuilding already works.** `ViewSnapshots` copies and hashes the whole tree, `.ts` included,
  so a changed module makes a new generation on every node. It needs a test, not new code.
- **`listComponents` matches `.tsx` and `.jsx` only,** which is what we want: a module is never
  a template or a component to render, with nothing to change.
- **The client assumes one extension in two places.** Creating and renaming a partial view both
  call `appendFileExtensionIfNeeded(name, '.cshtml')`. Renaming `dates.ts` to `formats` would
  turn it into a `.tsx` file, so rename has to keep the extension the file has.
- **The create menu is built from `entityCreateOptionAction` manifests.** Module is one more,
  and one more workspace route. `partial-view-create-options-modal.element.ts` looks like the
  menu but isn't used, as a browser test showed.
- **The editor opens everything as `.tsx`.** `tsx-editors.js` names the model `view-<n>.tsx`. A
  `.ts` file needs a `.ts` model, or `<T>x` casts and generics are read as JSX. A new file also
  opens at the top level whichever folder it was made in, so its imports show red until saved.

## Decisions (2026-11-07)

- **Part of the existing create menu,** as "Component" or "Module" (the maintainer's naming),
  not a section of its own, so a module sits beside the components that use it. Component is
  the `.tsx` file made today, and Module is new. The choice sets the extension.
- **Word it for the person, not the file type.** The menu says Module, and the `.ts` extension
  shows only in the file's name.
- **`categories.ts` and `dates.ts` stay as they are.** They appear in the list once this ships.

## Acceptance criteria

- [x] `.ts` files in `components/` appear in the tree, at any depth, beside the views.
- [x] They open, save, rename, move and delete as a component does.
- [x] The create menu offers Component or Module, and a module starts from a small blank file.
- [x] A `.ts` file is checked as `.ts` in the editor, and its relative imports resolve.
- [x] Saving a `.ts` file rebuilds the views that import it, on every node, with no restart.
- [x] A module is not offered as a template, or as a component to render.
- [x] A read-only site says so, as it does for views, and offers no way to try.
- [x] Bundles, `push` and `pull` carry `.ts` files as they do views.
- [x] Covering tests, including a browser test that creates a module and imports it from a component.

## Plan

1. **Server:** the port takes `also: ['.ts']` beside its stored extension, and one
   `createComponentsPort(dir)` replaces the three calls. A name ending `.tsx`, `.ts` or `.cshtml`
   is accepted, and the other two still turn into `.tsx`.
2. **Bundles:** a test that a built bundle carries `components/shared/*.ts`, and that applying it
   writes them. Check `load.ts` and `bundle-sections.ts` accept the path on the way in.
3. **Fork, creating:** the create menu says Component (today "Empty component", in
   `branding/localization-en.js`), Component from snippet, Module and Folder. Module opens `create/parent/:entityType/:parentUnique/module`, with the starter below,
   and the data source saves it with `.ts`.
4. **Fork, renaming:** rename keeps the file's own extension when none is typed.
5. **Fork, the workspace:** a module hides Insert, which only makes sense in markup. The tree shows
   it with its own icon, and the partial view picker doesn't offer it.
6. **Editor:** `tsx-editors.js` opens a `.ts` file on a `.ts` model, and a new file in the folder
   it is being made in, read from the address. `editor-types` needs no change.
7. **Tests:** the port, in `tests/file-system*.test.ts`; rename keeping `.ts`; a generation changing
   when a module changes; a bundle carrying one; and a browser test that creates a module, imports
   it from a component and sees the page change without a restart.
8. **Docs:** `docs/writing-components.md`, `docs/backoffice-hosting.md`, release notes. Then
   `bun run fork:pin` and `bun run vendor:backoffice`.

A module starts as:

```ts
/** What this module does. */
export function myModule() {}
```

No migration. Steps 3 to 5 are the bulk of it, all in the fork.

