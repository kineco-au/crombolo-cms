import { type BlockItem, Blocks, type PageProps } from '@crombolo/crombolo'
import { Layout } from '../shared/layout.tsx'

/** Everything here is blocks, so an editor rearranges the page without touching this file. */
export default function HomePage(props: PageProps) {
  return (
    <Layout {...props}>
      <Blocks items={props.model.value('blocks') as BlockItem[]} />
    </Layout>
  )
}
