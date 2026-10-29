import { CmsPage } from '@/components/page'
import { crombolo } from '@/lib/crombolo'

/** The CMS's own not-found page when it has one. */
export default async function NotFound() {
  const page = await crombolo.notFoundPage()
  return page ? (
    <CmsPage page={page} />
  ) : (
    <header className="page-header">
      <h1>Page not found</h1>
    </header>
  )
}
