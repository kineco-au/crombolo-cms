# 177 — A host's own bundles stay with the host

**Epic:** K — Moving content · **Priority:** should · **Size:** S
**Depends on:** 063, 104

## Story

As someone who runs crombolo for other people's sites, I want to mark the
bundles my installation provides as mine, so that a site exported from it
neither names them nor needs them, and its owner can take the site anywhere
and start it with a plain CMS.

## Context

A whole-site file (104) records the server bundles the site wires in its
manifest's `requires`, by package name and version
([`../../content-transfer.md`](../../content-transfer.md)). An import refuses
while one is missing or older (`requiresProblems`, `site-replace.ts`). That
is right for a bundle the site's owner chose: the site does not work without
it.

It is wrong for a bundle the **host** provides: an editing tool, an
integration with the host's own services, or a private package that was never
published. All of these are wired in the host's `crombolo.config.ts` for
every site it runs, and none of them belong to any one site.

- **The file leaks the host's packages:** every export, pull (107, 108) or
  `crombolo export --site` names them and their versions, including ones that
  are private.
- **The site can't be moved:** importing the file anywhere else, a laptop
  included, is refused with "the file needs `<package>@<version>`, which this
  site does not have", for a package the owner never chose and often cannot
  install.

The **code** of a bundle never travels in a site file, and nor do the tables
it owns (062). Only the name and version reach the manifest. What a host
bundle *produces* (components, styles, schema, content) is the site's own, and
travels as it does today.

## Decision

**The host declares what it provides, in its config:**

```ts
export default defineConfig({
  bundles: [hostTool(), siteBundle()],
  hostProvided: ['@host/tool'],
})
```

- **Package names**, not bundle objects, so one list covers a server half
  wired under `bundles` and a backoffice-only extension discovered from the
  site's `package.json`.
- **Set by whoever runs the installation,** which is where the decision
  belongs.

**Considered and not taken:** a bundle marking itself (for example,
`"crombolo": { "portable": false }` in its own `package.json`). It works
wherever the bundle is installed, but then the bundle decides rather than the
host, and one package can be the host's in one installation and a site's own
choice in another.

## Acceptance criteria

- [ ] **`hostProvided`** (a list of package names) in `defineConfig`, with no
      environment variable, as `bundles` has none. A name that is neither
      wired nor discovered is logged once at start, not refused, so a host can
      list a bundle it is rolling out.
- [ ] **Export:** a whole-site file's `requires` leaves out every
      host-provided package. Every path that writes one is held to this:
      `crombolo export --site`, the remote protocol's pull, and the
      operations `site.export`.
- [ ] **Import:** unchanged for files that don't list them. A file written
      before this story that does name a host-provided package imports on the
      host that provides it, which has it installed, as today.
- [ ] **The round trip is tested:** a site wiring one host-provided bundle and
      one bundle of its own exports a file whose `requires` names only the
      latter, and that file starts a site (105) on an installation that has
      only the latter installed.
- [ ] **Nothing else in the file names a host-provided package:** its
      manifest and `package.json` are checked in the same test.
- [ ] **Docs:**
  - [`../../configuration.md`](../../configuration.md) gains `hostProvided`;
  - [`../../content-transfer.md`](../../content-transfer.md)'s `requires` row
    says host-provided packages are left out;
  - [`../../bundles.md`](../../bundles.md) gains a paragraph on bundles a host
    provides.

## Out of scope

- **Making a host bundle's output render without it.** A host whose tool
  writes components that import the tool has made the site depend on it; the
  rule for such a tool is to write self-contained files. This story only
  stops the file claiming a dependency the site does not have.
- **The backoffice Packages builder (063),** which builds what a person picks
  and never adds `requires`.
