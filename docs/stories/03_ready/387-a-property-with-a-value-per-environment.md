# 387 — A property with a value per environment

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** L
**Depends on:** 383

## Story

As someone building a site that runs in more than one place, I want to give a property a
different value for each environment, all set from where I work, so that the live site's
values are reviewed and deployed like everything else and nobody has to edit them on the
live site.

## Context

Some values on a page differ by where the site runs: the address of a payment service,
an analytics id, a switch that turns a feature on. Today the only way to have a
different value on the live site is to edit it there, which means the live site holds
values nobody reviewed and a deployment must be careful not to overwrite.

A property already varies by language and by segment, and `property_data` carries both.
The environment is a third way to vary.

Considered first and dropped (2026-11-19): marking a property as "each environment keeps
its own", with values that never travel. It needed a rule for every way values move, and
left the live value editable only on the live site.

## The design

- **A site knows which environment it is,** by name, from its configuration
  (`environment`), and which environments exist (`environments`). A local site is
  `local` unless told otherwise.
- **A property type may vary by environment,** as it may by language.
- **Such a property has a value for all environments, and may have one for each.** An
  environment serves its own value where there is one and the shared value otherwise.
- **Every environment's value is edited from any environment,** in the editor, beside
  the field: the shared value, then one row per environment that overrides it, the
  current environment's marked.
- **All of them travel together.** A change carries each environment's value like any
  other value, so every copy of the site holds the same set, and a diff shows
  "Production's value" as plainly as any other.
- **Rendering, the Delivery API and templates** read the property as they do now and get
  the current environment's value.
- **A site may make these read-only on an environment** (`environmentValues.readOnly`),
  so that the live site's values can only arrive by a change.
- **Not for secrets.** Every value is visible on every copy of the site and in every
  change. The editor says so on the field, and the docs point to the site's own settings
  for anything that must not be read.
- **From the command line:** `content update … --set <property>@<environment>=<value>`,
  and content files take the same per environment.
- **Turning it on** for a property that has values keeps them as the shared value.
  Turning it off keeps the shared value and lists the overrides that are dropped, which
  is a lossy change (`382`).

## Decisions (settled 2026-11-20)

- **A column of its own:** `environment` on `property_value` beside language and
  segment, null for the shared value, so it combines with a real segment. Every read
  that picks a value chooses the current environment's, then the shared one.
- **The shared value is optional.** An environment may be the only one with a value; the
  others read the property as empty. A mandatory property needs a value in every
  environment, its own or the shared one.
- **The name is the site's config, the list is the schema's.** `CROMBOLO_ENVIRONMENT`
  (`environment`) names the one a copy is: `local` in development, `production`
  otherwise, and `remote.environment` defaults to it. The environments that exist are
  `[environments] names = [...]` in `schema.toml`, so the list travels with the
  definitions and every copy of the site edits the same set.
- **An environment taken out of the list keeps its overrides,** stored and travelling,
  shown in the editor as belonging to an environment the site no longer has until they
  are removed. Taking it out is listed as a change and loses nothing.

## Acceptance criteria

- [ ] **A site reports its environment,** and the ones that exist.
- [ ] **A property varying by environment** serves each environment's own value, and the
      shared value where there is none.
- [ ] **Production's value set on another environment** is what Production serves once
      the change is applied there.
- [ ] **A change and a diff** show each environment's value.
- [ ] **The editor** shows the shared value and each override, with the current
      environment's marked, and warns that the values are not secret.
- [ ] **Read-only on an environment,** the values there are refused in the editor and
      the API, and still arrive by a change.
- [ ] **The command line and content files** set a value for an environment.
- [ ] **Turning it off** lists the overrides dropped, and needs them accepted.
- [ ] **An environment taken out of the list** keeps its overrides, shown as unused.
- [ ] **Tests** on both dialects; `docs/` describes it beside language and segment.
