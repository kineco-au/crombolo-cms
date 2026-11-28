import { CmsPage } from '@/components/page'
import { crombolo } from '@/lib/crombolo'

/** The CMS's own not-found page when it has one. */
export default async function NotFound() {
  const page = await crombolo.notFoundPage()
  return page ? (
    <CmsPage page={page} />
  ) : (
    <header className="page-column pt-16 pb-6 md:pt-24">
      <h1 className="heading-display text-5xl leading-none md:text-7xl">Page not found</h1>
    </header>
  )
}
