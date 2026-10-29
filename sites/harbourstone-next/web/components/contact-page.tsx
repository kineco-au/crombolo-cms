import { RichText } from '@crombolo/next-integration/components'
import { Suspense } from 'react'
import { image, type Page, richText, text } from '@/lib/content'
import { crombolo } from '@/lib/crombolo'
import { EnquiryForm, type FormDefinition } from './enquiry-form'
import { Picture } from './picture'
import { Eyebrow, PageHeader } from './section-intro'

/** The form, drawn fresh on every request: its token carries when it was drawn. */
async function FreshForm({ id }: { id: string }) {
  const form = (await crombolo.fresh.form(id)) as FormDefinition | undefined
  return form ? <EnquiryForm form={form} /> : null
}

export function ContactPage({ page }: { page: Page }) {
  const picked = (page.properties as Record<string, unknown>).enquiryForm as { id?: string } | null
  return (
    <>
      <PageHeader page={page} />
      <section className="contact">
        <div className="contact__form">
          {picked?.id ? (
            <Suspense fallback={<p>Loading the form…</p>}>
              <FreshForm id={picked.id} />
            </Suspense>
          ) : null}
        </div>
        <aside className="contact__aside">
          <Eyebrow>{text(page, 'asideEyebrow')}</Eyebrow>
          <h2>{text(page, 'asideHeading')}</h2>
          <RichText value={richText(page, 'asideBody')} className="prose" />
          <Picture media={image(page, 'asideImage')} />
        </aside>
      </section>
    </>
  )
}
