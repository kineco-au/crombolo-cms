# 190 — Import from Umbraco 7

**Epic:** H — Importing a site · **Priority:** should · **Size:** L
**Depends on:** 070, 071

## Story

As the owner of an Umbraco 7 site, I want `crombolo import umbraco` to read it,
so that leaving a version Umbraco no longer supports does not mean re-keying the
site.

## Context

The importer reads Umbraco 15–18 (`docs/umbraco-import.md`). Umbraco 7 reached end
of life in 2023 and many sites still run it; they are the ones most likely to
move, and Crombolo Cloud's "Try your Umbraco site here" (`crombolo-cloud` 100)
courts them. Umbraco's own route out of 7 is a migration to 8 and then on, with
each package migrating separately.

Raised by Nature's Calendar (`wt-natures-calendar` story 016), an Umbraco 7.15
site, where reusable v7 support was chosen over a one-off script (2026-10-27).

Umbraco 7 differs in kind: published content as XML in `cmsContentXml`, values in
`cmsPropertyData` by data type, members in `cmsMember` with properties alongside,
media paths in values, and package editors storing their own JSON or CSV.

## Decisions before implementation

- **Which editors.** The core set (textstring, textarea, rich text, true/false,
  numeric, date, dropdowns, content and media pickers, MNTP, image cropper, tags,
  Grid) and the most common packages (Nested Content, Our.Umbraco.MultiUrlPicker /
  RJP.MultiUrlPicker). Anything else is reported, with the raw value
  kept for a site to convert.
- **The Grid.** To Block Grid, with one element type per grid editor, as the
  existing importer handles a v15+ grid; or a rich-text fallback.
- **Members' passwords.** Umbraco 7's membership hashing; carried when the hash
  can be verified, otherwise members are marked to reset.

## Acceptance criteria

- [ ] `report` and `apply` accept an Umbraco 7.x `.bacpac` and its web root, and
      say which version they found.
- [ ] Document, media and member types, content, media, members and their groups,
      redirects (Skybrud's as well as core's), protected pages and URLs come across,
      in the same site directory as a v15+ import.
- [ ] Nested Content, the Grid and the multi-URL picker convert to blocks and
      links; anything not converted is in the report with its raw value.
- [ ] Proven on a real Umbraco 7 export (Nature's Calendar's, with its owner's
      consent), as `072` proves v15–18.
