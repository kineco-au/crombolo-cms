import type { ContentItem } from '@crombolo/next-integration'

/** A page from the CMS. Add a component per content type as the site grows. */
export function ContentPage({ item }: { item: ContentItem }) {
  return (
    <main>
      <h1>{item.name}</h1>
    </main>
  )
}
