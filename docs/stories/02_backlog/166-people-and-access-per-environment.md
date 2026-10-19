# 166 — People and access per environment

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** 162

## Story

As a developer setting up an environment from the command line, I want to add
back-office users with their groups and start nodes, add API clients, and
protect pages for members, so that an environment is usable the moment the
script finishes, with nobody signing in to finish it.

## Context

`crombolo users` can list, invite, enable, disable, unlock and reset a user
(story 151). It cannot add a user who signs in with a password straight away
(`invite` prints a link someone must open), put a user in a group, or set their
start nodes. Only one API client exists, seeded from the environment (story
034); more are back-office work. Public access rules — which pages need a
member to sign in, in which member groups, with which login and error pages —
are set per page in the back office only. The ports exist:
`createUserPorts`, `createPublicAccessPort`, and the `user`, `user-group` and
`public-access` areas of the Management API.

What lives in files and what is per-environment data depends on the open
question in story 162; this story builds the per-environment half of whatever
is decided there, and its criteria are finalised with it.

## Open question

Carried from story 162: whether public access rules and per-user start nodes
are commands run in each environment, or entries in seed files (story 163) that
travel with the content they protect.

## Acceptance criteria

- [ ] `crombolo users add <email> --name --group <alias>… [--password-stdin]`
      creates a user who can sign in at once; the password is read from stdin,
      never from an argument
- [ ] `crombolo users set-groups <email> <alias>…` and
      `users set-start-nodes <email> --content <path>… --media <path>…`
- [ ] `crombolo api-client add <id> --group <alias>…` prints the secret once;
      `api-client list` and `api-client remove`
- [ ] Public access rules can be set without the back office (by command or by
      seed, per the open question): the page, the member groups, the login and
      error pages
- [ ] Every command is idempotent, takes `--dry-run` and `-o json`, writes an
      audit entry, and never prints a secret it did not just create
- [ ] Tests on SQLite and Postgres
