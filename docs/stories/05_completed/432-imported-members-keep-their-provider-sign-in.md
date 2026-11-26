# 432 — Imported members keep their provider sign-in

**Epic:** D — Members and identity · **Priority:** must · **Size:** M
**Depends on:** 031

## Story

As someone moving a site whose members sign in through an identity provider, I
want each imported member to arrive linked to their account there, so that their
first sign-in finds the member they already are.

## Context

A member signs in by the `external_login` row naming their provider and its id
for them (031, 191). Nothing that brings members in writes that row:

- A site file's members (`site export --with-members`, applied by
  `packages/transfer/src/people-apply.ts`) carry no external sign-ins, nor does a
  bundle's people section. A move between two Crombolo sites loses them too.
- `POST /member` and `crombolo members new` have no field for one.
- 155's CSV import, not built, matches by e-mail.

What happens at that first sign-in, then (`decideSignIn`):

- **The e-mail matches:** refused ("An account with this email address already
  exists"), unless `linkByEmail` is on and the provider vouches for the address.
- **The e-mail has changed, or never matched:** a second member is made, without
  the first one's properties, groups and data.

Turning `linkByEmail` on for hundreds of thousands of people trusts an address
over the id that is known. The other system usually holds that id: Umbraco sites
keep a B2C object id in a member property, for instance.

For users, 404 links a managed user's external login by its directory.

## Decisions (2026-11-26, the maintainer's)

1. **Both: the people section, and a command.** Members in a site file or bundle carry
   `externalLogins: [{ provider, subject }]`, sealed with the rest of the people data,
   written by `site export --with-members` and read by the apply (`people-apply.ts`). And
   `crombolo members link --provider <id> --property <alias>` links members already here
   from a property they hold, such as an Umbraco site's `aDObjectID`, and may be run again.
   Matching at first sign-in by a property is not offered: whoever can edit the property
   could take the account.
2. **A link another member holds is refused,** that member's link only, the report naming
   both members and the provider. Nobody's sign-in moves without someone looking.
3. **A link to a provider the site does not declare is kept,** with a warning naming the
   provider and how many links it has, in the report and the command's output. It does
   nothing until the provider is declared; then those members sign in as themselves, with
   no second import.
4. **Links follow their member on `site replace`:** a member the file carries ends with the
   file's links. A file that carries no links at all, as every one before this does, removes
   none.

## Findings

- Links are `external_login` rows (`login_provider`, `provider_key`,
  `user_or_member_key`), read and written by `ExternalLoginRepository`
  (`data/src/repositories/external-logins.ts`). `provider_key` is the claim the provider's
  `subjectClaim` names (191), so the command and the file carry that value.
- A member in the people section is planned by `planPeople` and written by `applyPeople`,
  and exported by `exportPeople`, all in `packages/transfer/src/people-apply.ts`.

## Out of scope

- **Back-office users' links.** On a site whose users are managed from outside
  (`users.managedBy`, stories 389 and 404) only the directory writes them, and a file
  carrying users is refused there already. Members' links do not meet it, so nothing
  here needs to be exclusive of it.

## Acceptance criteria

- [x] An export with members carries each one's external sign-ins, encrypted with
      the rest; applying it on a site without those members makes them linked.
- [x] A member imported with a link signs in through that provider as themselves,
      whatever their e-mail there, with `linkByEmail` off.
- [x] Applying the same file twice changes nothing the second time.
- [x] A link another member holds is refused, with both members named; the rest of
      the import goes ahead.
- [x] A link to a provider the site does not declare is kept, and the report warns,
      naming the provider and how many links it has. Once the provider is declared, those
      members sign in through it as themselves.
- [x] The report says how many links arrived.
- [x] On `site replace`, a member the file carries ends with exactly its links; a file
      with no links removes none.
- [x] `crombolo members link --provider <id> --property <alias>` links every member whose
      property holds a value and who has no link to that provider, refusing a value
      another member holds as the import does, and says how many it linked, skipped and
      refused. Run again, it links none twice.
- [x] An administrator can see that a member is linked, and to which provider;
      the provider's id for them is sensitive data.
- [x] A file from before this, with no links, applies as it did and removes none.
- [x] `members link` reads 400,000 members a page of 500 at a time, so it holds one page; the people section is read whole, as it always was.
- [x] Every link made this way is in the audit log. Tests on SQLite and Postgres;
      `docs/operations.md` ("Signing in through an identity provider") and
      `docs/content-transfer.md` describe it.

## What was built

- **The people section:** `BundleMember.externalLogins` (`transfer/src/people.ts`), written
  by `exportPeople` and left out of an anonymised export (`sanitise.ts`). `planPeople`
  reports `login-links`, `login-held` and `login-provider-undeclared`, given the site's
  member providers (`CheckOptions.memberProviders`, from `bundle-install.ts`).
  `applyPeople` makes a carried member's links what the file says (`syncMemberLinks`),
  auditing each `Link` and `Unlink`.
- **The command:** `crombolo members link --provider --property [--dry-run]`
  (`cli/src/commands/members/link.ts`) over `linkMembersByProperty`
  (`server/src/member-links.ts`), on the site's database, 500 members at a time.
- **Seeing it:** `GET <plugin>/api/members/{key}/sign-ins` (`server.ts`), for whoever holds
  Members, the provider's id only with Sensitive data; the member's Info box
  (`plugin/member-sign-ins.js`); `MemberDetail.signsInWith` and `members show`.
- **Tests:** `tests/member-links.test.ts`, SQLite and Postgres.
- **Docs:** `operations.md`, `content-transfer.md`, the CLI reference, the release notes.
- **Not run:** signing in through a real B2C tenant with an imported link: the link is the
  one 191's sign-in looks up, covered there with its stand-in provider.
