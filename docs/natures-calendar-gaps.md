# Nature's Calendar: what Crombolo still lacks

Nature's Calendar is an Umbraco 7.15 / .NET Framework site being rebuilt on
Crombolo and Crombolo Cloud. Its rebuild plan lives in the site's repository
(`wt-natures-calendar`, `docs/stories/`). This page records what the platform
must still provide for it, as of v0.36.0. It comes from a sweep of the legacy
source (`WT-NC`) against Crombolo's docs and code on 2026-10-29.

Each gap points at a story by number where one exists. Gaps without a number
are not yet written up.

## Already shipped

| Story | What the site gets |
|---|---|
| `206` | Member pages rendered on the server with the site's own logic: `searchParams`, `cookies()`, `redirect()`, `notFound()`, `site()` acting as the visitor, and status pages by path (`site().sql` waits on `189`) |
| `186` | Member and public routes for server bundles |
| `196`, `197`, `204`, `205` | Protected media, cached apart from pages, with group and member grants that inherit |
| `198` | A bundle creates media as the signed-in member: observation photos go in the media library |
| `062`, `063`, `192`, `193` | A bundle is a package, carries the site's code, and can own small tables |
| Cloud `217` | Settings and secrets per environment |

Most of the Umbraco features the legacy site uses also exist already, so they
need no platform work:
- redirects, URL aliases, `umbracoRedirect` and `umbracoNaviHide`;
- public access and scheduled publishing;
- search, `robots.txt`, the 404 page and maintenance pages;
- back-office sections and property editors from a bundle.

## Planned, not built

| Story | What | Blocks on the site |
|---|---|---|
| `189` | A Postgres schema of the site's own, with full SQL | The domain schema, data migration, read models and domain package (021–023, 040) |
| `190` | Import from Umbraco 7 | Content, media and member migration (031, 081) |
| `191` | Azure AD B2C user flows for members | All member work (080–085) |
| `187` | Background and scheduled work for server bundles | Bulk import, exports, the nightly member export (046, 048) |
| `188` | File storage for server bundles | Import batches and error reports. Photos now go to the media library (198), so this need is narrower than the story's context says |
| `199` | Crop URLs with Umbraco's options | Nothing; a convenience |
| Cloud `215` | The site's own server code runs on the platform | Deployment (100) |
| Cloud `216` | The site's own schema is kept with its environment | Deployment (100); waits on `189` |

## New gaps

Ranked by how much each blocks the rebuild.

1. ~~**Pages rendered on the server with the site's own logic**~~ — story
   `206`, shipped. Member pages render on the server with Next.js App Router
   conventions (`docs/rendering.md`, "Server code"). Loading domain data still
   waits on `site().sql` (189).
2. **Members from the site's own code** — story `207`, `site.members`. Registration
   completion writes address, terms and referral source and joins
   "NC Member". The members admin edits members, and the member export pages
   through all 400,000 (`Web/Controllers/Api/UsersController.cs`,
   `NaturesCalendar/Controllers/Api/MembersAdminController.cs`,
   `MembersExport`). The site's own code can do none of this, and the signed-in
   member it sees carries no properties.
3. **Content hooks before a save or publish.** The legacy site refuses some
   species publishes and writes domain rows when content is saved
   (`Services/Cms/SpeciesPublishEventHandler.cs`, `EventSaveHandler.cs`).
   Bundle events fire after the change, once per cluster, with no database.
   Needed for 032. A cross-field validation rule in the schema could cover the
   publish rule alone.
4. **Reading published content from a bundle.** The `documents` capability
   answers a page's URL only. The site needs a species page found by its
   database id, for links and images.
5. **Member events** (created, saved, deleted) for bundles. The legacy site
   pushes back-office member edits to B2C
   (`Services/Cms.Membership/MemberB2CSyncHandler.cs`).
6. **A content type that takes its parent's URL.** Year folders resolve to
   their parent's address (`Web/UnbracoUrlProvider/YearNodeUrlProvider.cs`).
   There is no extension point or schema flag for this. Needed for 033.
7. **CORS for chosen pages and static assets.** B2C loads the site's page
   layouts and fonts from b2clogin.com. Only the Delivery API sends CORS
   headers today. Needed for 085.
8. **Smaller, some possibly Crombolo Cloud's:**
   - configurable security headers on pages (HSTS, frame options, nosniff);
   - a notification on every server when a page is published, for caches a
     bundle keeps;
   - a branded 500 page;
   - export to an APM tool such as Application Insights.

A bundle cannot send e-mail. The site's own code can call an e-mail provider
over HTTPS with its environment secrets, so this is a choice rather than a
blocker, unless bundles should reuse the forms e-mail port.

## Holes in existing stories

- **`190` and `191`: imported members keep their B2C link.** Legacy keeps the
  B2C object id in the `aDObjectID` member property. Neither story turns it
  into an `external_login` row on import. Without that, each imported
  member's first sign-in creates a duplicate member, or forces matching by
  e-mail.
- **`190`: media in Azure Blob.** The legacy media is in a Blob container
  (`Config/FileSystemProviders.config`), not the web root the importer reads.
- **`191`: name and e-mail.** The story maps claims to custom properties. It
  does not say whether the member's own name and e-mail follow B2C.

## The critical path

`189`, `191` and `207` decide whether the application and the member
pages can be built the way the site's plan assumes. The other gaps are smaller,
self-contained additions.
