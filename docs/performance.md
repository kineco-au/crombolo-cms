# Performance: the published cache

How the published cache behaves as a site grows and is published to, what it
is measured against, and when a different topology is the right answer (story
`175`). The benchmark itself, and how to run it, is in
[`testing.md`](testing.md), "Large-site budgets".

## What a change drops

Each node holds one **snapshot** of the published site: every published
document in every culture, its routes, navigation, the Library's elements,
domains and the redirect rules. Media is cached apart from it (story `197`).
Pages render from the snapshot; a change that could alter one drops it, and
the next read builds it again in full.

| Change | Drops | Where |
| --- | --- | --- |
| Publish, unpublish, move, delete, sort, restore or copy a page | the whole snapshot | `content-operations.ts` (`onChange`), and every other node through a `content` cache instruction |
| Publish or change a Library element | the whole snapshot | as a page |
| Change a page's domains or a hostname | the whole snapshot | `content-operations.ts` (`afterDomains`), `server.ts` |
| A redirect rule written, from a moved page or by hand | the whole snapshot, after the routes are read | `redirects.ts` |
| The address settings | the whole snapshot | `url-settings.ts` |
| The schema (a content type, a property) | the whole snapshot, and the media cache | `server.ts` (schema watch, `schema` cache instruction) |
| A content bundle or transfer applied | the whole snapshot, and the media cache | `server.ts` |
| A scheduled publish | the whole snapshot | `jobs.ts` (`onContentChanged`) |
| A media item | the media cache's entry only; the snapshot is kept and marked as covering the change | `server.ts` (`covered`) |
| A view or component edited | nothing in the cache: a new views generation | `server.ts` (`components` instruction) |

What depends on what a page change drops, so a targeted update would have to
recompute it too: the page's routes in every culture and those of every
descendant (a move or a rename), its parent's and siblings' navigation, any
page whose pickers, links or block lists name it, the domains above it that
pick its root and culture, and the redirect rules tracked from its old routes.

A rebuild reads in slices of 500 and looks each content type up once (story
`086`). The request that starts a rebuild waits for it; requests that arrive
while it runs are answered from the previous snapshot, so a visitor never waits
for a rebuild another request started (story `175`). Before the first build
there is no previous snapshot, and they share the one build. A request that
changes content (anything but `GET` and `HEAD`) is answered only once the
rebuild it caused has finished, so the editor who published sees the change at
once; for the rebuild's length other visitors may still see the previous
version, as a node of a cluster does until it next polls. Changes made while a
build runs share one build after it, rather than each starting a build of its
own. A build that a later change overtook is not kept (story `174`).

## Measured workloads

`tests/load/large-site.bench.ts` at three sizes (`CROMBOLO_BENCH_SIZE`):

| Size | Pages × cultures | Media | Budgets: memory / rebuild | Runs |
| --- | --- | --- | --- | --- |
| Small | 1,000 × 1 | 200 | 100 MB / 1 s | every release, both engines |
| Medium | 25,000 × 3 | 1,000 | 300 MB / 5 s | every release, both engines |
| Large | 100,000 × 3 | 10,000 | 1 GB / 20 s | weekly and on demand (`bench-large.yml`) |

Every size shares the render budgets: 20 ms p95 for a warm render, a render
during a rebuild, and renders through sustained and burst publishing; a cold
render after a publish, unpublish or move within the rebuild budget plus 50 ms.
A run fails only past twice a budget.

Measured 2026-10-30 in the Docker test services on a developer machine (8 GB
for Docker), with a library of 2,000 items and 100 uploads. SQLite is a file in
the checkout's `output/`, which Docker mounts from the host; that is slower to
read than a disk of the container's own, and it is most of the SQLite rebuild's
time at Medium. Medium on Postgres is from the run before a rebuild gave the
thread up, but for its render during a rebuild:

| p95 ms unless named | Small SQLite | Small Postgres | Medium SQLite | Medium Postgres |
| --- | --- | --- | --- | --- |
| tree root / children / siblings | 2 / 2 / 3 | 5 / 5 / 6 | 3 / 13 / 8 | 8 / 9 / 11 |
| cache memory (MB) | 2.8 | 2.6 | 151 | 149 |
| rebuild peak (MB) | 2.8 | 2.6 | 299 | 261 |
| cache rebuild | 13 | 19 | 2,548 | 715 |
| page render | 0.9 | 1.4 | 1.4 | 4.4 |
| render during rebuild | 1.0 | 2.7 | 0.7 | 3.9 |
| queries per slice of 500 | 5.7 | 5.7 | 2.2 | 2.2 |
| cold render after publish / unpublish / move | 2 / 2 / 2 | 3 / 17 / 23 | 3 / 597 / 662 | 402 / 1,123 / 1,265 |
| renders while publishing | 0.7 | 1.0 | 0.7 | 3.7 |
| renders in a burst | 0.7 | 1.3 | 0.9 | 5.1 |

The whole snapshot is kept: at Medium it takes 150 MB and rebuilds well within
its budget, and memory stays flat through two minutes of publishing under load.
A rebuild gives the thread up every 250 pages, so a render waiting on it gets
its turn: SQLite reads without ever giving it up otherwise, and assembling the
snapshot is work in memory on either engine. Large is measured by the weekly
workflow; its output is kept as that run's artifact.

## Supported workloads and resources

- Up to Medium (25,000 pages in three cultures) on one node, on either
  engine, with 1.5 GB of memory for the process: Medium measured 870 MB
  resident at its peak.
- Large (100,000 pages in three cultures) is sized by the weekly run rather
  than here; expect about four times Medium's cache and a rebuild of seconds,
  through which visitors are served the previous snapshot.
- Past that, or with publishing so frequent that rebuilds run back to back,
  run several nodes on Postgres behind a load balancer (story `185`) and
  move background work to a worker (story `223`, [operations](operations.md)).
