import type { Page } from '@/lib/content'
import { ComparisonPage } from './comparison-page'
import { ContactPage } from './contact-page'
import { ContentPage } from './content-page'
import { Expression } from './expression'
import { HomePage } from './home-page'
import { SearchPage } from './search-page'
import { PageHeader } from './section-intro'
import { WhiskyList } from './whisky-list'

type Query = Promise<Record<string, string | string[] | undefined>>

/** A page from the CMS, through the component for its content type. */
export function CmsPage({ page, searchParams }: { page: Page; searchParams?: Query }) {
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
      return <SearchPage page={page} searchParams={searchParams ?? Promise.resolve({})} />
    default:
      return <PageHeader page={page} />
  }
}
