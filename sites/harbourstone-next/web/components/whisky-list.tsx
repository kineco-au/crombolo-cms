import { childrenOf, type Page } from '@/lib/content'
import { BottlingCard } from './bottling'
import { PageHeader } from './section-intro'

export async function WhiskyList({ page }: { page: Page }) {
  const bottlings = await childrenOf(page)
  return (
    <>
      <PageHeader page={page} />
      <section>
        <ul className="bottlings">
          {bottlings.map((bottling) => (
            <BottlingCard key={bottling.id} bottling={bottling} detailed />
          ))}
        </ul>
      </section>
    </>
  )
}
