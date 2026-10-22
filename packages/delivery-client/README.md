# @crombolo/delivery-client

A typed client for a [crombolo](https://github.com/kineco-au/crombolo-cms) site's
Delivery API, for an app in the browser, Node or Bun. No dependencies.

```sh
npm install @crombolo/delivery-client
# in the site: write its types into the app
bunx crombolo generate --delivery --out ../app/src/cms-types.ts
```

```ts
import { createDeliveryClient, isExpanded } from '@crombolo/delivery-client'
import type { DeliveryTypes } from './cms-types'

const cms = createDeliveryClient<DeliveryTypes>({ baseUrl: 'https://cms.example.com' })

const page = await cms.item('/news/story', { expand: 'properties[related]' })
if (page?.contentType === 'article') {
  console.log(page.properties.title)
  const related = page.properties.related
  if (related && isExpanded(related)) console.log(related.properties)
}

const latest = await cms.content({ fetch: 'children:/news', sort: 'createDate:desc', take: 5 })
const hits = await cms.search('harbour')
```

- `item`, `items`, `content`, `mediaItem`, `mediaItems`, `media` and `search`,
  with the API's own `expand`, `fields`, `fetch`, `filter` and `sort` grammar.
- `apiKey`, `culture`, `startItem` and `memberToken` options, each overridable
  per request. Keep an API key out of code that runs in a browser.
- An item that is not there is `undefined`; anything else refused throws a
  `DeliveryError` with its `status` and `body`.
- A browser app on another origin needs the site to allow it:
  `deliveryApi.cors.allowedOrigins`.

The site's docs describe the API and the generated types: `docs/delivery-api.md`.
