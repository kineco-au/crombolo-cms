import { Form, type PageProps, type SchemaForm } from '@crombolo/crombolo'
import ContactForm from '../shared/contact-form.tsx'
import { Layout } from '../shared/layout.tsx'

export default function ContactPage({ model, nav, submission }: PageProps) {
  // A form picker hands the view the form itself. The island draws it from the
  // Delivery API by alias; the server's own <Form> is its fallback, so the page
  // works before the island mounts and wherever scripts do not run.
  const form = model.value('contactForm') as SchemaForm | null
  return (
    <Layout model={model} nav={nav}>
      <header class="page-header">
        <h1>{model.text('title')}</h1>
        {model.hasValue('standfirst') ? <p class="standfirst">{model.text('standfirst')}</p> : null}
      </header>
      <section class="contact">
        <div class="contact__form">
          {form ? (
            <ContactForm
              alias={form.alias}
              load="visible"
              fallback={<Form form={form} submission={submission} />}
            />
          ) : null}
        </div>
        {model.hasValue('aside') ? (
          <aside class="contact__aside prose">{model.html('aside')}</aside>
        ) : null}
      </section>
    </Layout>
  )
}
