---
title: Tables of your own
summary: Keep data that isn't content in tables of the site's own, migrated with the site, and query it from pages and routes with named queries.
order: 8
---

Some data isn't content: sightings, bookings, scores, a log of what members did. A site can keep it in tables of its own, beside the content, without a second database. You declare the tables in `crombolo.config.ts`, and crombolo creates and upgrades them with the site, backs them up with it, and keeps them apart from its own.

## Declare the tables

Tables are declared as a list of **steps**. Each step changes the tables a little, and once it has shipped it is never edited: the next change is a new step.

```ts
// crombolo.config.ts
import { defineConfig, defineSiteTables } from '@crombolo/crombolo'
import * as sightings from './queries/sightings.ts'

export const tables = defineSiteTables([
  {
    name: 'sightings',
    release: '1.0.0',
    up: (s) => [
      s.createTable('species', {
        id: s.integer().primaryKey(),
        name: s.text(),
      }),
      s.createTable('sighting', {
        id: s.uuid().primaryKey(),
        species_id: s.integer().references('species', { onDelete: 'cascade' }),
        count: s.integer().default(1),
        seen_at: s.timestamp(),
        notes: s.text().nullable(),
      }),
    ],
  },
])

export default defineConfig({
  siteName: 'My Site',
  database: { tables },
  queries: { sightings },
})
```

The next time the site starts in development, the tables are created. In production, `crombolo upgrade` creates them, as it applies crombolo's own upgrades, and `crombolo upgrade --plan` shows what it will do first.

| Columns | Options |
| --- | --- |
| `uuid`, `varchar(n)`, `text`, `integer`, `bigint`, `boolean`, `timestamp`, `json`, `decimal(precision, scale)` | `nullable()`, `default(value)`, `primaryKey()`, `indexed()`, `unique()`, `references(table)` |

A later step can add a table or column, add an index, or widen a column. Removing something is its own step, in a major release of the site.

```ts
{
  name: 'sighting-place',
  release: '1.1.0',
  up: (s) => [
    s.addColumn('sighting', 'place', s.text().nullable()),
    s.addIndex('sighting', ['species_id', 'seen_at'], { descending: ['seen_at'] }),
  ],
},
```

When the builder can't say what you need, such as a view, a step can be SQL instead, written for SQLite and for Postgres: `{ name, release, sql: { sqlite: [...], postgres: [...] } }`.

## Write a query

A **named query** is a function in a module of your own. It's given the tables, as a [Kysely](https://kysely.dev) query builder typed from your steps, and who is asking. It returns a result: `ok(value)`, or an outcome such as `Outcome.notFound()`.

```ts
// queries/sightings.ts
import type { TablesDatabase } from '@crombolo/crombolo'
import { ok, Outcome, type QueryCaller } from '@crombolo/crombolo/server'
import type { tables } from '../crombolo.config.ts'

type Db = TablesDatabase<typeof tables>

export async function recent(db: Db, _caller: QueryCaller, speciesId: number) {
  const rows = await db
    .selectFrom('sighting')
    .innerJoin('species', 'species.id', 'sighting.species_id')
    .select(['sighting.id', 'species.name', 'sighting.count', 'sighting.seen_at'])
    .where('sighting.species_id', '=', speciesId)
    .orderBy('sighting.seen_at', 'desc')
    .limit(20)
    .execute()
  return rows.length > 0 ? ok(rows) : Outcome.notFound('No sightings yet.')
}

export async function add(db: Db, caller: QueryCaller, speciesId: number) {
  if (!(await caller.member())) return Outcome.unauthorized('Sign in to add a sighting.')
  await db
    .insertInto('sighting')
    .values({ id: crypto.randomUUID(), species_id: speciesId, seen_at: new Date() })
    .execute()
  return ok(true)
}
```

The same query runs on SQLite and on Postgres. Booleans read back as `true` or `false`, timestamps as dates, and `json` columns as values, on both.

## Call it from a page or a route

```tsx
import { site } from '@crombolo/crombolo/server'

export default async function Species({ model }) {
  const sightings = (await site().queries.sightings.recent(model.value('speciesId'))).unwrap()
  return <ul>{sightings.map((s) => <li>{s.name}: {s.count}</li>)}</ul>
}
```

To have the call typed, add this to `crombolo.config.ts`:

```ts
declare module '@crombolo/crombolo/server' {
  interface Register {
    queries: { sightings: typeof sightings }
  }
}
```

`caller.member()` is the signed-in member, if there is one. Asking for it makes the page personal, so it is never shared between visitors. Code in the browser, such as an island, reaches a query through one of the site's routes.

## Where the data lives

- **On SQLite**, the tables are in a file beside the site's database: `crombolo.site.sqlite` next to `crombolo.sqlite`.
- **On Postgres**, they are in a schema called `site`, owned by a database role crombolo makes for this site. Queries run as that role, so they can't reach crombolo's own tables. The database user needs permission to create roles. If it hasn't got it, the first start prints the statements to run once.

The backup taken before an upgrade includes the tables. `crombolo export --with-site-data` carries them in a whole-site file, sealed under a passphrase, and importing the file writes them back. With `--anonymise`, only the tables you list under `database.anonymise` keep their rows, and you choose which columns are rewritten: `member` keeps a member's key only if that member travels too, `email` replaces an address the same way everywhere in the file, and `scrub` empties the column:

```ts
database: {
  tables,
  anonymise: {
    species: 'keep',
    sighting: { notes: 'scrub' },
  },
},
```
