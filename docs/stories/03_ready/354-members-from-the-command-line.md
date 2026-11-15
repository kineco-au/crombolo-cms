# 354 — Members from the command line

**Epic:** P — The command line · **Priority:** should · **Size:** M
**Depends on:** 349, 350, 352

## Story

As a site owner, I want to look after members and who may see a page from the
CLI, so that a member's request, a locked account or a page made members-only
doesn't need the back office.

## Context

Story 349, G3 and G6. The Members section creates, edits, approves, locks and
removes members, and manages member groups. A page's public access names its
sign-in and no-access pages and the groups it is for. The CLI has none of it.
Public access reaches a site only through content files and `site apply`.

Story 155 adds members as CSV and privacy requests, and builds on these
commands. Story 162 makes member groups files: until it is built, the group
commands change the database, and afterwards they write the files, as
`users groups new` does for user groups.

Each command here takes `--profile` (story 352) to act on another site, through the remote protocol, as the person signed in to it. A hosted site needs a new capability for these routes, checked by `packages/remote-conformance`. A CI identity is refused, since these act for a person (story 349, D2). Through a profile, changing a member needs a signed-in person (story 350).

## What is there to build on

- **The member port**, `createMemberPort` (`packages/server/src/adapters/members.ts`),
  is what the Members section's handlers (`api-management/src/handlers/member.ts`)
  call:
  - `byKey(key, viewer)` and `filter({ memberTypeKey, memberGroupName, isApproved,
    isLockedOut, filter, skip, take }, viewer)` answer a member with their type,
    groups, approval, lockout, last sign-in, kind and values;
  - `create(input, principal)` and `update(key, input, principal)` take the whole
    member (`SaveMember`: e-mail, username, name, approved, locked, groups, values,
    and a password or none). They refuse a username or e-mail another member has,
    whatever the casing. Unlocking clears the failed attempts, a new password
    ends the member's sessions, and `isTwoFactorEnabled: false` removes their second
    factor (story 032). Approve, lock, unlock and reset-2fa are all `update`;
  - `remove(key)` takes the member out of their groups, and drops their external
    logins and second factor, in `MemberRepository.delete`;
  - a member with no password is `ExternalOnly`: they sign in only through an
    identity provider (story 035). A create with no password makes one.
- **Sensitive values.** A property marked sensitive is withheld from anyone outside
  the Sensitive data group (`hasAccessToSensitiveData(viewer.groups)`). Two things
  follow:
  - The CLI's principals (`OPERATOR` and `OBSERVER` in `support/people.ts`) have no
    `groups`, so they can't be passed as the viewer as they are. See D2.
  - `update` replaces every value. A save built from what a person outside Sensitive
    data was shown would drop the values withheld from them. The plan has the port
    keep a withheld value it wasn't sent. If the back office's own save loses them
    today, this fixes that too.
- **Member groups** are `node` rows (`adapters/member-groups.ts`): `list`, `create`
  (a name not already taken), `rename` and `remove`, which also empties the group.
  A member's groups are set through the member's `update` (`groupKeys`). Story 162
  hasn't decided where member groups live, so the commands go through this port.
  If 162 makes them files, the commands follow, as `users groups new` did for user
  groups.
- **Public access** is changed through the content operations,
  `setPublicAccess(actor, key, input, change)` and `removePublicAccess(actor, key)`
  (`packages/content/src/operations.ts`). These check the actor's Public access
  permission on the page, write the rule, and tell the caches. They are what the
  back office's handler calls (`api-management/src/handlers/public-access.ts`). The
  handler adds Umbraco's two rules:
  - a rule names groups or members, never both, and at least one;
  - a sign-in page and a no-access page are both required.

  Reading a rule back is `createPublicAccessPort().entry(key, includeAncestors)`, which
  says when the rule is an ancestor's. Rules are stored by **name**: a group's name, or
  a member's username. So a removed or renamed group quietly drops out of every rule
  naming it, and a page whose rule named only that group is then open to no member.
- **The back office's rule names members too.** The story gave only `--group`.
  `content access set` takes `--member <login>` as well, refused beside `--group`, as
  the dialog offers either. The criterion says so now.
- **Public access isn't in content files.** `docs/schema-as-code.md` places it in the
  database, per environment, so `content access` changes the database alone, on any
  site, in development or production.
- **There is no reset link for members.** A member can't ask for one, and nothing
  makes one: that is story 282, still ready. The Members section sets a new password
  directly (`newPassword` on update). So the criterion asking `members reset-password`
  to print or e-mail a link needs 282's token and page. See D1. The criterion is
  written for D1 (a), and goes back to the link if (b) is chosen.
- **Values in the shorthand.** `setsOf` and `typedValue` (`packages/cli/src/support/pages.ts`)
  read `--set`, and `withValuesSet` converts each value through its property's editor,
  for a page. Members are content nodes, so their values go through the same
  conversion. A hosted site converts them itself, so the conversion moves to where
  the server can call it.
- **Audit.** The Management API audits a member's save and delete by key
  (`api-management/src/audit.ts`). `AuditLog.describe` (`packages/data/src/audit.ts`)
  then adds the member's name as the entry's name, from the node. That is what
  story 155's erase will scrub. The CLI's entries (`recordCommand`) carry the key and
  the command and no name, and the remote routes do the same: no name, e-mail or
  value in any entry.
- **Story 155** builds on these. `members show` gains `--out` there, for everything
  held about a person, and `members import` creates and updates through the same
  core. So the core takes a member by e-mail, login or key, and a change as fields,
  not as command flags.

## Decisions

- **D1: what `members reset-password` does, with no reset link to give.**
  - (a) what the Members section does: give the member a new password, generated and
    printed once, or read from `--stdin`, which ends their sessions. This is
    `users reset-password`'s shape. The link follows story 282, which then makes the
    command send it by e-mail or print it, and the criterion says so.
    *Recommended:* it is the back office's behaviour, it keeps this story its size, and
    282 builds the link and its page for members anyway.
  - (b) build 282's link first, or within this story, and have the command only ever
    send or print a link. No one but the member learns the password, but the story
    grows by 282's M, a reset page included.

  **Decided 2026-11-15: (a).** Story 282 gains the criterion that
  `members reset-password` then sends or prints its link.
- **D2: what the command line sees of sensitive values with nobody signed in.**
  - (a) everything, as the Sensitive data group would. *Recommended:* nobody signed
    in means `cliAccess: open`, where whoever runs the command holds the database
    anyway (story 350, "What it does not protect"). Story 155's export and subject
    access request need every value.
  - (b) withheld, unless the person is signed in and in Sensitive data. A local
    `members show` on a development site then needs a sign-in to see a sensitive
    value.

  **Decided 2026-11-15: (a).** Signed in, a person sees what their groups allow.

## Plan

1. **A shared core**, `packages/server/src/member-admin.ts`, used by the commands
   locally and by the remote routes. It takes the ports and a principal:
   - `findMember(ports, ref)`: by key, e-mail or login, whatever the casing;
     `not_found` naming it otherwise;
   - `listMembers(ports, viewer, { group, type, find, skip, take })`, through
     `filter`, with aliases turned into keys;
   - `newMember(ports, principal, { email, login?, name?, type, groups, sets,
     password? })` and `changeMember(ports, principal, ref, { email?, login?, name?,
     sets?, unset?, addGroups?, removeGroups?, approved?, locked?, password?,
     twoFactor: false? })`. They build the whole `SaveMember` from the member as
     stored, so a field not changed is kept;
   - `typedValue` moves from `cli/src/support/pages.ts` to the server (the CLI
     imports it back), and values convert through the member type's editors.
     A `--set` of a sensitive property by someone outside Sensitive data is refused:
     "Only the Sensitive data group can change <alias>";
   - `groupsOf`, `newGroup`, `removeGroup` and `joinGroup`/`leaveGroup`;
   - `pageAccess(db, key)`, `setPageAccess(ops, actor, key, { groups | members,
     loginPage?, noAccessPage? })` and `clearPageAccess(ops, actor, key)`. These apply
     the handler's two rules, moved out of the handler so both call one copy. When a
     page already has its own rule, a set that leaves out a page keeps that page.
2. **The port keeps what it withheld.** `update` keeps each sensitive value of the
   stored member that a viewer outside Sensitive data wasn't sent.
   `tests/members.test.ts` gains the case.
3. **Who it acts as.** Member commands pass the signed-in person as the principal. With
   nobody signed in they pass a command-line principal: `OPERATOR` with `groups` given.
   With D2 (a) that includes Sensitive data. The `content access` commands act through
   `commandActor()`, as every page write does, so the Public access permission and
   start nodes are the person's.
4. **Commands**, all with `access: 'site'` and `...profileFlags`. The `members`
   commands have `section: 'members'`. The writes have `static audit`,
   `category: 'member'`, keyed by the member and nothing else:
   - `members list [--group <name>] [--type <alias>] [--find <text>]` with
     `pageFlags(50)`: login, e-mail, name, type, and "not approved", "locked" or "signs
     in through a provider" where they apply;
   - `members show <member>`: everything the Members section shows, values as
     `content show` shows a page's;
   - `members new <email> --type <alias> [--login] [--name] [--group]... [--set]...
     [--set-file]... [--stdin]`. With no password, the member signs in only through a
     provider, and the command says so, naming `members reset-password`;
   - `members update <member> [--email] [--login] [--name] [--set]... [--unset]...
     [--group]... [--remove-group]...`;
   - `members approve|lock|unlock <member>`, each saying "no change" when it was
     already so;
   - `members reset-password <member> [--stdin]`, with D1 (a). It refuses a member who
     signs in only through a provider, unless `--stdin` gives them a password
     deliberately, as the Members section only sets one deliberately;
   - `members reset-2fa <member>`;
   - `members remove <member>`: asks, or takes `--yes`, and says which groups they were
     in;
   - `members groups list` (each with how many members), `members groups new <name>`,
     and `members groups remove <name>`. Removing a group a page's access names lists
     those pages and needs `--yes`: the rule would lose it;
   - `members groups add|leave <member> <group>`;
   - `content access show <page>`: the groups or members, the sign-in and no-access
     pages, or "protected by <ancestor>'s rule", or "open to everyone". It has
     `section: 'content'`;
   - `content access set <page> (--group <name>... | --member <login>...)
     [--login-page <page>] [--no-access-page <page>]` and `content access clear <page>`,
     with `section: 'content'`. The audit is the operations' own, `SetPublicAccess`.
   - Messages are plain: "Ana Lee <ana@example.com> can sign in again", "/Members is
     now for Subscribers. Others see /Sign in". `-o json` gives keys and ISO dates.
5. **Remote routes**, under `environments/{id}/`:
   - capability `members`, with the Members section:
     - `GET members`, `GET members/{ref}`, `POST members`;
     - `PATCH members/{key}` (the `changeMember` change, values as shorthand text
       the server converts), `DELETE members/{key}`;
     - `GET member-groups`, `POST member-groups`, `DELETE member-groups/{name}`;
   - capability `public-access`, with the Content section:
     - `GET content/{key}/access`, `PUT content/{key}/access`,
       `DELETE content/{key}/access`.

   They answer as the signed-in person through the same core, and refuse a CI
   identity with "Members need a person", 403 `ci-cannot-change-people`. Each write is
   audited as the CLI's, with the person and their address, and never the member's
   name, e-mail or values. `packages/remote-conformance` checks, when each capability
   is listed: a member that isn't there is not found, and a page's access reads back.
6. **`--profile`** through `hostedOrHere` and `connectSite`:
   - a hosted site's pages are named by key, as `content find --under` names them;
   - a site whose discovery lacks the capability is refused with "This site needs a
     newer crombolo to look after its members" (or "…to set who may see a page").
7. **Docs.**
   - `docs/operations.md`, "Members from the command line": members, groups, a page's
     access, sensitive values, and that a password is given, not linked, until 282;
   - `docs/remote-protocol.md`: the routes and both capabilities;
   - `bun run cli:spec`;
   - the release notes under Unreleased.
8. **Tests.**
   - `tests/members.test.ts`: a save from outside Sensitive data keeps the withheld
     value.
   - `tests/member-admin.test.ts`, for the core:
     - a member found by e-mail, login and key, in any casing;
     - new and changed, a field not named kept, values converted, a duplicate e-mail
       refused;
     - a sensitive `--set` refused outside Sensitive data;
     - groups joined and left, a member in a group removed and the group still there;
     - a page's access set by group and by member, both refused together, kept pages,
       cleared, and an ancestor's rule shown.
   - `tests/members-cli.test.ts`, for the commands, locally and against a test server
     with `--profile`:
     - each command, `-o json`;
     - approve, lock and unlock, and "no change";
     - reset-password generated and from `--stdin`, refused for a provider-only member;
     - removing a member who is in a group;
     - a group a page names refused without `--yes`;
     - `content access set` and `clear`, and refused without Public access on the page;
     - at `sign-in`, a person without Members refused;
     - an audit entry holding the key and no name or e-mail;
     - a CI identity refused on each route;
     - a site without the capability refused.
   - `tests/remote-conformance.test.ts` runs the new checks.
   - SQLite only: no table or column changes. No browser tests: the screens don't
     change. The port's sensitive-value fix is covered in `tests/members.test.ts`.

## Acceptance criteria

- [ ] `crombolo members list [--group <alias>] [--type <alias>] [--find <text>]` and
      `members show <member>`, a member named by e-mail, login or key
- [ ] `members new <email> --type <alias> [--name] [--group]... [--set
      <property>=<value>]...` and `members update <member> ...`, values in the
      shorthand `content new` uses
- [ ] `members approve|lock|unlock|remove <member>`, `members reset-password <member>`
      (with D1 (a): a new password, printed once or read from `--stdin`, as the
      Members section gives one; a reset link waits for story 282) and
      `members reset-2fa <member>`
- [ ] `members groups list|new|remove`, and `members groups add|leave <member>
      <group>`
- [ ] `crombolo content access show <page>`, `content access set <page> (--group
      <name>... | --member <login>...) --login-page <page> --no-access-page <page>`, and
      `content access clear <page>`, with the public access dialog's rules
- [ ] Each takes `--profile`; `-o json`; audited, with personal data kept out of the
      audit entry
- [ ] Tests for each command, locally and through a test server, including removing a
      member who is in a group, and a page's access set and cleared
- [ ] The CLI reference regenerated, and `docs/operations.md` gains "Members from the
      command line"
