import type { PageProps } from '@crombolo/crombolo'
import { BottlingCard } from '../shared/bottling.tsx'
import { shell } from '../shared/classes.ts'
import { Layout } from '../shared/layout.tsx'
import { PageHeader } from '../shared/section-intro.tsx'

export default function WhiskyList({ model, nav }: PageProps) {
  return (
    <Layout model={model} nav={nav}>
      <PageHeader model={model} />
      <section class={shell}>
        <ul class="mt-10 grid gap-6 md:grid-cols-2 md:gap-8">
          {nav.children(model).map((bottling) => (
            <BottlingCard bottling={bottling} detailed />
          ))}
        </ul>
      </section>
    </Layout>
  )
}
