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

## Acceptance criteria

- [ ] The command line links Folder as boot does, unless a schema file defines
      Folder, so a site never run with `start` holds images in its folders. It
      is done once, in the path every command shares, not per command
- [ ] Step 8 of `hello-world.integration.ts` is a test again, not `test.todo`,
      and the whole journey passes in CI (steps 6, 7 and 12 already are, since
      story 163)
- [ ] A seed that puts an image in a folder applies on a site never started
- [ ] `docs/operations.md` points at the journey as the worked example of a
      site built from the command line
