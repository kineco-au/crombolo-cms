# 285 — An import tells the other nodes what it changed

**Epic:** O — Building a site · **Priority:** should · **Size:** S
**Depends on:** —

## Story

As someone running a site on several nodes that share a folder, I want an import run
from the command line to reach every running node, so that the new views, stylesheets
and public files are served without restarting anything.

## Context

Nodes learn of a change through cache instructions. A template saved in the back office,
or a push through the running server, refreshes the view snapshot and appends a
`components` instruction, and the other nodes follow it (`server.ts`, `onViewsChange`
and `onApplied`).

`crombolo content import` does neither when it runs in its own process, as a cron job, a
container or a one-off task does. It writes the files and commits, and nothing tells the
running nodes:

- **Views** are not re-snapshotted until something else moves them.
- **`public/`** (284) is listed at boot and watched with `fs.watch`. A watcher sees
  nothing another machine writes to a network file system, such as NFS, so a new file
  answers 404 and a replaced one keeps an old index until the node restarts.

Restarting is not the answer: an import should not take a site's nodes down.

## Decisions before implementation

- **An import appends the instructions.** After it commits and swaps its sections,
  `installBundleContent` appends a `components` instruction when views, stylesheets or
  scripts changed, and a new `public-files` instruction when `public/` changed, in the
  same way `onApplied` does. Nothing is appended for a section that did not change.
- **A node handling `public-files` lists the folder again,** through the same path as a
  watcher's rescan. The watcher stays, for a developer's own disk.
- **A node that misses one catches up.** Instructions are read from a position it keeps,
  and one further behind than the log holds re-lists the folder on the cold path every
  other cache takes.
- **The instruction carries no file names,** only the fact, as the others do.

## Acceptance criteria

- [x] An import in its own process that changes a view reaches a running node without a
      restart.
- [x] One that adds, replaces or removes a `public/` file is served, or answers 404, on a
      running node within the poller's interval, with `fs.watch` not firing. A file that
      the shared folder shows late is still picked up by a later re-listing.
- [x] A stylesheet and a script from such an import are served as changed, at the plain
      address and at the address `asset()` writes.
- [x] An import that changes no files appends no instruction.
- [x] A replace that only removes files counts as a change.
- [x] A node that fell behind the log re-lists `public/` and hashes its stylesheets and
      scripts again.
- [x] A revert from the command line tells the nodes as an import does.
- [x] An import from the back office or a bundle install reaches the node that ran it.
- [x] Covering tests with two nodes sharing a folder and a separate import process, on
      SQLite and Postgres.
- [x] `docs/operations.md` and `docs/rendering.md` say so, and the release notes say what
      changed.

## Technical notes

- `packages/server/src/bundle-install.ts`, `installBundleContent`: where the sections are
  swapped.
- `packages/server/src/server.ts`: `onApplied` and `onViewsChange` show the announcing,
  and the poller is where `public-files` is handled.
- `packages/server/src/site-public.ts`: `PublicFiles` keeps a private rescan, which needs
  a public way in.
- `SiteAssets` hashes stylesheets and scripts at boot and follows `fs.watch` too, so
  `asset()`'s hashes go stale the same way. A `components` instruction must refresh it.

## Findings (2026-11-07)

- **Stylesheets and scripts have the same gap.** The plain address reads the disk, but
  `asset()` answers from `SiteAssets`, which only a watcher updates. Without one it keeps
  the old hash, and that address answers 404 until a restart. `SiteAssets` needs a rescan
  too, which also has to drop a file that has gone.
- **A nested folder moved in may not be hashed.** `#hash` is handed the folder's name and
  skips it. This comes from reading the code, not from a test. A rescan covers
  it on this path, and the watcher path can use the same rescan.
- **An instruction can arrive before the shared folder shows the file.** NFS clients cache
  directory listings and file attributes, by default for up to 30 to 60 seconds, so a
  single re-listing can see the old folder and never look again. `ViewSnapshots.announce`
  already keeps looking for 20 seconds for this kind of reason, and its unannounced checks
  catch the rest.
- **`components` is the only kind with no checkpoint,** tested by name in
  `appendCacheInstruction`, and the poller decides what to hand on by `checkpoint`. A new
  kind has to join that test, `CacheInstructionKind` and `instructionEffects`.
- **A node not yet upgraded treats `public-files` as unknown:** it empties its page and
  media caches. That is slower for a moment during a rolling upgrade, and never wrong.
- **A node skips its own instructions** by `created_by`. If an install signed with
  `config.nodeId`, a node running an import in-process would skip it.
- **The back office's import never refreshed views.** `transfer-dashboard`'s `onApplied`
  and the marketplace's `applyContent` only drop caches. Announcing from
  `installBundleContent` fixes both.
- **Replace removes files `plan.files` does not list,** and `plan` is undefined for a bundle
  that carries no sections, so "changed" cannot come from the plan alone.
- **`bundle revert` has the same gap,** through `revertSections` and `restoreSectionFiles`.
- **Missing a `components` row leaves no trace.** They have no checkpoint, so `#follow`'s
  gap test cannot see one. Instructions are pruned after 24 hours.
- **`core.ts` starts the poller before `server.ts` builds `PublicFiles`,** and a Postgres
  notification can wake it at once.

## Decisions (2026-11-07)

- **A new `public-files` kind** (the maintainer's choice, over a flag on `components`), so
  the log says what changed and a public change never touches views.
- **`components` also makes a node hash its stylesheets and scripts again,** with no new
  flag. It is a handful of small files, and template saves are rare.
- **A re-listing repeats.** On `public-files`, a node lists the folder at once and again at
  5, 15, 30, 60 and 90 seconds, and a new announcement restarts the schedule. This is a
  short catch-up after an announcement, not polling `public/` on a timer.
- **Instructions are signed `import:<nodeId>`,** so the node that ran the import follows
  them too.
- **Revert announces, as an import does.** It is a few lines and leaves the same gap open.
- **Falling behind is seen from the oldest row.** If the oldest instruction is past this
  node's cursor, rows it never read were pruned, so it looks at everything again. A false
  alarm costs one listing. Pruning always keeps the newest row, so the log is never empty.
- **Announcing never fails an import.** The files are in place by then, so a failed append
  is a warning that says to restart the nodes or import again.

## Plan

1. **The kind.** In `packages/data/src/cluster.ts`, `public-files` joins
   `CacheInstructionKind`, takes no checkpoint, and leaves pages and media alone in
   `instructionEffects`. No migration: `kind` is a `varchar(50)`. Add
   `oldestCacheInstructionId`.
2. **What changed.** `changedFileSections(config, carried, plan, { replace, withoutFiles })`
   in `bundle-sections.ts` answers from `plan.files`' actions, plus a replace's removals,
   before the swap moves anything.
3. **Announcing.** `announceFiles(db, config, sections)` beside it appends `components` when
   components, styles or scripts changed, and `public-files` when `public` did, signed
   `import:<nodeId>`, after `swapSections`. It reports a failure rather than throwing.
   `installBundleContent` and `revertSections` both call it.
4. **Following.**
   - `onInstruction` in `core.ts` gains `public-files`, through a new `hooks.onSiteFiles`
     that `server.ts` sets, with `?.` for the gap before `PublicFiles` exists. A worker has
     neither, so nothing happens there.
   - `components` also calls it for stylesheets and scripts.
   - A boot listing happens anyway, so an instruction in that gap loses nothing.
5. **Rescans.**
   - `PublicFiles.changed()` lists now and runs the repeating schedule, stopped by
     `close`. The private rescan the watcher uses stays debounced.
   - `SiteAssets.rescan()` rebuilds its map, dropping files that are gone. The watcher
     calls it when it is told of a folder.
6. **Falling behind.** `#pollOnce` compares `oldestCacheInstructionId` with its cursor and
   calls a new `onMissed` option, wired to the same work as both instructions plus
   `snapshots.announce()`.
7. **Docs.** `docs/operations.md` gains a section on nodes sharing a folder, including NFS
   caching and the 90-second limit. `docs/rendering.md`'s watcher note changes, and the
   release notes say what changed.

### Tests

- New `tests/import-reaches-nodes.test.ts`: two servers on one database and folder, and an
  import through the CLI in its own process, on SQLite and Postgres. A shared SQLite file
  needs a real file rather than `:memory:`.
- `fs.watch` must not fire, so the servers run with `watchSiteFiles: false`. Otherwise a
  local disk would pass without the fix.
- A view, a stylesheet by both addresses, a script, and a public file added, replaced and
  removed.
- A file written after the instruction arrives, for the repeating re-listing.
- No change, no instruction; a replace that only removes; a revert.
- An in-process import reaching its own node, in `tests/transfer-dashboard` or nearest.
- `instructionEffects` for the new kind, and no checkpoint, in the cluster tests.
- The poller's `onMissed` with pruned rows, and with an ordinary rollback gap in ids.
- `SiteAssets.rescan` with a removed file and a nested folder, in `tests/hashed-assets.test.ts`.

### Risks

- **A shared folder slower than 90 seconds** misses the re-listing, and needs a restart or
  another import. The docs will name the mount options that matter.
- **An instruction appended and then lost** when the database fails just after a swap leaves
  the nodes stale. The warning says so.
- **Several imports in a burst** re-list on the restarted schedule, bounded by how often
  imports run.

## Implementation (2026-11-07)

- `announceFiles` and `changedFileSections` are in `bundle-sections.ts`, and
  `installBundleContent` and `revertSections` call them after the swap.
- `PublicFiles.changed()` lists now and at 5, 15, 30, 60 and 90 seconds.
  `SiteAssets.rescan()` rebuilds its map.
- `createServer` takes `watchSiteFiles: false`, for a node that hears only through
  instructions. The tests use it, so a local disk cannot pass without the fix.
- `asset()` is one resolver per process, so two nodes in one test process share it. The
  tests poll both before reading either; in production each node is its own process.
- A whole-site replace removing a file is covered by `changedFileSections`' own tests, not
  by the two-node test, which applies a bundle.
- Real NFS was not tested. The late-file case is simulated by writing after the node is
  told.

## Out of scope

- Changing how files are shared between nodes.
- Polling `public/` on a timer.
- Other commands that write these files, such as `assets new` and `components new`, which
  are for a developer's own disk.
