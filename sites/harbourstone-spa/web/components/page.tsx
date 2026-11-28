import { shell } from '@/lib/classes'
import type { Page } from '@/lib/content'
import { ComparisonPage } from './comparison-page'
import { ContactPage } from './contact-page'
import { ContentPage } from './content-page'
import { Expression } from './expression'
import { HomePage } from './home-page'
import { SearchPage } from './search-page'
import { Eyebrow, PageHeader, PageTitle, Standfirst } from './section-intro'
import { WhiskyList } from './whisky-list'

/** A page from the CMS, through the component for its content type. */
export function CmsPage({ page }: { page: Page }) {
  switch (page.contentType) {
    case 'homePage':
      return <HomePage page={page} />
    case 'contentPage':
      return <ContentPage page={page} />
    case 'whiskyList':
      return <WhiskyList page={page} />
    case 'expression':
      return <Expression page={page} />
    case 'comparisonPage':
      return <ComparisonPage page={page} />
    case 'contactPage':
      return <ContactPage page={page} />
    case 'searchPage':
      return <SearchPage page={page} />
    default:
      return <PageHeader page={page} />
  }
}

/** The app's own answer for an address that is no page, or the site's not-found page when it has one. */
export function NotFound({ page }: { page: Page | null }) {
  if (page) return <CmsPage page={page} />
  return (
    <header className={`${shell} pt-16 pb-6 md:pt-24`}>
      <Eyebrow>Not found</Eyebrow>
      <PageTitle>There is no page here.</PageTitle>
      <Standfirst>It may have moved, or the address may be mistyped.</Standfirst>
    </header>
  )
}
