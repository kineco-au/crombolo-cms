# 444 — A site's members held by another site

**Epic:** D — Members and identity · **Priority:** should · **Size:** L
**Depends on:** 030, 034, 388, 443, 445

## Story

As someone whose content is made on one site and served from another, I want to manage
the serving site's members from the site where I make content, so that I never need to
sign in to the serving site's back office.

## Context

With `388`, content is made on one site and served from another that is locked. Members
are not content: they sign up, change their own details and sign in on the site that
serves them, and a locked site still writes them (`CROMBOLO_CONTENT=locked` leaves
members, form entries and what visitors send writable). So the serving site's back
office is the only place its members can be managed, and the site where everything else
is done can't see them.

Copying members to the other site, editing them there and moving the change back would
overwrite whatever a member changed on the serving site since the copy, miss everyone
who signed up after it, delay a disable until the change is applied, and keep a second
copy of personal data. Members belong to one site, and the other should work on that
site's members directly.

`389` is the opposite case: users kept outside the site. An API client (`034`), now a
service account (`433`), can already manage members through the Management API.

### Where members are reached today

- **Through the ports:** the Members section, the member and member group pickers, the
  Management API's member routes, the command line and the remote protocol (`354`, via
  `member-admin.ts`) all go through `MemberPort` and `MemberGroupPort`
  (`api-management/src/ports-members.ts`, built in `server/src/ports.ts`).
- **Straight from the database:** member sign-in, reset and links, external sign-in, the
  Delivery API's member routes, `site().members` (`207`) and media's creator lookup use
  `MemberRepository` directly.
- **Rules by name:** Public Access stores group names and member usernames, as Umbraco
  does, not keys. A rule picked from the other site's groups still means the same group
  there, because the name is that site's.

## Decided (2026-11-27)

1. **Who did it: a header, trusted per account.** Each write carries
   `Crombolo-Acting-For: <id>|<name>`. The other site records it as the audit's actor,
   in `366`'s fields ("by Ada, through <account>"), only from service accounts it lists
   in `members.actorsFrom`. From any other caller it is ignored. Rejected:
   - exchanging each person's token (`364`), which needs every user to exist on the
     other site;
   - each site recording only its own side.
2. **The account's grant is enough.** Any service account with Members permissions on
   the other site may manage its members, as the Management API allows today.
   `actorsFrom` only adds the person's name. Requiring it was set aside: it would break
   API clients that manage members now.
3. **A group renamed from here rewrites this site's rules and warns.** This site's rules
   naming the group are rewritten, so the next change carries them. The dialog warns
   that N pages' rules name the group, and that its members can't open them on the
   other site until that change arrives, then offers to rename anyway. Rejected:
   - refusing the rename while rules name the group;
   - writing the other site's rules directly, which writes content on a locked site
     outside a change.
4. **`site().members` reads and writes the other site** through the same client, so a
   preview of a members page shows real members. The actor header names the code or job
   that wrote.
5. **The settings:**
   - `members.source` (`CROMBOLO_MEMBERS_SOURCE`): the other site's address;
   - `members.client` (`CROMBOLO_MEMBERS_CLIENT_ID`, `CROMBOLO_MEMBERS_CLIENT_SECRET`);
   - on the other site, `members.actorsFrom` (`CROMBOLO_MEMBERS_ACTORS_FROM`).

## The design

- **The settings:** with no `members.source`, members are this site's own, as today.
  With one, `members.client` is required. A missing or malformed setting refuses to
  boot, saying which.
- **The client** (`members-remote.ts`):
  - takes a token from the other site by client credentials and keeps it until it
    expires;
  - calls the Management API by the vendored contract (`@crombolo/contracts`);
  - turns that site's failures into `unreachable`, or `refused` with its own sentence.
- **Remote ports:** `createRemoteMemberPort` and `createRemoteMemberGroupPort` implement
  the existing port interfaces over the client, and `ports.ts` uses them when `source`
  is set. So every caller of the ports reaches the other site with no change of its own.
  Nothing is cached beyond the request, except the group list for rendering here (see
  below).
- **`PublicAccessPort` stays local:** rules are this site's content and travel with the
  page.
- **Who did it:**
  - **here:** each write through the remote ports sends `Crombolo-Acting-For` with the
    user's id and name, or the job's for `site().members`;
  - **on the other site:** `auditContext` reads the header only when the caller is a
    service account in `members.actorsFrom`, and records it as `actor`.
- **This site holds no members and no member groups:**
  - member sign-in, registration, reset, external sign-in and the Delivery API's member
    routes answer 404;
  - `--with-members` is refused with a sentence;
  - a test holds that no member rows are written.
- **Member types stay schema,** made here and moved with the site's other types.
- **Rendering and preview here:** `443`'s groups are the other site's, cached for 60
  seconds. Members are never cached.
- **A renamed group:** this site's rules naming it are rewritten in the same request,
  after the other site answers. The dialog's warning counts them first.
- **The other site unreachable:** the Members section says "Members are kept at
  <site>, which isn't answering", with Try again, and nothing is written here.

## Acceptance criteria

- [ ] **With the setting,** the Members section lists the other site's members and
      groups, and a member who signed up there a moment ago is listed.
- [ ] **Editing, disabling, adding and deleting a member** here changes it on the other
      site at once. Its audit log names the person who did it when the account is in
      `members.actorsFrom`, and only the account otherwise.
- [ ] **Member groups** are added, renamed and removed on the other site from here, and
      a rename rewrites this site's rules, after warning how many pages name the group.
- [ ] **A page's Public Access** picks the other site's groups and members, and the rule
      means the same group once the page arrives there.
- [ ] **`site().members`** reads and writes the other site's members, named in its audit
      as the code or job that wrote.
- [ ] **This site holds no members or member groups** while the setting is set; member
      sign-in, registration, reset and the Delivery API's member routes are off, and
      `--with-members` is refused.
- [ ] **With the other site unreachable,** the Members section says so and writes
      nothing.
- [ ] **A missing client, or a malformed source,** refuses to boot, saying which.
- [ ] **Without the setting,** members behave as today.
- [ ] **Tests:**
  - against a second site in-process;
  - on both dialects;
  - the browser suite's journey for the Members section.
- [ ] **Docs:** `docs/configuration.md`, `docs/changes.md` and the release notes
      updated.

## Built

- **The settings** (`config.ts`, `settings.ts`): `members.source`, `members.client` and
  `members.actorsFrom`, the file's winning over `CROMBOLO_MEMBERS_SOURCE`,
  `CROMBOLO_MEMBERS_CLIENT_ID`/`_SECRET` and `CROMBOLO_MEMBERS_ACTORS_FROM`. A source
  that is not an `http`/`https` address with no path, a source with no client, and a
  malformed `actorsFrom` each refuse to boot with a sentence. Settings → Service accounts
  says a client in `actorsFrom` "Manages this site's members from another site, saying who
  for".
- **The client** (`packages/server/src/members-remote.ts`): `createMembersClient` signs in
  by client credentials at the other site's `…/security/back-office/token`, keeps the
  token until 30 seconds before it expires (one sign-in at a time), retries once on a 401,
  and calls the Management API by operation id from the vendored contract
  (`listOperations(loadSpec())`). No answer, a timeout (10 s) or a 5xx is
  `MembersSourceError('unreachable')`, "Members are kept at <site>, which isn't
  answering."; a refused account or read is `'refused'` with that site's own sentence.
  The Management API router's `onError` answers them as problem details (503, or the
  refusal's status).
- **Remote ports:** `createRemoteMemberPort` and `createRemoteMemberGroupPort`, swapped in by
  `ports.ts` when `membersSource` is passed (`core.ts` builds it once per server from the
  config). Validation stays this site's (member types are schema); the other site's
  refusals, `ManagedOutside` and duplicates included, come back as `PortFailure`s in its
  words. `MemberGroupPort`'s writes take an optional principal now, which the handlers
  pass, so a group write names who it is for too. The member port is not wrapped by 445's
  `managedMemberPort`: the other site applies its own `managedBy`, and its `managedBy` and
  `Crombolo.Member.Managed` flag come through, so 445's read-only workspace works here
  (`…/members/{key}/manager` answers from the other site; `DELETE` is refused here).
- **Who did it:** each write sends `Crombolo-Acting-For: <id>|<name>`, both parts
  URI-encoded (a name is not always Latin-1). On the other site `authenticate` reads it only
  when `principal.viaClient` is in `members.actorsFrom`, as `AuditContext.actingFor`, which
  fills `actor_id`/`actor_name` and adds "by <name>, through <account>" to the detail of that
  principal's entries. Anything else is ignored; read back length-limited (200/100) with
  control characters removed.
- **Public Access stays local:** `createPublicAccessPort` takes `named` to resolve a rule's
  names to the other site's groups (from the cached list) and members (by username through
  the filter). A rename through the remote group port, after the other site answers ok,
  rewrites each Shared page's own rule naming the old name through
  `operations.setPublicAccess` as a system actor ("Member group renamed", for the user), so
  it is recorded and carried as any rule change (`rulesFollowRenames`,
  `PublicAccessRepository.namingGroup`). `GET {pluginPath}/api/member-groups/{key}/rules`
  counts them for the warning.
- **Rendering and preview:** `MembersSource.groups()` keeps the group list for 60 seconds,
  forgotten after a group write from here; 443's preview route and stand-in read it. Media's
  Permissions dialog lists the other site's groups and names a creator from it.
- **`site().members`** (`site-members-remote.ts`): the same reads and writes over the client.
  A job needs no `members.actAs` and is named by its scope (`job imports.nightly`); a user by
  their id and name, with the route or action that wrote after it. Member types and their
  `memberCanView`/`memberCanEdit`/sensitive rules are read from this site's schema. `since`
  is applied to the page the other site returns, by update date.
- **Off when set:** `memberAuthOff` and `deliveryMembersOff` (`server.ts`) answer every
  `/umbraco/members/*` route (sign-in, registration, reset, external sign-in) and the
  Delivery API's member routes with 404, "Members are kept at <site>: …", and resolve no
  member. `siteMemberPorts` refuses (so the command line's and remote protocol's member and
  page-access commands say "Members are kept at <site>: manage them there, or in this site's
  Members section."), `site export --with-members` and `content export --with-members`
  refuse, and a bundle carrying members or member groups is refused at its check
  (`members-elsewhere`). The boot's check that `members.groups` names existing groups is
  skipped: they are the other site's.
- **The back office** (`members-source.js`, `members-source-notice.js`,
  `members-source-save.js`): a sidebar app in Members says "Members are kept at <site>.", or
  "…, which isn't answering." with Try again (`{pluginPath}/api/members-source`); Save for a
  member group is overwritten by one that, on a rename while this site's rules name the
  group, asks with `ask()` ("Rename anyway") first.
- **Tests:** `tests/members-elsewhere.test.ts` boots the holding site, served over HTTP by
  `Bun.serve`, and the content site in one process: the settings, the header, listing (a
  member who registered a moment ago), member writes and their audit with and without
  `actorsFrom`, a forged header ignored, refusals in words, a managed member read-only,
  groups with the rename rewriting rules, Public Access names, preview's groups,
  `site().members` and its audit, everything that is off, no member or group rows here, the
  unreachable site, a refused account, and the token kept. The holding site runs on SQLite
  whatever the dialect (two sites can't share the suite's one Postgres database); the site
  under test runs on the dialect under test. Browser journey:
  `tests/browser/members-elsewhere.browser.ts`, against a second site `serve.ts` boots at
  `127.0.0.1` on the next port, whose members the suite's server holds.
- **Not done:** the command line's and remote protocol's member commands are refused rather
  than reaching the other site, since `member-admin.ts` reads the database directly for its
  listings, sign-ins and counts; the members are managed from the Members section here or on
  the other site. Uploaded files in member properties (temporary files) are not carried to
  the other site.
- **Docs:** `docs/configuration.md` ("Members held by another site", and the settings
  table), `docs/changes.md` (a site served from another), `docs/testing.md` (the browser
  suite's second site) and the release notes. No migration.
