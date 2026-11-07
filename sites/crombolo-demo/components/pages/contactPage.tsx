import { Form, type PageProps, type SchemaForm } from '@crombolo/crombolo'
import { Layout } from '../shared/layout.tsx'
import { PageHeader } from '../shared/page-header.tsx'

/** Passing `submission` on keeps a refused post's errors inside this layout. */
export default function ContactPage(props: PageProps) {
  const { model, submission } = props
  const form = model.value('enquiryForm') as SchemaForm | null
  return (
    <Layout {...props}>
      <PageHeader model={model} />
      <section class="wrap contact">
        <div>{form ? <Form form={form} submission={submission} /> : null}</div>
        <aside class="prose">{model.html('aside')}</aside>
      </section>
    </Layout>
  )
}
