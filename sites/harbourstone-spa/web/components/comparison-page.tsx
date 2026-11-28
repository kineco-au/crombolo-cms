import { cms } from '@/lib/cms'
import { elements, hrefOf, image, imageOf, type Page, text } from '@/lib/content'
import { useLoad } from '@/lib/use-load'
import { type Bottling, Compare } from './compare'
import { PageHeader } from './section-intro'

/** Every bottling, read once; the choosing happens in the browser. */
async function bottlings(): Promise<Bottling[]> {
  const range = await cms.content({
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
      bottle: bottle ? imageOf(bottle) : undefined,
      notes: elements(item, 'tastingNotes').map((note) => ({
        aspect: text(note, 'aspect'),
        note: text(note, 'note'),
      })),
    }
  })
}

export function ComparisonPage({ page }: { page: Page }) {
  const all = useLoad('bottlings', bottlings)
  return (
    <>
      <PageHeader page={page} />
      {all ? (
        <Compare bottlings={all} />
      ) : (
        <p className="page-column text-muted">Loading the comparison…</p>
      )}
    </>
  )
}
