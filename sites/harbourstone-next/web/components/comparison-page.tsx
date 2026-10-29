import { cromboloImage } from '@crombolo/next-integration/image-loader'
import { Suspense } from 'react'
import { elements, hrefOf, image, type Page, text } from '@/lib/content'
import { crombolo } from '@/lib/crombolo'
import { type Bottling, Compare } from './compare'
import { PageHeader } from './section-intro'

/** Every bottling, once, kept and tagged like any public read; the choosing happens in the browser. */
async function bottlings(): Promise<Bottling[]> {
  const range = await crombolo.content({
    filter: 'contentType:expression',
    sort: 'sortOrder:asc',
    take: 100,
  })
  return range.items.map((item) => {
    const bottle = image(item, 'bottleImage')
    return {
      id: item.id,
      title: text(item, 'title') || item.name,
      href: hrefOf(item),
      kind: text(item, 'kind'),
      productType: text(item, 'productType'),
      abv: text(item, 'abv'),
      age: text(item, 'age'),
      batch: text(item, 'batch'),
      summary: text(item, 'summary'),
      bottle: bottle ? cromboloImage(bottle) : undefined,
      notes: elements(item, 'tastingNotes').map((note) => ({
        aspect: text(note, 'aspect'),
        note: text(note, 'note'),
      })),
    }
  })
}

export async function ComparisonPage({ page }: { page: Page }) {
  const all = await bottlings()
  return (
    <>
      <PageHeader page={page} />
      {/* The selection lives in the address, which only the browser knows. */}
      <Suspense fallback={<p>Loading the comparison…</p>}>
        <Compare bottlings={all} />
      </Suspense>
    </>
  )
}
