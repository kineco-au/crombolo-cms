import { cms } from '@/lib/cms'
import { image, type PageOf, richText } from '@/lib/content'
import { useLoad } from '@/lib/use-load'
import { EnquiryForm, type FormDefinition } from './enquiry-form'
import { Picture } from './picture'
import { RichText } from './rich-text'
import { Eyebrow, PageHeader } from './section-intro'

/** The form, drawn by the app from the site's own definition (story 056). */
function FreshForm({ id }: { id: string }) {
  const form = useLoad(id, () => cms.form(id))
  if (!form) return <p>Loading the form…</p>
  return <EnquiryForm form={form as unknown as FormDefinition} />
}

/** The form picker's value: its key, or the form itself when expanded. */
const formKeyOf = (value: unknown) =>
  typeof value === 'string' ? value : (value as { id?: string } | null)?.id

export function ContactPage({ page }: { page: PageOf<'contactPage'> }) {
  const id = formKeyOf(page.properties.enquiryForm)
  return (
    <>
      <PageHeader page={page} />
      <section className="contact">
        <div className="contact__form">{id ? <FreshForm id={id} /> : null}</div>
        <aside className="contact__aside">
          <Eyebrow>{page.properties.asideEyebrow}</Eyebrow>
          <h2>{page.properties.asideHeading}</h2>
          <RichText value={richText(page, 'asideBody')} className="prose" />
          <Picture media={image(page, 'asideImage')} />
        </aside>
      </section>
    </>
  )
}
