import { Form, type PageProps, type SchemaForm } from '@crombolo/crombolo'
import { headline, standfirst } from '../shared/articles.tsx'
import ContactForm from '../shared/contact-form.tsx'
import { Layout, prose } from '../shared/layout.tsx'

/**
 * The server's own form, shown until the island mounts and wherever scripts do
 * not run. Its markup is the CMS's, so it is styled from here to match the island.
 * The CMS's class scanner does not read an attribute value inside a variant's brackets
 * (`[type=checkbox]`), so `:read-write` picks out the text fields, and a field holding
 * any other input is the checkbox.
 */
const fallback = [
  '[&_.crombolo-form_[data-field]]:mb-5 [&_.crombolo-form_[data-field]]:grid [&_.crombolo-form_[data-field]]:gap-1.5',
  '[&_.crombolo-form_[data-field]:has(input:not(:read-write))]:flex [&_.crombolo-form_[data-field]:has(input:not(:read-write))]:flex-row-reverse [&_.crombolo-form_[data-field]:has(input:not(:read-write))]:items-baseline [&_.crombolo-form_[data-field]:has(input:not(:read-write))]:justify-end [&_.crombolo-form_[data-field]:has(input:not(:read-write))]:gap-2.5',
  '[&_.crombolo-form_label]:font-medium [&_.crombolo-form_p]:text-sm [&_.crombolo-form_p]:text-muted',
  '[&_.crombolo-form_:is(:read-write,select)]:w-full [&_.crombolo-form_:is(:read-write,select)]:rounded [&_.crombolo-form_:is(:read-write,select)]:border [&_.crombolo-form_:is(:read-write,select)]:border-rule [&_.crombolo-form_:is(:read-write,select)]:px-3 [&_.crombolo-form_:is(:read-write,select)]:py-2',
  '[&_.crombolo-form_input:not(:read-write)]:size-4 [&_.crombolo-form_input:not(:read-write)]:shrink-0 [&_.crombolo-form_input:not(:read-write)]:accent-accent',
  '[&_.crombolo-form_button]:cursor-pointer [&_.crombolo-form_button]:rounded [&_.crombolo-form_button]:bg-ink [&_.crombolo-form_button]:px-6 [&_.crombolo-form_button]:py-2.5 [&_.crombolo-form_button]:font-semibold [&_.crombolo-form_button]:text-paper',
].join(' ')

export default function ContactPage({ model, nav, submission }: PageProps) {
  // A form picker hands the view the form itself. The island draws it from the
  // Delivery API by alias; the server's own <Form> is its fallback, so the page
  // works before the island mounts and wherever scripts do not run.
  const form = model.value('contactForm') as SchemaForm | null
  return (
    <Layout model={model} nav={nav}>
      <div class="mx-auto max-w-4xl">
        <header class="mb-10 max-w-2xl">
          <h1 class={headline}>{model.text('title')}</h1>
          {model.hasValue('standfirst') ? (
            <p class={standfirst}>{model.text('standfirst')}</p>
          ) : null}
        </header>
        <section class="grid gap-12 md:grid-cols-[3fr_2fr]">
          <div class={fallback}>
            {form ? (
              <ContactForm
                alias={form.alias}
                load="visible"
                fallback={<Form form={form} submission={submission} />}
              />
            ) : null}
          </div>
          {model.hasValue('aside') ? (
            <aside
              class={`${prose} border-t border-rule pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-8`}
            >
              {model.html('aside')}
            </aside>
          ) : null}
        </section>
      </div>
    </Layout>
  )
}
