# 186 — Member and public routes for server bundles

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** M
**Depends on:** 030, 063

## Story

As a site whose visitors and members use an application beside its content, I
want a server bundle to serve routes to anonymous visitors and to signed-in
members, so that the site's browser code has an API to call without a second
server.

## Context

A server bundle's routes mount under `<backoffice>/crombolo/api/bundle/<id>/`
and the host authenticates a back-office user and checks the bundle's section
before dispatch: "a handler never sees an anonymous request, and a bundle cannot
declare a public route" (`packages/server/src/bundles.ts`). That was the right
default for screens in the back office, and it leaves no way for a site to give
its members an API.

Raised by Nature's Calendar (`wt-natures-calendar` story 012), whose API is
mostly member-facing (a member's records, places and photos) and partly public
(species lists, map data, recent records). Templates already receive the
signed-in member (`PageProps.member`, `docs/rendering.md`); a route needs the
same. Other customers with an application beside their content will meet the
same wall. Nothing a site writes outside a bundle is an alternative on Crombolo
Cloud, which runs its own `server.ts`.

## Decisions before implementation

- **Where they mount.** Under the site (for example `/api/<bundle id>/…`),
  reserved so no page URL or core route can collide, and refused at boot if a
  published page claims the prefix.
- **Which nodes serve them.** Renderers (`role: web`) serve visitors and members,
  so public and member routes belong there; a bundle that writes must then write
  from a web node, which `176` notes is already true of members and forms.
  Decide whether a route declares itself read-only.
- **What a member route is given.** The member's key, groups and properties, as a
  frozen principal, and nothing of the back office.
- **Cross-site requests.** Member routes ride the member cookie, so a state
  change needs a same-site cookie plus an origin check or a token. Decide which,
  and whether core issues the token to templates.

## Acceptance criteria

- [ ] A bundle route declares its audience: `backoffice` (today's, and the
      default), `member`, `member` with named groups, or `public`.
- [ ] A member route is refused before dispatch without a signed-in member (or one
      outside its groups), and receives the member otherwise; a public route
      receives no principal.
- [ ] A state-changing member route is protected against cross-site requests.
- [ ] Every public and member route can declare a rate limit, keyed by member or
      by the real caller.
- [ ] Capabilities stay per bundle, as declared; a public route reaches no more
      than a back-office one.
- [ ] `docs/bundles.md` Part 3 gains the audiences, and `tests/server-bundles.test.ts`
      holds the defaults (no public route unless declared).

## Out of scope

- Server-side rendering by a bundle (pages stay templates).
- A bundle widening a core route's access.
