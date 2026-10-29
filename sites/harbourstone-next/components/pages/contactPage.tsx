import { Form, type PageProps, type SchemaForm } from '@crombolo/crombolo'
import { Layout } from '../shared/layout.tsx'
import { Eyebrow, PageHeader } from '../shared/section-intro.tsx'

export default async function ContactPage({ model, nav, submission }: PageProps) {
  // A `formPicker` property arrives as the definition itself, so there is
  // nothing to look up here. `value()` is untyped — `crombolo generate` is what
  // types a model — so the cast is what a hand-written view pays.
  //
  // `submission` is what just happened to a post on this page: passing it
  // through is what makes a refused submission come back with its errors inside
  // this layout rather than on a bare page.
  const form = model.value('enquiryForm') as SchemaForm | null
  const image = (await model.media('asideImage'))[0]
  return (
    <Layout model={model} nav={nav}>
      <PageHeader model={model} />
      <section class="contact">
        <div class="contact__form">
          {form ? <Form form={form} submission={submission} /> : null}
        </div>
        <aside class="contact__aside">
          <Eyebrow>{model.text('asideEyebrow')}</Eyebrow>
          <h2>{model.text('asideHeading')}</h2>
          <div class="prose">{model.html('asideBody')}</div>
          {image ? (
            <img src={image.cropUrl({ width: 1200, height: 800 })} alt={image.name} />
          ) : null}
        </aside>
      </section>
    </Layout>
  )
}
