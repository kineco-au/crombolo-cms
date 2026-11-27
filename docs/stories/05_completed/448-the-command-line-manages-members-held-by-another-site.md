# 448 — The command line manages members held by another site

**Epic:** D — Members and identity · **Priority:** must · **Size:** M
**Depends on:** 444

## Story

As someone whose site's members are kept at another site (`444`), I want `crombolo
members …` and the remote protocol's member routes to work on that site's members, so
that the command line does what the Members section does, wherever the members are
kept.

## Context

`444` made the Members section, the pickers and the Management API reach the other
site, by putting remote ports in place of `MemberPort` and `MemberGroupPort`. The
command line and the remote protocol (`354`) go through `member-admin.ts`. That uses the
same ports for writes, but reads the database directly for several things, so `444`
left them refusing (`siteMemberPorts` throws "Members are kept at …"). That can't
stand: with `444` set, a site has no command-line way to manage its members, and an
agent or a script working on it has none either.

What `member-admin.ts` reads directly, beside the ports:

| Read | Used by | Where it is |
|---|---|---|
| A member by key, e-mail or login (`findMember`) | every command naming a member | SQL on `member` |
| The providers a member signs in with (`432`) | `members show`, `members link` | `ExternalLoginRepository` |
| How many members each group has | `members groups list` | SQL on `member_group_member` |
| Group names, and whether a rule's member logins exist | `content access` | `NodeRepository`, `MemberRepository` |
| A member's login for a rule | `content access set` | `MemberRepository.byKey` |
| A reset link, sent or handed back (`282`) | `members reset-password` | `member-reset.ts`, on this site |

These stay local and are right as they are: member types (schema), the pages a rule
names, and the values that point at pages or media.

The back office has one more read like these: the member's sign-ins panel (`432`,
`{pluginPath}/api/members/{key}/sign-ins`) reads this site's `ExternalLoginRepository`,
so with `444` set it shows nobody's sign-ins.

## The design

- **Lookups as a port of their own.** A `MemberLookup` holds the reads above, with a
  local implementation (today's SQL) and a remote one over `444`'s client.
  `siteMemberPorts` builds the remote ports and lookup when `members.source` is set, and
  stops refusing. It reads the config's client as the server does, so a `crombolo
  members …` run on a site's own database, with no server running, reaches the other
  site too.
- **Remote, by the Management API where it covers the read:**
  - **a member by e-mail or login:** the member filter, matched exactly;
  - **by key:** the member item;
  - **group counts:** the filter's total for each group, with `take=0`;
  - **group names:** the group list `444` already caches.
- **Remote, by the other site's own routes where the Management API has none:**
  - **sign-ins:** `GET {pluginPath}/api/members/{key}/sign-ins` (`432`), which exists;
  - **reset links:** a new `POST {pluginPath}/api/members/{key}/reset-link`, which sends
    the link from the other site, by its mail and its reset page (`282`), or hands it
    back where it can't send. It is for a service account with Members, and is audited
    with `444`'s actor header.
- **The back office's sign-ins panel** reads the other site's route the same way.
- **Refusals** carry the other site's own sentence, and an unreachable site answers as
  `444` does.
- **The remote protocol** needs nothing of its own: its member routes call
  `member-admin.ts` with the ports `siteMemberPorts` gives them.

## Decided (2026-11-27)

1. **What the Management API doesn't cover goes through the other site's plugin
   routes:** `…/sign-ins`, which exists, and a new `…/reset-link`. Each accepts a service
   account with Members, and each is audited with `444`'s actor header. Rejected:
   - adding them to the Management API as crombolo's first operations there, which
     keeps `OpenApi.json` exactly Umbraco's;
   - the remote protocol's member routes, which act for a signed-in person and refuse
     a service account.
2. **A reset link is sent from the other site,** by its mail to its reset page, because
   it holds the member's address, the mail settings and the password. Where it can't
   send, it hands the link back.

3. **`members link` runs on the other site,** by a new `POST {pluginPath}/api/members/link`
   taking the command's options, against that site's members and its member identity
   providers, answering the command's report; for a principal with Members, audited with
   `444`'s actor header. Rejected: linking member by member from here (the links and the
   ids are that site's, and a site of many members would be one request each), and keeping
   it refused (2026-11-27).

## Acceptance criteria

- [x] **Every `crombolo members …` command** (`list`, `show`, `new`, `update`,
      `approve`, `lock`, `unlock`, `remove`, `reset-password`, `reset-2fa`, `link`,
      `groups …`) works on the other site's members with `members.source` set: against
      a running site, through the remote protocol, and on the site's own database.
- [x] **`content access`** shows and sets rules naming the other site's groups and
      members.
- [x] **`members show`** lists the providers a member signs in with, as the other site
      knows them, and so does the back office's sign-ins panel.
- [x] **`members reset-password`** sends the link from the other site, or prints it
      where that site can't send.
- [x] **Each write** is in the other site's audit log as the person, through the
      account (`444`).
- [x] **With the other site unreachable,** each command says so and changes nothing.
- [x] **Without `members.source`,** every command behaves as today.
- [x] **Tests** against a second site in-process, as `444`'s are.
- [x] **Docs:** `docs/operations.md` and the release notes updated.

## Built

- **`MemberLookup`** (`packages/server/src/member-admin.ts`): the reads beside the ports,
  on `MemberPorts.memberLookup`: `find(ref)` (a key, e-mail or login, to a key), `loginOf(key)`,
  `signIns(key)` (provider id, name, whether declared, and their id there), `counts(groups)`,
  `groupNames()`, `logins(logins)` (those a member has) and `resetLink(member, principal,
  origin?)`. `localMemberLookup` is today's SQL and `ExternalLoginRepository`, with the
  reset link made by `member-reset.ts`; `remoteMemberLookup` uses 444's client: the member
  item by key, the member filter matched exactly by e-mail then login, the filter's total
  with `take=0` per group, the cached group list, and the other site's two routes below.
  `findMember`, `detailOf`, `groupsOf`, `pageAccess` and `setPageAccess` read through it;
  `pageAccess` and `clearPageAccess` take the ports now, not the database.
- **`siteMemberPorts(db, config, { nodeState?, email?, source? })`** stops refusing: with
  `members.source` it builds 444's remote member and group ports (the group list forgotten
  after a group write) and the remote lookup, from the server's `MembersSource` where one is
  passed (`remote.ts` passes `core.membersSource`) or from the config, so a command on the
  site's own database reaches the other site. `newGroup` and `removeGroup` take the principal,
  so a group write names who it is for. `sendMemberResetLink(ports, principal, ref, origin?)`
  is the one reset for the command line and the remote protocol.
- **The client** gains `route(method, path, …)`: one of the other site's own routes under
  `<default backoffice>/crombolo/api`, with the same token, retry and `MembersSourceError`s
  as `call`. `remoteMembers` gains `signIns` and `resetLink`.
- **The holding site's routes:** `GET {pluginPath}/api/members/{key}/sign-ins` (432) is
  unchanged in who it accepts (any principal with Members, a service account included) and
  reads through `localMemberLookup`; on a site with `members.source` it answers from the
  other site, the provider's id only to Sensitive data here, 503 while it isn't answering.
  New: `POST {pluginPath}/api/members/{key}/reset-link`, for a principal with Members (403
  otherwise, 401 signed out), 404 on a site whose members are kept elsewhere or for no such
  member. It sends by the site's own mail to its own reset page, answering `{ sent: true }`,
  or `{ sent: false, link }` where it can't send; one who signs in through a provider is 403
  `signs-in-through-provider`, and no reset page is 409 `unavailable` (not 503, which the
  client reads as not answering). Audited as `SendPasswordReset` by the member's key, with
  the actor header's person through the account (444), and left out of the generic plugin
  write audit.
- **Refusals:** `memberAdminErrorOf` reads a `MembersSourceError` as a `MemberAdminError`,
  `unavailable` (a new kind: exit code `unavailable`, 503 on the remote protocol) or
  `refused`, with that site's sentence. The command line and the remote protocol's member
  routes use it.
- **The back office's sign-ins panel** needs no change: its route on this site answers from
  the other site.
- **`members link`** (decision 3): with `members.source` set the command sends its options
  to the other site's new `POST {pluginPath}/api/members/link` (`{ provider, property,
  dryRun }`) through the client's `remoteMembers.link`, naming the person, and prints the
  report it answers in the same words, "this site" replaced by the other site's address.
  The route needs Members (401 signed out, 403 without, 400 without a provider and
  property), is 404 on a site whose own members are kept elsewhere, and runs
  `linkMembersByProperty` there with its own declared providers. Each link's audit entry
  now names who asked (`user`), so the actor header's person is recorded through the
  account; the route is kept out of the generic plugin-write audit. Unreachable is
  `unavailable`. The command has no `--profile`, so there is no remote-protocol form.
- **Tests:** `tests/members-elsewhere-commands.test.ts`, the holding site served by
  `Bun.serve` in the process: member-admin on the other site's members (each command's
  core, each write audited there as the person), refusals in its words, `content access`,
  sign-ins in `members show` and the panel's route, a reset link sent there and handed back,
  the holding route's checks, the unreachable site; `members link` there, dry and real, its
  report equal to the command's run there, audited as the person, the link route's checks
  and the site down; the remote protocol's member, group,
  access and reset routes; `crombolo members …` spawned in a site folder with no server,
  ending with the site stopped; and both routes without `members.source`. 444's test no
  longer expects the refusal. No browser journey: the panel's code is unchanged.
- **Docs:** `docs/operations.md` ("Members held by another site" under members),
  `docs/configuration.md` and the release notes. No migration.

