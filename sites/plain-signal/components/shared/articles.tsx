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
    <article
      class={
        lead
          ? 'mb-10 grid items-center gap-6 border-b border-rule pb-10 md:grid-cols-[3fr_2fr] md:gap-8'
          : 'grid content-start gap-4'
      }
    >
      {image ? (
        <img
          class="aspect-[16/10] w-full rounded object-cover"
          src={image.cropUrl(lead ? { width: 1200, height: 700 } : { width: 640, height: 400 })}
          alt=""
          loading={lead ? undefined : 'lazy'}
        />
      ) : null}
      <div class="flex flex-col gap-2">
        {section ? <p class="kicker">{section.name}</p> : null}
        <h2
          class={
            lead
              ? 'font-serif text-3xl/tight font-bold text-balance lg:text-4xl/tight'
              : 'font-serif text-xl/snug font-bold text-balance'
          }
        >
          <a
            class="decoration-accent decoration-2 underline-offset-4 hover:underline"
            href={article.url}
          >
            {article.text('title')}
          </a>
        </h2>
        <p class={lead ? 'text-lg/relaxed text-muted' : 'text-muted'}>
          {article.text('standfirst')}
        </p>
        <p class="text-sm text-muted">{displayDate(article)}</p>
      </div>
    </article>
  )
}
