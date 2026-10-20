# 088 — A read-only group changes nothing

**Epic:** I — Hardening · **Priority:** must · **Size:** M
**Depends on:** 023, 026, 027, 028

## Story

As a site administrator, I want a group that may only read to be unable to
change anything, in media and elements as well as in documents, so that
giving somebody a look at the site never gives them a way to change it.

## Context

Every Management API call is checked in one place, `authorize()` in
`packages/api-management/src/authorization.ts`. It checks the sections an
operation needs (`sectionRequirements`), then per-node verbs from a rule
table keyed by operationId. Documents have a rule for each write
(`DOCUMENT_RULES`): create, update, publish, delete, move, copy, sort, public
access, domains, rollback, and the recycle bin.

The other areas fall short of that. These were found by auditing every
mutating route against a group whose fallback permissions are
`Umb.Document.Read`, `Umb.Document.PropertyValue.Read`, `Umb.Element.Read`
and `Umb.ElementContainer.Read`, with the Content and Media sections:

1. **Media: a read-only group can change everything.** Media has no verbs
   (`MEDIA_RULES` checks start-node path access only). With the Media
   section, a group can make, edit, delete, move and sort media and folders,
   and restore, delete or empty the media recycle bin.
   - Umbraco has no media verbs either, so this is a deliberate divergence.
   - The vendored client has no media permission condition. It does have
     `Umb.Condition.UserPermission.Fallback`, which can hide actions on
     fallback verbs.
2. **Approval requests (`028`) are not checked against the page.**
   - Asking to publish or unpublish a page (`approvals.send`) needs only the
     Content or Workflow section. Nothing checks Read, Update or the person's
     start nodes, so anybody with those sections can ask about any page.
   - A page's request history (`forPage`) is shown without a path check.
   - Approving is checked properly (`mayPublish`), so nothing changes
     without an approver. But the request, and the history, should not be
     open to somebody who cannot see the page.
3. **Elements check only the Library section.** `element`, `element-version`
   and the element recycle bin need Library and nothing more. The
   `Umb.Element.*` and `Umb.ElementContainer.*` verbs are seeded, and the
   client has conditions for them, but there is no `ELEMENT_RULES`, so no
   server check enforces them.
4. **`Umb.Document.PropertyValue.Write` is stored but never enforced.** A
   user with Update can change any property, including ones their group may
   only read.
5. **Redirect management's site-wide switch needs only Content.**
   `PostRedirectManagementStatus` turns URL tracking on or off for the whole
   site, and `DeleteRedirectManagementById` removes a redirect. Umbraco
   guards both with `SectionAccessContent`. Switching tracking off for every
   page is a setting, not an edit to content.

## Acceptance criteria

**Media**

- [x] Two new verbs in `packages/core/src/permissions.ts`:
      `Crombolo.Media.Read` to browse media, and `Crombolo.Media.Update`
      for everything that changes it. That covers create (folders included),
      update, delete, trash, move, sort, and restoring, deleting or emptying
      the media recycle bin. They are prefixed `Crombolo.` because Umbraco
      has none.
- [x] `MEDIA_RULES` becomes a verb table like `DOCUMENT_RULES`, checked
      against the groups' fallback verbs (media has no per-node permissions),
      on top of the start-node checks it makes today.
      - Reads need `Crombolo.Media.Read`: by id, collection, tree, children,
        audit log.
      - Every write needs `Crombolo.Media.Update`.
- [x] Every built-in group that has the Media section is seeded with both
      verbs. A migration modelled on `form-permissions.ts` grants them on
      upgrade, so no existing group loses access it had.
- [x] A group with the Media section and only `Crombolo.Media.Read` sees the
      media library and is refused every change with a 403.
- [x] The verbs can be ticked in the user-group editor (`entityUserPermission`
      manifests, as `Crombolo.Remote.*` has). The media library hides
      create, delete, move and sort for a user without
      `Crombolo.Media.Update`.
- [x] Temporary-file uploads stay open to any signed-in user, as in Umbraco.
      Only the media call that uses the file needs `Crombolo.Media.Update`,
      and the upload property editor on documents keeps working.
- [x] The divergence is listed in `packages/api-management/src/divergences.ts`
      and `docs/roadmap.md`.

**Approval requests**

- [x] Asking to publish or unpublish a page needs Read and Update on that
      page, inside the person's start nodes. Otherwise it is refused with a
      403, and nothing is recorded.
- [x] A page's request history needs Read on that page, inside the person's
      start nodes.

**Elements**

- [x] An `ELEMENT_RULES` table enforces the seeded `Umb.Element.*` and
      `Umb.ElementContainer.*` verbs on element, element version, element
      folder and element recycle bin operations, the way documents are
      enforced. Library section access is still required.
- [x] Every built-in group keeps the element access it has today: the seeded
      verbs already grant it, and a migration fills any gap.

**Property values**

- [x] Updating a document refuses a change to a property the user's groups
      may not write (`Umb.Document.PropertyValue.Write`, per property type),
      with a 403 naming the property. Unchanged values sent back as they were
      are not a change.

**Redirect management**

- [x] Turning URL tracking on or off for the whole site needs the Settings
      section. Deleting one redirect still needs Content. This is listed as a
      divergence.

**Done**

- [x] `tests/authorization.test.ts` gains rules for media, elements and
      property values, alongside the documents block. Each rule has an
      allowed and a refused case.
- [x] An end-to-end test signs in as a read-only group and is refused every
      write in media, elements, approvals and redirect tracking, while still
      reading what its sections show.
- [x] `docs/backoffice-hosting.md` ("Authorization") describes the media and
      element verbs, and where the rules come from.
- [x] Green against SQLite and Postgres.

## Built

**Media.** `MediaPermissions` (`Crombolo.Media.Read`, `Crombolo.Media.Update`)
in `packages/core/src/permissions.ts`. `MEDIA_RULES` in
`packages/api-management/src/authorization.ts` is now `{ verbs, nodes }` per
operation: the verbs are checked against the groups' fallback verbs
(`fallbackPermissions`), then the start-node path checks run as before. Read:
`GetMediaById`, `GetCollectionMedia` (a folder's children, the list view),
`GetMediaByIdAuditLog`, `GetRecycleBinMediaByIdOriginalParent`. Update: every
other media write (13 operations, held by a test that walks the contract).

- *Decision:* the media **tree and item** endpoints (`tree/media/*`,
  `item/media*`) take no verb. They are Umbraco's picker endpoints, open from
  any section, and documents do not verb-check their tree either; requiring
  Read there would take the media picker away from Writers, who have no media
  verbs. "Children" in the criteria is read as the collection (list view).
- Seeded into `admin` and `editor` (the built-in groups with Media).
- *Decision:* migration 045 `GrantMediaPermissions`
  (`packages/data/src/schema/media-permissions.ts`, `release: '0.21.0'` — the
  next release: 0.21.0 is the version in the tree but is not yet tagged or
  published) runs `grantBuiltInPermissions` and then gives **both** verbs to
  **every** group with the Media section, custom ones included (section stored
  as `media` or `Umb.Section.Media`). Every group keeps exactly the media access
  it had; an administrator narrows a group afterwards by unticking Change.
- Client: two `entityUserPermission` manifests for entity type `media`
  ("Browse", "Change") in `packages/backoffice-host/plugin/umbraco-package.json`,
  and an entry point `plugin/media-permissions.js` that appends
  `Umb.Condition.UserPermission.Fallback` (`allOf: [Crombolo.Media.Update]`) to
  the 12 vendored media actions that change something: create, delete, move,
  sort, trash, restore, empty bin, the bulk move/trash, the collection's create
  and empty-bin, and Save. A test holds the aliases to the vendored manifests.
  The media collection's drag-and-drop zone is not a manifest, so it stays
  visible; the server refuses the upload's media call with a 403.
- `users.ts` `permissions()` returns the groups' `Crombolo.Media.*` fallback
  verbs for the media tree.
- Temporary-file uploads are unchanged (signed-in only).

**Approval requests.** `packages/server/src/approvals.ts`: `send` needs Read and
Update, `forPage` Read, on the page and within the caller's document start
nodes (`assertMayReach`), checked before anything else after the 404, so
nothing is recorded; the refusal is an `ApprovalRefused` with status 403.

**Elements.** `ELEMENT_RULES` maps 32 element, element-version, folder and
element recycle bin operations to Umbraco's verbs, mirroring `DOCUMENT_RULES`
(Read to open, Create, Update, Publish for create/update-and-publish, Unpublish,
Delete for delete and trash, Move for move and restore, Duplicate plus Create
for copy, Rollback; the folder operations use `Umb.ElementContainer.*`;
emptying the bin needs Delete on both). Library is still required.

- *Decision:* checked against the groups' fallback verbs only. Per-element
  granular rows are stored but not loaded into the principal, and the client is
  already told the fallback verbs for every element (`permissions()`), so the
  server now enforces exactly what the client shows. Element start nodes are
  not enforced anywhere yet, as before.
- The seeded verbs are Umbraco's, so Writers (Create/Update/Read on elements
  and folders) can no longer delete, move, publish or unpublish elements
  through the API — which the client already hid from them. Migration 045
  re-runs `grantBuiltInPermissions`, filling any gap in the built-in groups.

**Property values.** `deniedPropertyWrite` in `authorization.ts`, called from
the document handlers for `PutDocumentById`, `PatchDocumentByIdPatch` and
`PutDocumentByIdUpdateAndPublish` before the approval gate: the first property
whose stored values (per culture and segment, nulls dropped, compared as
key-ordered JSON) differ from what the save would leave, and for which no group
grants `Umb.Document.PropertyValue.Write`, is refused with a 403 problem naming
it (`You may not change "Body" (body).`). A group's setting for a property type
replaces its defaults, unioned over groups, as Umbraco's client reads it
(`propertyValuePermissions` in core). The per-property rows are now loaded into
`GroupGrant.properties`; the property types come from a new
`DocumentPort.propertyTypes`. Skipped outright when a group writes every
property. Not covered: values inside blocks, and creating a page.

**Redirect management.** `PostRedirectManagementStatus` needs Settings; the
rest of `redirect-management` still needs Content.

**Divergences.** A new `AUTHORIZATION_DIVERGENCES` in
`packages/api-management/src/divergences.ts` lists the media operations and
`PostRedirectManagementStatus` with their reasons (`DELIBERATE_DIVERGENCES` is
for operations answering 501, and a test holds it to unimplemented ones); also
in `docs/roadmap.md`. `docs/backoffice-hosting.md` ("Authorization") and
`docs/workflows.md` describe the rules.

**Tests.** `tests/authorization.test.ts` (media, elements, property values,
redirect sections, the divergence list), `tests/permissions.test.ts` (seeded
verbs, migration 045 for built-in and custom groups, the manifests and the
entry point), `tests/approvals.test.ts` (start nodes and Read-only),
`tests/read-only-group.test.ts` (end to end: the read-only group reads and is
refused every write in documents, media, elements, approvals and redirect
tracking; a read-only property). `tests/upgrade-from-release.test.ts` and
`tests/integration/first-boot.integration.ts` now rewind to 0.20.0, before 045.

## Technical notes

- Administrators are not special-cased in `authorize`: the admin group holds
  every verb. So the new media verbs must be seeded into admin, or
  administrators lose media writes.
- `users.ts` `permissions()` returns nothing for the media tree. It should
  return the media verbs, so the client's conditions have something to read.
- `fromPermissions` in `packages/server/src/adapters/users.ts` accepts only
  the Document, Element and DocumentPropertyValue permission models. Media
  verbs are fallback verbs, not per-node ones, so they need no new model.

## Out of scope

- Per-node media permissions (granting media writes under one folder only).
  Start nodes already scope media by place; verbs here are per group.
- Member and settings areas, which already need their own sections and were
  found sound.
