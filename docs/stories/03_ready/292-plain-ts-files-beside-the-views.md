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

- **The list is one setting.** `createFileSystemPort(componentsDir, { extension: '.tsx' })` in
  `packages/server/src/ports.ts`, with the same call in `bundle-build.ts` and `site-file.ts`.
  The tree, open, save, rename and delete all go through that port.
- **The client assumes one extension.** Partial views are created through the partial-view
  file API with a fixed extension, which the port rewrites from `.cshtml`. A choice of kind at
  creation means a change in the fork.
- **The editor opens everything as `.tsx`.** `tsx-editors.js` names the model `view-<n>.tsx`.
  A `.ts` file needs a `.ts` model, or `<T>x` casts and generics are read as JSX.
- **`listComponents` matches `.tsx` and `.jsx` only.** Whether a saved `.ts` file starts a view
  rebuild and reaches other nodes has not been checked. A module edited in the back office
  must not leave the site running the old code until a restart.

## Decisions (2026-11-07)

- **Part of the existing create menu,** as "Component" or "Module" (the maintainer's naming),
  not a section of its own, so a module sits beside the components that use it. Component is
  the `.tsx` file made today, and Module is new. The choice sets the extension.
- **Word it for the person, not the file type.** The menu says Module, and the `.ts` extension
  shows only in the file's name.
- **`categories.ts` and `dates.ts` stay as they are.** They appear in the list once this ships.

## Acceptance criteria

- [ ] `.ts` files in `components/` appear in the tree, at any depth, beside the views.
- [ ] They open, save, rename, move and delete as a component does.
- [ ] The create menu offers Component or Module, and a module starts from a small blank file.
- [ ] A `.ts` file is checked as `.ts` in the editor, and its relative imports resolve.
- [ ] Saving a `.ts` file rebuilds the views that import it, on every node, with no restart.
- [ ] A module is not offered as a template, or as a component to render.
- [ ] A read-only site says so, as it does for views, and offers no way to try.
- [ ] Bundles, `push` and `pull` carry `.ts` files as they do views.
- [ ] Covering tests, including a browser test that creates a module and imports it from a component.

## Open questions

- **Does anything hide or refuse a `.ts` file today?** `isSafeAlias`, the component checks and
  view generation should each be read before starting.
