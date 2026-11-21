# Values per environment

A property may have a value for each copy of the site, beside its shared value
(story `387`): a production API address, a banner only staging shows. Each copy serves
its own environment's value where there is one, and the shared value otherwise.

## Which environment a copy is

- **`CROMBOLO_ENVIRONMENT`** (`environment` in `crombolo.config.ts`) names it: `local` in
  development, `production` otherwise. `remote.environment` defaults to it.
- **The environments that exist** are the schema's, so every copy edits the same set:

  ```toml
  # schema/schema.toml
  [environments]
  names = ["staging", "production"]
  ```

- `GET <backoffice>/crombolo/api/environment-values` answers
  `{ current, names, readOnly }`.

## A property that varies by environment

```toml
[[property]]
alias = "apiAddress"
name = "API address"
type = "textstring"
varies-by-environment = true
```

- **Stored** as `property_value.environment` (migration 089) beside language and segment,
  null for the shared value. The shared value is optional: an environment with no value
  of its own, and no shared one, reads the property as empty.
- **Rendering, the Delivery API and templates** read the property as they always have and
  get the current environment's value (`forEnvironment` in `@crombolo/core`), the
  published cache, drafts, previews and a workspace's site alike.
- **The editor** edits the shared value in the field. "Values per environment" in the
  field's actions opens the others: one row per environment, the current one marked, and
  any value kept for an environment the site no longer names, to remove. A save of the
  page from the editor keeps each environment's value; one set in the dialog is saved as
  an edit of the page and shows once the page is published.
- **Not for secrets.** Every value is on every copy of the site and in every change: keep
  anything that must not be read in the site's own settings.

## Moving between copies

Every environment's value travels with the others: a change (`changes.md`) and a content
bundle carry each one, so every copy holds the same set and the change shows
"production" beside its value. A copy can refuse to set its own values here, taking them
only by a change: `CROMBOLO_ENVIRONMENT_VALUES_READONLY=true`, or `CROMBOLO_CONTENT=locked`
(story `388`).

## From the command line and content files

- `crombolo content update /Home --set apiAddress@production=https://api.example.com`, and
  `--unset apiAddress@production` to clear it.
- A content file: `"apiAddress@production" = "https://api.example.com"` under `[values]`,
  beside the shared `apiAddress = …`.

## Turning it on and off

Turning it on keeps a property's values as its shared value. Turning it off keeps the
shared value and drops each environment's own: a lossy change
(`property-environments-dropped`, story `382`) that a merge refuses until it is accepted.
An environment taken out of `names` keeps its values, shown as belonging to an
environment the site no longer has until they are removed.
