import type { PageProps, PublishedElement } from '@crombolo/crombolo'
import { Layout } from '../shared/layout.tsx'
import { PageHeader } from '../shared/page-header.tsx'
import { PersonCard } from '../shared/person-card.tsx'

/** The people picked here live in the Library, so a blog post can name the same person. */
export default function PeoplePage(props: PageProps) {
  const people = (props.model.value('people') ?? []) as PublishedElement[]
  return (
    <Layout {...props}>
      <PageHeader model={props.model} />
      <ul class="people wrap">
        {people.map((person) => (
          <PersonCard person={person} />
        ))}
      </ul>
    </Layout>
  )
}
