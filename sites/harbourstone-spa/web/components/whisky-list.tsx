import { childrenOf, type Page } from '@/lib/content'
import { useLoad } from '@/lib/use-load'
import { BottlingCard } from './bottling'
import { PageHeader } from './section-intro'

export function WhiskyList({ page }: { page: Page }) {
  const bottlings = useLoad(page.id, () => childrenOf(page))
  return (
    <>
      <PageHeader page={page} />
      <section className="page-column">
        <ul className="mt-10 grid gap-6 lg:grid-cols-2">
          {(bottlings ?? []).map((bottling) => (
            <BottlingCard key={bottling.id} bottling={bottling} detailed />
          ))}
        </ul>
      </section>
    </>
  )
}
