import type { PageProps, PublishedContent, PublishedElement } from '@crombolo/crombolo'
import Compare, { type Bottling } from '../shared/compare.tsx'
import { Layout } from '../shared/layout.tsx'
import { PageHeader } from '../shared/section-intro.tsx'

/** Every bottling under the whisky list, as the comparison needs it. */
async function range(
  nav: PageProps['nav'],
): Promise<Array<{ page: PublishedContent; data: Bottling }>> {
  const pages = nav
    .root()
    .flatMap((root) => nav.children(root))
    .filter((page) => page.contentType.alias === 'whiskyList')
    .flatMap((list) => nav.children(list))
  return Promise.all(
    pages.map(async (page) => {
      const bottle = (await page.media('bottleImage'))[0]
      const src = bottle?.cropUrl({ width: 380, height: 570 })
      const notes = (page.value('tastingNotes') ?? []) as PublishedElement[]
      return {
        page,
        data: {
          id: page.key,
          title: page.text('title') || page.name,
          href: page.url,
          kind: page.text('kind'),
          productType: page.text('productType'),
          abv: page.text('abv'),
          age: page.text('age'),
          batch: page.text('batch'),
          summary: page.text('summary'),
          bottle: src ? { src, width: 380, height: 570, alt: bottle?.name ?? '' } : undefined,
          notes: notes.map((note) => ({ aspect: note.text('aspect'), note: note.text('note') })),
        },
      }
    }),
  )
}

/**
 * The bottlings side by side. The comparison is an island (story 209): until
 * it mounts, the range shows as a plain list of links, so the page works and is
 * read without JavaScript.
 */
export default async function ComparisonPage({ model, nav }: PageProps) {
  const bottlings = await range(nav)
  return (
    <Layout model={model} nav={nav}>
      <PageHeader model={model} />
      <section>
        <Compare bottlings={bottlings.map((b) => b.data)}>
          <ul class="compare__fallback">
            {bottlings.map(({ page, data }) => (
              <li>
                <a href={page.url}>{data.title}</a>
                <span class="eyebrow">{[data.kind, data.abv].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </Compare>
      </section>
    </Layout>
  )
}
