# 205 — Media Public Access with inherited permissions

**Epic:** D — Members and identity · **Priority:** should · **Size:** M
**Depends on:** 204

## Story

As a back-office editor, I want a media item's permissions under a **Public
Access** heading, to follow the folder above unless I override them, and to
see in one line where they come from, so that permissions are straightforward
to set and to check.

## Acceptance criteria

- [x] The Permissions dialog groups Read and Write under **Public Access**, as
      segmented toggles: Read **Enabled** (default) / **Disabled** / **Custom**,
      Write **No Public Access** / **Custom**. Custom chooses member groups
      and/or individual members. Public read carries no warning styling.
- [x] A child file or folder shows **Inherit parent permissions**, ticked
      unless it has settings of its own. While ticked the toggles show the
      nearest folder's settings, or the defaults when no folder above has
      any, and are read-only. Root items have no checkbox.
- [x] The line above the section says where the settings come from (inherited
      from a named folder, the defaults, or set for this item) and who may
      read and change it; the media workspace's info panel says the same under
      **Public Access**.
- [x] Inheritance is live: new files follow their folder, so a later change to
      the folder applies to them. Ticking Inherit takes an item's own settings
      off.
- [x] Older per-file settings show as overrides and are kept on an unchanged
      save; an all-members read is kept unless Read is changed, and a folder's
      "only the member who added it" default for new files keeps working.
- [x] Unit coverage, formatting/lint/types pass; docs are current.

## Decisions

- **Live inheritance over copy-on-create** (approved). New files and folders
  are created with `inherit` policies, so changing a folder applies straight
  away to everything below that inherits. A folder's stored `new_read` /
  `new_write` default is still stamped on new files, as saved settings and
  transfers may carry one, but the dialog no longer offers it and clears any
  except "only the member who added it" when a folder is saved.
- **Member uploads inherit with the permissions** (approved). They live in the
  same rule; while inheriting the box shows the folder above's values, and
  changing one starts the folder's own settings from a copy of the parent's.
- **An override is a rule.** Saving an override writes both audiences into the
  item's own rule (`public_read`, group and member grants) and sets the item's
  policies to `inherit`, so the item's own rule governs it and, for a folder,
  everything below. No schema change.

## Implementation

- `stampedPolicies` falls back to `inherit`; the management API's item policy
  defaults to `inherit`.
- `media-access.js` holds the dialog's form as pure helpers: `formFor`,
  `inheritedForm`, `inheritsParent`, `describeAccess` and `requestFor`. The
  dialog sends nothing when nothing changed.
- Review fixes to the story 204 dialog: choosing Public or Private on a file
  no longer freezes a copy of the folder's rule onto it, the info panel's
  heading matches its summary, and the API's new-file messages no longer list
  choices the dialog does not offer.
