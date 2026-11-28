import { Form, type PageProps, type SchemaForm } from '@crombolo/crombolo'
import { Layout } from '../shared/layout.tsx'
import { PageHeader } from '../shared/page-header.tsx'

/**
 * The CMS draws the form's markup, so it is styled from here, by element. No selector
 * nests brackets: the class scanner reads `[&_[x]]:…` as no class at all.
 */
const FORM = [
  '[&_fieldset>div]:grid [&_fieldset>div]:gap-5 [&_form]:space-y-6',
  '[&_label]:mb-1 [&_label]:block [&_label]:font-semibold [&_label>span]:ms-0.5 [&_label>span]:text-green',
  '[&_:is(input,textarea,select)]:w-full [&_:is(input,textarea,select)]:rounded [&_:is(input,textarea,select)]:border [&_:is(input,textarea,select)]:border-line [&_:is(input,textarea,select)]:bg-white [&_:is(input,textarea,select)]:px-3 [&_:is(input,textarea,select)]:py-2',
  '[&_:is(input,textarea,select)]:focus:border-green [&_:is(input,textarea,select)]:focus:ring-2 [&_:is(input,textarea,select)]:focus:ring-green/20 [&_:is(input,textarea,select)]:focus:outline-none',
  '[&_label+p]:mb-1 [&_label+p]:text-sm [&_label+p]:text-muted',
  '[&_:is(input,textarea,select)+p]:mt-1 [&_:is(input,textarea,select)+p]:text-sm [&_:is(input,textarea,select)+p]:text-danger',
  '[&_form>div:has(>ul)]:rounded [&_form>div:has(>ul)]:border [&_form>div:has(>ul)]:border-danger/30 [&_form>div:has(>ul)]:bg-danger/5 [&_form>div:has(>ul)]:px-4 [&_form>div:has(>ul)]:py-3 [&_form>div:has(>ul)]:text-danger',
  '[&_form>div>ul]:list-disc [&_form>div>ul]:ps-5',
  '[&_button]:cursor-pointer [&_button]:rounded [&_button]:bg-green [&_button]:px-5 [&_button]:py-2.5 [&_button]:text-white [&_button]:transition-colors [&_button]:hover:bg-green-deep',
  '[&>div]:rounded [&>div]:border [&>div]:border-green/30 [&>div]:bg-green/5 [&>div]:p-5 [&>div]:text-green-deep',
].join(' ')

/** Passing `submission` on keeps a refused post's errors inside this layout. */
export default function ContactPage(props: PageProps) {
  const { model, submission } = props
  const form = model.value('enquiryForm') as SchemaForm | null
  return (
    <Layout {...props}>
      <PageHeader model={model} />
      <section class={`page-column grid grid-cols-1 gap-12 md:grid-cols-5`}>
        <div class={`md:col-span-3 ${FORM}`}>
          {form ? <Form form={form} submission={submission} /> : null}
        </div>
        <aside class={`prose-site md:col-span-2`}>{model.html('aside')}</aside>
      </section>
    </Layout>
  )
}
