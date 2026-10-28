# @crombolo/backoffice-host

**Internal to crombolo.** This package is published because
[`@crombolo/crombolo`](https://www.npmjs.com/package/@crombolo/crombolo)
depends on it, and its exports can change in any release, a patch included.

Import from `@crombolo/crombolo` instead:

- `@crombolo/crombolo` for a site: its config, its boot and its views.
- `@crombolo/crombolo/bundle` for a server bundle's author.
- `@crombolo/crombolo/host` for whoever runs sites.

Those three entry points carry the compatibility promise in
[`docs/api.md`](https://github.com/kineco-au/crombolo-cms/blob/main/docs/api.md).
