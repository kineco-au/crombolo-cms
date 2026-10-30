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

- [ ] `site.members` provides `me`, `get`, `byEmail`, `byUsername`, a
      cursor-paged `list`, `update`, `addToGroups`, `removeFromGroups` and
      `delete`. Each returns a `Result` with exhaustive outcome types.
- [ ] As a signed-in member, only their own record is reachable:
      `member-can-view` properties to read, `member-can-edit` to change, and
      only self-service groups. Anything else answers `forbidden` before the
      database is touched. With no member, every call answers `forbidden`.
- [ ] As a back-office user, it acts under the user's Members permissions.
      Sensitive properties are present only with sensitive-data access.
- [ ] As the site, in background work, any member is reachable and every change
      is audited as the site.
- [ ] Property writes are validated against the member type as the back office
      validates them. A failure is `unprocessableContent`, with the field and
      the reason.
- [ ] The groups site code may change are listed in `crombolo.config.ts` as
      self-service or managed. A listed group that does not exist refuses the
      boot, and changing an unlisted group is `forbidden`.
- [ ] Every change is in the audit log, naming the member, user or site that
      made it and the code path (page, route or job) it came through.
- [ ] `RequestMember.properties` carries the member's `member-can-view`
      properties. Reading them makes the page personal, as 206 infers.
- [ ] Listing 400,000 members pages in constant memory, with the covering index
      checked on both dialects.
- [ ] `docs/rendering.md` (the `site` services) and `docs/operations.md`
      ("Members") describe it. Unit tests cover each operation, each caller,
      the refusals, validation and auditing, on SQLite and Postgres.
