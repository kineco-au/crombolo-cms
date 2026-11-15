import { childrenOf, type Page } from '@/lib/content'
import { useLoad } from '@/lib/use-load'
import { BottlingCard } from './bottling'
import { PageHeader } from './section-intro'

export function WhiskyList({ page }: { page: Page }) {
  const bottlings = useLoad(page.id, () => childrenOf(page))
  return (
    <>
      <PageHeader page={page} />
      <section>
        <ul className="bottlings">
          {(bottlings ?? []).map((bottling) => (
            <BottlingCard key={bottling.id} bottling={bottling} detailed />
          ))}
        </ul>
      </section>
    </>
  )
}
