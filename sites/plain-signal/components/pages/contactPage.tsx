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
      <div class="mx-auto max-w-4xl">
        <header class="mb-10 max-w-2xl">
          <h1 class="headline">{model.text('title')}</h1>
          {model.hasValue('standfirst') ? (
            <p class="standfirst">{model.text('standfirst')}</p>
          ) : null}
        </header>
        <section class="grid gap-12 md:grid-cols-[3fr_2fr]">
          <div class="form-site">
            {form ? (
              <ContactForm
                alias={form.alias}
                load="visible"
                fallback={<Form form={form} submission={submission} />}
              />
            ) : null}
          </div>
          {model.hasValue('aside') ? (
            <aside class="prose-site border-t border-rule pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-8">
              {model.html('aside')}
            </aside>
          ) : null}
        </section>
      </div>
    </Layout>
  )
}
