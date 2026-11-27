# 445 — A provisioned member is changed only by what provisioned it

**Epic:** D — Members and identity · **Priority:** should · **Size:** S
**Depends on:** 030, 034, 035

## Story

As someone whose members are kept in a directory, I want the back office to show those
members read-only, so that a change made by hand isn't quietly undone the next time the
directory sends them.

## Context

An API client (`034`) can create members without a password (`035`), change them, and
disable them through the Management API, which is how a directory provisions them. The
next time it sends a member, it sends that member whole, so an edit or a re-enable made
by hand in the Members section is overwritten. Nothing tells the person who made it.

`389` covers this for users, for the whole site (`managed-users.ts`: the ports wrapped,
writes kept for the clients `users.managedBy` names). Members are often mixed: some from
a directory, others signing up on the site. So the manager is remembered per member,
not per site.

Members are written in more places than the Members section's port:

- the command line and the remote protocol (`member-admin.ts`, `354`);
- `site().members` (`site-members.ts`, `207`);
- a member's own requests (`delivery-members.ts`, `member-auth.ts`).

## Decided (2026-11-27)

1. **Only listed clients manage.** `members.managedBy: [clientId]`
   (`CROMBOLO_MEMBERS_MANAGED_BY`), like `389`'s `users.managedBy`. A member created by
   a listed client remembers it as its manager. Members made by any other client, by
   `207`'s `members.actAs`, by `444`'s `members.client`, by sign-up or by an external
   sign-in (`031`) have none. Rejected:
   - any API client, which would lock members made by the site's own code and by `444`;
   - a flag the client sets, which every integration would have to know about.
2. **The lock covers everything the directory sends:**
   - name, email, username, approval, groups and deletion;
   - every member-type property;
   - the member's own edits through the site.
3. **Still the member's or the site's:**
   - the member's password, where they have one, and their two-factor set-up;
   - lockout after failed sign-ins, and an administrator unlocking them.
4. **No members from before this release are handled.** There is no backfill and no
   route to take a member on. A directory's members are managed from their creation
   after release.

## The design

- **Stored:** `member.managed_by`, the client id, or null for the site's own (a schema
  migration, on both dialects). `MemberRepository` reads and writes it, and
  `MemberResponse` gains `managedBy`.
- **One rule** (`managed-members.ts`): `mayChange(member, principal)` is true when the
  member has no manager, or when `principal.viaClient` is its manager.
- **A refusal:** `ManagedOutside`, as problem details: "This member comes from a
  directory outside the site: change them there." Administrators are refused too.
- **Applied wherever members are written:**
  - the `MemberPort` wrapper (the Members section and the Management API);
  - `member-admin.ts` (the command line and the remote protocol);
  - `site().members`;
  - a member's own requests to change their details.
- **Handing a member back:** `DELETE {pluginPath}/api/members/{key}/manager`, by its
  manager alone, clears it, and the member becomes the site's own. Audited.
- **The back office:** a managed member's workspace is read-only with Save hidden, and
  says "Kept by <client's account name>: changes are made there." The list marks
  managed members.
- **With `444`:** `managedBy` comes back through the serving site's Management API, so
  the content site shows a managed member read-only too, and the serving site refuses
  its writes.

## Acceptance criteria

- [ ] **A member created by a client in `members.managedBy`** is read-only in the back
      office, with the line, and a change to it by anyone else, administrators
      included, is refused in the back office, the Management API, the command line and
      `site().members`.
- [ ] **The manager** can change, disable and delete it as before.
- [ ] **The member** can't change their own details on the site, and can still change
      their password and two-factor set-up.
- [ ] **A member who signed up,** or was created by an unlisted client or by
      `members.actAs`, is unchanged.
- [ ] **A cleared manager** leaves the member editable, and only the manager can clear
      it.
- [ ] **Tests:**
  - the rule;
  - each write path, refused and allowed;
  - handing back;
  - the migration on both dialects.
- [ ] **Docs:** `docs/configuration.md`, `docs/changes.md` and the release notes
      updated.

## Built

- **Stored:** migration 105 `AddMemberManager` (expand, release 0.83.0, so the packages
  moved to 0.83.0 with `bun run release:version`, as `docs/bundles.md` did for 0.5.0):
  `member.managed_by`, nullable. `MemberRepository` reads it (`managedBy` on a member),
  writes it on a create only, and `clearManager` hands one back.
- **The setting:** `members.managedBy`, else `CROMBOLO_MEMBERS_MANAGED_BY`, validated as
  `users.managedBy` is (`config.ts`, `settings.ts`). Settings → Service accounts says a
  listed client "Keeps this site's members from a directory up to date".
- **The rule** (`packages/server/src/managed-members.ts`): `mayChange`, and
  `managedMemberPort` wrapping the member port in `ports.ts` (the Members section and the
  Management API) and in `siteMemberPorts` (the command line and the remote protocol).
  A create by a listed client records it; any other caller's create records none. A
  non-manager's save passes only when `changesOnlyTheSites` holds: e-mail, username,
  approval, groups, names and values as stored, so a password, turning two-factor off
  and an unlock still go through. `MemberPort.remove` takes the principal now.
- **The refusal:** `PortFailure` carries `operationStatus`; the member handlers answer
  403, `operationStatus: ManagedOutside`, "This member comes from a directory outside the
  site: change them there." `site().members` answers `forbidden` with the sentence for
  `update`, `addToGroups`, `removeFromGroups` and `delete`, whoever asks (a job under
  `members.actAs` acts as an API user, never as the directory). An identity provider's
  sign-in changes neither a managed member's groups (`member-auth.ts`) nor their
  properties (`member-claims.ts`).
- **The response:** `MemberResponse` is the contract's type with `managedBy: { clientId,
  name } | null` beside it (the name of the API user the client signs in as), as
  `UserGroupResponse` carries `owners`; `OpenApi.json` is unchanged. A managed member
  carries the flag `Crombolo.Member.Managed`, in the member and in its items.
- **Handing back:** `GET|DELETE {pluginPath}/api/members/{key}/manager` (`server.ts`):
  `GET` to whoever holds Members or the manager; `DELETE` by the manager alone, audited
  as `HandBack`.
- **The back office** (`members-managed*.js`): `Crombolo.Condition.Member.NotManaged`
  appended to `Umb.WorkspaceAction.Member.Save`; a workspace context adding a read-only
  rule; a footer app with "Kept by <name>: changes are made there."; and the Members table
  overwritten by one that tags a managed member "Kept by a directory".
- **Tests:** `tests/members-managed.test.ts` (the setting, the rule, each write path
  refused and allowed, handing back, the migration); `tests/upgrade-from-release.test.ts`
  and `tests/support/db.ts` for step 105; `tests/browser/members-managed.browser.ts`, the
  read-only workspace and the list's mark, against the suite's server, which now keeps
  members for `crombolo-back-office-member-directory`.
- **Not covered here:** a bundle or site import carrying members (`people-apply.ts`,
  `site-replace.ts`) writes them as before, as the story lists no such path.
