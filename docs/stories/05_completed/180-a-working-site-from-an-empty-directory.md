# 180 — A working site from an empty directory, from the command line

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** S
**Depends on:** 163

## Story

As a developer standing a site up from the command line, I want to go from an
empty directory to a published, working site, signed in and checked, without
opening the back office or an editor, so that a site can be built by a script
and the claim that the command line is enough is proven on every build.

## Context

`tests/integration/hello-world.integration.ts` (2026-10-24) walks the journey,
one step per test, through the real CLI on a bare `crombolo init`:

| Step | Command | Today |
| --- | --- | --- |
| Scaffold | `init --name` | works |
| A page type and its view | `types new content-type page --at-root` | works; the type comes with a `title`, and the view shows it |
| Another property | `types add-property page body --type textarea` | works; the view written earlier does not show it, which is fair: a view is the site's own code |
| Check | `types check` | works |
| The home page, with its title | `seed/content/home.toml`, `seed check`, `seed apply` | works since story 163 |
| Publish | `content publish /Home` | works |
| **An image in a media folder** | `media import`, then `media move … --to /images` | **gap: refused**, see below |
| An administrator | `admin reset-password -o json` | works |
| Health | `health` | works |
| Start | `start` | works |
| The page is served | `GET /` | works |
| Sign in | the back office login, with the reset password | works |

A probe that made the page directly in the database got through every step,
so the gaps below were the only ones.

- **Content** was the other gap, closed by story 163 (seed files). Steps 6, 7
  and 12 are tests again.
- **Media folders on a command-line-only site.** A server's boot links the
  built-in Folder type to the other built-in media types
  (`ensureSystemMediaTypes(db, { linkFolderChildren })` in `bootSchema`).
  Nothing on the command line does: not `init`, not `types sync`, and not
  `bootstrapDatabase`, which every command opens through. Until the site has
  been started once, Folder holds only folders. Since story 165 a move is
  refused by the type rule ("`"Image" isn't allowed under "images".`"); a seed
  that puts an image in a folder would be too. `media import` writes through
  the repository, so it does not notice.

## Findings (2026-10-25)

- **Folder is linked in three places today, all after a sync:** `bootSchema`
  with no schema directory, `bootSchema` after the sync (unless a file defines
  Folder), and `bundle build` (`bundle-build.ts`). `installDatabase`, which
  every command and boot open through `bootstrapDatabase`, calls
  `ensureSystemMediaTypes(db)` without `linkFolderChildren`.
- **Linking adds only the built-in types that already exist.** Image and File
  are system types and always exist. Video, Audio, Article and Vector Graphics
  come from the site's files, so they exist only after a sync. Linking at
  `installDatabase` alone would miss a type that a sync in the same process
  creates (`types sync` then `seed apply` in one `start --seed`).
- **The seed already refuses** an image under a folder that does not allow it
  ("a type its parent does not allow"). So the gap shows in `seed check` as
  well as in `media move`.
- **Step 8 as written** imports `to-upload/images/pixel.png`, which makes a
  folder `images`, then moves the image to the root. Story 165's type rule
  refuses the move. The step should move an image into a folder, not out of
  one. `media import` writes through the repository and is not checked.

## Plan

### 1. One helper, run where every command and every sync passes

- `linkMediaFolders(db, schemaDir)` in `packages/server/src/schema.ts`. It
  calls `ensureSystemMediaTypes(db, { linkFolderChildren: true })` unless a file
  under `schema/media-types/` defines Folder, which then says itself what
  Folder allows. It is idempotent, and is a no-op once linked.
- It is called in two places (decided 2026-10-25: at install and after a sync):
  - at the end of `installDatabase`, so every command and boot sees Image and
    File allowed under Folder, schema directory or not;
  - at the end of `syncSchemaDirectory` when it applied, so a built-in type the
    sync just created is linked in the same process.
- The three current calls (`bootSchema` twice, `bundle-build.ts`) go: both
  paths now cover them.

### 2. Tests

- `tests/built-in-media-types.test.ts`:
  - a database opened through `bootstrapDatabase`, never booted, allows Image
    under Folder;
  - after a sync that adds Video, Folder allows Video in the same process;
  - a schema file that defines Folder is left as the file says.
- `tests/cli-seed.test.ts`: a seed with `seed/media/images/pixel.png` passes
  `seed check` and applies on a site that has never been started.
- `tests/integration/hello-world.integration.ts`: step 8 becomes a test. It
  imports `pixel.png` at the root, then `media move /pixel.png --to /images`
  into a folder that `media import` of an empty `images/` made (or that the
  seed made), and asserts the item's parent.

### 3. Docs

- `docs/operations.md`: a short "A site from the command line" section pointing
  at `hello-world.integration.ts` as the worked example, listing its commands
  in order.
- `docs/seeds.md`: media in folders works on a site never started.

## Implementation (2026-10-25)

Built as planned, with one difference:

- **`linkMediaFolders(db, schemaDir)`** is in `packages/server/src/media-folders.ts`.
  It checks for a Folder file by reading the `[media-type]` alias of each file
  under `schema/media-types/`, without loading the whole schema, because
  `installDatabase` runs it on every command.
  - **Where it runs:** at the end of `installDatabase`, and at the end of
    `syncSchema`'s transaction, before the new state is published.
  - **Why the sync links inside its transaction (found with 181):** linking
    after the sync left a window where the new schema state was committed but
    the importing node had not yet moved its own state on. On Postgres a poll
    landed in that window, so the node judged itself behind and drained
    (`tests/schema-import.test.ts`, "the node does not then judge itself
    behind"). Inside the transaction, no node sees the state before Folder.
  - **What went:** the calls in `bootSchema` (both) and `bundle-build.ts`.
- **Step 8 needed no rewrite.** The plan expected its first move, out of
  `/images` to the root, to be refused. It isn't: Image is allowed at the root.
  The step's last move, back into `/images`, is the one that needed Folder to
  hold images. The step is now a test as written.
- **A schema store** (`useSchemaStore`) copies the files down after
  `bootstrapDatabase`. On such a node, install links Folder before the store's
  files are read. The boot's sync then applies a Folder file, if there is one,
  so the file still has the last word.
- **Tests:**
  - `tests/built-in-media-types.test.ts`: a database that has only been
    installed holds images in folders; a sync that adds Video links it in the
    same process; a Folder file is kept as written;
  - `tests/cli-seed.test.ts`: a seed with `seed/media/images/pixel.png` checks
    and applies with no server ever run;
  - `tests/integration/hello-world.integration.ts`: all 13 steps pass.

## Acceptance criteria

- [x] The command line links Folder as boot does, unless a schema file defines
      Folder, so a site never run with `start` holds images in its folders. It
      is done once, in the path every command shares, not per command
- [x] Step 8 of `hello-world.integration.ts` is a test again, not `test.todo`,
      and the whole journey passes in CI (steps 6, 7 and 12 already are, since
      story 163)
- [x] A seed that puts an image in a folder applies on a site never started
- [x] `docs/operations.md` points at the journey as the worked example of a
      site built from the command line
