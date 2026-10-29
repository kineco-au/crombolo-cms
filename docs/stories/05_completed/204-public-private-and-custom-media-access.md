# 204 — Public, Private and Custom media access

**Epic:** D — Members and identity · **Priority:** should · **Size:** M
**Depends on:** 203

Story 205 relabels these choices under **Public Access** and replaces
new-file stamping with live inheritance from the folder above.

## Story

As a back-office editor, I want Read controls with Public, Private and Custom
choices, and Write controls with Private and Custom choices, so that ordinary files default to public viewing
and no member changes, while I can grant access to selected groups or members.

## Acceptance criteria

- [x] New files default to Public read and Private write.
- [x] Read offers Public / Private / Custom; Write offers Private / Custom only.
- [x] Custom supports both member groups and individual members.
- [x] Existing saved restrictions remain accurate and are preserved.
- [x] Serving, editing, Delivery API filtering, caching and transfers enforce
      the same grants; both database dialects and focused browser tests pass.
- [x] Formatting/lint/types and docs are current.

## Decisions and implementation

Approved: no public write access, and a dedicated individual-member grants table
in release 0.35.3. The version wrapper advanced all publishable CMS packages and
the migration release together; nothing has been published.

- Separate Read and Write radio controls, with member-group checkboxes and the
  native member picker in Custom. Root items expose no inheritance control.
- Unconfigured new files get public read/private write. Restricted folder
  defaults and existing stored policies remain effective. Folder changes set
  new-file defaults as well as the folder's rule.
- Migration 053 adds `media_access_member` with one rule/member row and separate
  read/write flags, cascading on rule deletion. Group and member grants match
  with OR, independently for read and write.
- The core evaluator, SQL media lists, file/crop serving and media operations
  enforce the same grants. Selected members without groups can be granted
  access. Back-office users keep their ordinary rights.
- Content bundles carry individual grants with their UUIDs, without requiring
  people to be included. The permission API validates member UUIDs and rejects
  public/all-member write policies.
- Legacy all-member, creator and inherited settings remain readable and are
  preserved on an unchanged save. Editing a Custom audience replaces that
  legacy audience with the selected groups and members.

## Validation

Unit coverage includes default stamping, independent group/member evaluation,
persistence/revocation, file and crop authorization, SQL listings, member writes,
invalid input and bundle serialization. Focused browser coverage exercises root
and child files, public/private defaults, Custom groups and the actual member
picker, saving/reopening, switching to Private, and folder defaults.

Completed in Docker through the Bun wrapper scripts:

- Full SQLite unit suite: 3,047 passed, 8 skipped, zero failures.
- Full PostgreSQL unit suite: 3,045 passed, 12 skipped, zero failures.
- Final focused permission/migration/transfer suites: 78 SQLite tests and
  88 PostgreSQL tests passed.
- Integration suite: 100 passed, zero failures, including first boot,
  release upgrades and multi-process deployments.
- Focused media/forms browser suite: three passed, with no unexpected browser
  diagnostics. This includes the Harbourstone page's saved-form field preview.
- Formatting, lint and TypeScript checks passed; no commits or publishing.

The full run found an older permissions test's expected migration list missing
053; its shared rewind already removed the new table. The expectation now
includes `AddMediaMemberGrants`, and both full dialect suites pass.
