import { display, prose, shell } from '@/lib/classes'
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
  if (!form) return <p className="text-muted">Loading the form…</p>
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
      <section className={`${shell} grid gap-12 pt-12 pb-16 md:grid-cols-[3fr_2fr] md:gap-16`}>
        <div>{id ? <FreshForm id={id} /> : null}</div>
        <aside>
          <Eyebrow>{page.properties.asideEyebrow}</Eyebrow>
          <h2 className={`${display} mt-3 text-3xl`}>{page.properties.asideHeading}</h2>
          <RichText value={richText(page, 'asideBody')} className={`${prose} mt-5`} />
          <Picture media={image(page, 'asideImage')} className="mt-8 h-56 w-full object-cover" />
        </aside>
      </section>
    </>
  )
}
