import { ContentPage } from '@/components/content-page'
import { crombolo } from '@/lib/crombolo'

/** The CMS's own not-found page when it has one. */
export default async function NotFound() {
  const item = await crombolo.notFoundPage()
  return item ? <ContentPage item={item} /> : <h1>Page not found</h1>
}
