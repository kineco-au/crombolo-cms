# 162 — User and member groups as files

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As a developer setting a site up from the command line, I want user groups and
member groups, with their permissions and start nodes, to be something I can
declare and apply without the back office, so that a site's roles arrive with
it and stay the same in every environment.

## Context

`docs/schema-as-code.md` lists user groups (`schema/user-groups/`) and member
groups (`schema/member-groups.toml`) as files. **They are not.** The schema
loader (`packages/schema/src/load.ts`) reads content, media and member types,
data types, forms, workflows, `languages.toml` and `schema.toml` only. User
groups live in the database (`UserGroupRepository`, seeded with `admin`,
`writer`, `editor`, `translator` and `sensitiveData`); member groups are
`node` rows. Story 151 rests on the same claim ("user groups are files… out of
scope here"). Changing a group's sections, permissions, granular per-node
permissions, languages or start nodes is back-office work today.

The server can already do all of it: `createUserPorts().groups`,
`createMemberGroupPort` and the `user-group` and `member-group` areas of the
Management API.

## Open question

**Where groups and access settings live — deferred, to be decided before this
story starts.** The options found so far:

- **(a) Groups as files, people as data.** User groups and member groups in
  `schema/`, applied by `types sync` and written back by the back office like
  the types editor; users, members, public access and per-user start nodes stay
  per-environment data, set by commands (story 166) or seed files (story 163).
  This follows the placement rule already written down ("files change with a
  deploy, data changes with editing"), and `push` already keeps a remote's
  people.
- **(b) Everything per environment, through commands.** Groups are data too,
  set by `crombolo groups …` commands in each environment.
- **(c) Everything in seed files**, groups included, applied with content.

Things to weigh: whether a group's permissions differ between environments;
start nodes name content, which differs between environments unless it is
seeded by key; what a `push` does to a remote's groups; the back office
editing a group that a file owns.

## Acceptance criteria

To be finalised with the open question. Whatever is chosen:

- [ ] A user group's sections, permissions, granular permissions, languages and
      content and media start nodes can be set without the back office,
      repeatably and idempotently
- [ ] Member groups can be created and removed the same way, and exist before
      story 155's import or a public-access rule names them
- [ ] The five seeded user groups keep working on an existing site
- [ ] `docs/schema-as-code.md` says what is true now — corrected at once, ahead
      of this story, to say groups are database-only — and story 151's context
      is corrected with it
- [ ] Tests on SQLite and Postgres
