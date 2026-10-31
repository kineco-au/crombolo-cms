import type { Navigation, PublishedContent } from '@crombolo/crombolo'

/** Every article under the given pages, newest first. */
export function articlesUnder(
  nav: Navigation,
  pages: readonly PublishedContent[],
): PublishedContent[] {
  const found = pages.flatMap((page) =>
    page.contentType.alias === 'article' ? [page] : articlesUnder(nav, nav.children(page)),
  )
  return found.sort((a, b) => dateOf(b) - dateOf(a))
}

const dateOf = (article: PublishedContent) =>
  Date.parse(String(article.value('publishedOn') ?? '')) || 0

/** An article's date as a reader reads it: 4 December 2024. */
export function displayDate(article: PublishedContent): string {
  const at = dateOf(article)
  if (!at) return ''
  return new Date(at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** A card linking to an article: its image, section, headline and standfirst. */
export async function ArticleCard({
  article,
  nav,
  lead = false,
}: {
  article: PublishedContent
  nav: Navigation
  lead?: boolean
}) {
  const image = (await article.media('heroImage'))[0]
  const section = nav.parent(article)
  return (
    <article class={lead ? 'card card--lead' : 'card'}>
      {image ? (
        <div class="card__image">
          <img
            src={image.cropUrl(lead ? { width: 1200, height: 700 } : { width: 640, height: 400 })}
            alt=""
            loading={lead ? undefined : 'lazy'}
          />
        </div>
      ) : null}
      <div class="card__text">
        {section ? <p class="kicker">{section.name}</p> : null}
        <h2 class="card__headline">
          <a href={article.url}>{article.text('title')}</a>
        </h2>
        <p class="card__standfirst">{article.text('standfirst')}</p>
        <p class="meta">{displayDate(article)}</p>
      </div>
    </article>
  )
}
