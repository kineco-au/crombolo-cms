# Harbourstone demo site — image credits

The Harbourstone site is distributed (`"distribute": true` in its `site.json`), so
it is staged into `@crombolo/cli`'s `templates/` when the CLI is packed, and every
binary in its bundle is **redistributed** to anyone who runs
`crombolo init --template demo/harbourstone`. Each one therefore needs a recorded
source and licence, and `tests/packaging.test.ts` asserts that none is missing
from this file.

| File | Source | Licence | Attribution |
| --- | --- | --- | --- |
| `bundles/demo-harbourstone/blobs/180cc8ef/distillery-from-the-cliff-path.jpg` | Generated with Grok (xAI), 5 October 2026 | No third-party rights | — |
| `bundles/demo-harbourstone/blobs/7b4713f8/copper-pot-stills.jpg` | Generated with Grok (xAI), 5 October 2026 | No third-party rights | — |
| `bundles/demo-harbourstone/blobs/fd337567/casks-in-the-sea-facing-warehouse.jpg` | Generated with Grok (xAI), 5 October 2026 | No third-party rights | — |
| `bundles/demo-harbourstone/blobs/6d8d6398/bottle-the-cove.jpg` | Generated with Grok (xAI), 5 October 2026 | No third-party rights | — |
| `bundles/demo-harbourstone/blobs/68c9cfdf/bottle-brine-and-kiln.jpg` | Generated with Grok (xAI), 5 October 2026 | No third-party rights | — |
| `bundles/demo-harbourstone/blobs/6be45535/bottle-oloroso-pier.jpg` | Generated with Grok (xAI), 5 October 2026 | No third-party rights | — |
| `bundles/demo-harbourstone/blobs/c114b7d8/bottle-neap-tide.jpg` | Generated with Grok (xAI), 5 October 2026 | No third-party rights | — |

These are synthetic images of a distillery that does not exist. They depict no
real place, product or person, and no photographer's work is being
redistributed — which is the question this file exists to answer.

## Where the originals live

`seed/media/` in this site, at the size they ship at, as the seed's media
(story 164): `crombolo init --template demo/harbourstone` copies them into a new
site, and `crombolo bundle build` carries their bytes untouched. Re-encoding an
already-compressed JPEG on every build would lose a little more of the image
each time.

## Adding one

Add a row. The test fails otherwise, which is the point: this is the kind of
thing that is only ever noticed years later. Three ways to fill one in:

1. **A stock source** (Unsplash, Pexels and the like) — record the URL, the
   licence and the photographer, and satisfy any attribution the licence asks
   for.
2. **Generated** — record the tool and the date; nothing further is needed.
3. **Origin unknown** — replace the image rather than ship it.
