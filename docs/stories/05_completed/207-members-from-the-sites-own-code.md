# 207 — Members from the site's own code

**Epic:** O — Building a site · **Priority:** should · **Size:** M
**Depends on:** 206

## Story

As a developer building a site whose members finish registering, edit their
profiles and are managed by staff in the site's own screens, I want
`site.members` to read and update members (their properties and their
groups), acting as whoever is asking. Then registration, profile pages, a
members admin and exports are ordinary site code, not calls to the
Management API.

## Context

Story 206 gives a page's server code `site()`, the site's services acting
as the visitor, each returning a `Result`. This story fills its `members`
slot.

Today nothing in a site's own code reads or changes a member beyond the
signed-in one, and that member (`RequestMember`) carries a key, name,
username, e-mail and group names, with no properties.

A large membership site being rebuilt on crombolo needs:
- **Registration completion:** after signing up with an identity provider, the
  site collects an address, terms acceptance and a referral source, writes them
  to the member, and adds them to its members' group.
- **The "registered?" check** a member page makes on the server before
  rendering.
- **A members admin** in the site's back-office section, for finding and
  editing members.
- **A nightly export** paging through hundreds of thousands of members. This
  runs as background work (187).

What exists to build on:
- Member types already declare per-property `member-can-view`,
  `member-can-edit` and `sensitive` in schema TOML.
- `MemberRepository` already filters, searches, updates and sets groups.
- Story 155's member export is command-line only.


## Decided (2026-11-25)

Where these differ from the design below, these stand.

1. **Jobs and event handlers act as a named API user,** `members: { actAs: '<client id>' }`,
   as `content.actAs` does (298): its groups decide what it may do and whether it sees
   sensitive properties. Without it every call answers `forbidden`. Audited as that API
   user, naming the job or event. Not the person who set a job up: jobs are declared in
   code, and a schedule must outlive anyone's account.
2. **Staff screens wait for 431.** This story builds and tests `site.members` acting as a
   back-office user; 431 hands it to screens, and settles whether a job started from a
   screen acts as the person who started it.
3. **A member may change their name and `member-can-edit` properties, never their e-mail:**
   that answers `unprocessableContent`. A job or staff may change it.
4. **A member never deletes themselves.** `delete` as the member answers `forbidden`; a
   page queues a job, which can first deal with the site's own rows.

## The design

`site` is the same object wherever the site's own code runs on the server,
built for whoever is asking:

| Where the code runs | `site.members` acts as | Can reach |
|---|---|---|
| A page's components (206), or a member's request to the site's own routes | the signed-in member | **Their own record only**: `member-can-view` properties to read, `member-can-edit` to change, and the self-service groups |
| The same, with nobody signed in | the visitor | Nothing. Every call answers `forbidden` |
| Back-office screens and routes the site adds | the back-office user | Any member, under the user's Members permissions. Sensitive properties only with sensitive-data access |
| Background work (187) | the site | Any member. Audited as the site, naming the job |

So site code cannot give a member more than the member type allows, and a
member's page cannot reach another member, whatever the code asks for.

```ts
export default async function Account({ member }: PageProps<AccountPage>) {
  if (!member) redirect('/sign-in')
  const me = (await site().members.me()).unwrap()      // throws forbidden
  if (me.properties.termsAccepted !== true) redirect('/complete-registration')
  return <AccountDetails me={me} />
}

// completing registration, as the member
const saved = await site().members
  .update(member.key, { properties: { address, termsAccepted: true, referral } })
  .andThenAsync(() => site().members.addToGroups(member.key, ['Members']))
saved.match({ ok: () => …, 422: ({ errors }) => …, 403: () => forbidden() })
```

**Operations.** Each returns a `Result`:
- `me()` — the signed-in member, with what they may see;
- `get(key)`, `byEmail(email)`, `byUsername(name)`;
- `list({ group, type, approved, text, since, after, take })` — paged by
  cursor, in constant memory;
- `update(key, { name?, email?, properties })`;
- `addToGroups(key, groups)` and `removeFromGroups(key, groups)`;
- `delete(key)` — for oneself on a member's request, or with the delete
  permission in the back office.

There is no `create`: members are created when they first sign in, by the
identity provider.

**Outcomes.** These are 206's `Outcome` values, named for their status:
`notFound`, `forbidden` and `unprocessableContent(errors)`, with field errors for an
unknown alias, a wrong value shape or failing validation. A form shows them.

**Which groups site code may change.** The site lists them in
`crombolo.config.ts`:
`members: { groups: { selfService: ['Members'], managed: ['Moderators'] } }`.
- `selfService` groups are ones a member may join or leave through the site's
  code.
- `managed` groups are ones back-office code and background work may change.
- Any other group is readable and never changed, so site code cannot put
  someone in a group another feature trusts for administration.
- A listed group that does not exist refuses the boot.

**The request member carries properties.** `RequestMember.properties` holds
the member's `member-can-view` properties, so a component can show
"complete your registration" without a call.

## Acceptance criteria

- [x] `site.members` provides `me`, `get`, `byEmail`, `byUsername`, a
      cursor-paged `list`, `update`, `addToGroups`, `removeFromGroups` and
      `delete`. Each returns a `Result` with exhaustive outcome types.
- [x] As a signed-in member, only their own record is reachable:
      `member-can-view` properties to read, `member-can-edit` to change, and
      only self-service groups. Anything else answers `forbidden` before the
      database is touched. With no member, every call answers `forbidden`.
- [x] As a back-office user, it acts under the user's Members permissions.
      Sensitive properties are present only with sensitive-data access.
- [x] As the site, in background work, any member is reachable and every change
      is audited as the site.
- [x] Property writes are validated against the member type as the back office
      validates them. A failure is `unprocessableContent`, with the field and
      the reason.
- [x] The groups site code may change are listed in `crombolo.config.ts` as
      self-service or managed. A listed group that does not exist refuses the
      boot, and changing an unlisted group is `forbidden`.
- [x] Every change is in the audit log, naming the member, user or site that
      made it and the code path (page, route or job) it came through.
- [x] `RequestMember.properties` carries the member's `member-can-view`
      properties. Reading them makes the page personal, as 206 infers.
- [x] Listing 400,000 members pages in constant memory, with the covering index
      checked on both dialects.
- [x] `docs/rendering.md` (the `site` services) and `docs/operations.md`
      ("Members") describe it. Unit tests cover each operation, each caller,
      the refusals, validation and auditing, on SQLite and Postgres.

## What was built (2026-11-25)

`server/src/site-members.ts` behind `site().members`, the types in `render/src/site.ts`,
the cursor in `MemberRepository.after`, and `member.properties` in `member-auth.ts`;
tested in `tests/site-members.test.ts`. As decided above, and:

- **Jobs and staff may change `selfService` groups too,** as well as `managed` ones.
- **A page render only reads,** as `site().content` (298); a bundle's routes do not write.
- **A save that meets another is `badRequest`,** there being no conflict outcome.
- **As a back-office user** is built and tested directly; no screen is given it until 431.
- **Listing** pages on the member's own primary key, sorting nothing on either database
  (asserted from the plan). Each member's properties are read one at a time; an export of
  400,000 was not timed.
- **File uploads** are not taken through `update`.
- A route reached by a member's bearer token was handed the stored member, password hash
  included; it is now given what a page is.

SQLite green; Postgres green but for table types, which timed out under the full run and
passes alone.
