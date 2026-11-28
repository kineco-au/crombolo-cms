/**
 * `<Form>` writes its own markup, so it is styled from a wrapper given these: each class
 * reaches a part by element and position rather than by the form's own class
 * names, whose underscores Tailwind reads as spaces. The text controls are
 * `:read-write`, which a tick box is not.
 */
export const formClasses = [
  // a page's fields, and a group's caption
  '[&_fieldset>div]:grid [&_fieldset>div]:gap-5',
  '[&_legend]:mb-4 [&_legend]:text-xs [&_legend]:font-medium [&_legend]:tracking-caps [&_legend]:text-brass-deep [&_legend]:uppercase',
  // a field's label, the mark of a required one, and its help
  '[&_label]:block [&_label]:text-xs [&_label]:font-medium [&_label]:tracking-widest [&_label]:text-muted [&_label]:uppercase',
  '[&_label>span]:ml-1 [&_label>span]:text-brass-deep',
  '[&_label+p]:mt-1 [&_label+p]:text-sm [&_label+p]:text-muted',
  // the controls
  '[&_:is(:read-write,select)]:mt-2 [&_:is(:read-write,select)]:w-full [&_:is(:read-write,select)]:border [&_:is(:read-write,select)]:border-line [&_:is(:read-write,select)]:bg-card [&_:is(:read-write,select)]:p-3 [&_:is(:read-write,select)]:text-base [&_:is(:read-write,select)]:text-ink [&_:is(:read-write,select)]:outline-none [&_:is(:read-write,select)]:focus-visible:border-brass [&_:is(:read-write,select)]:aria-invalid:border-wine [&_textarea]:resize-y',
  // what went wrong: under a field, and the summary at the top
  '[&_:is(input,select,textarea)~p]:mt-2 [&_:is(input,select,textarea)~p]:text-sm [&_:is(input,select,textarea)~p]:text-wine',
  '[&_form>div:has(>ul)]:mb-6 [&_form>div:has(>ul)]:border [&_form>div:has(>ul)]:border-wine [&_form>div:has(>ul)]:bg-wine/5 [&_form>div:has(>ul)]:p-4 [&_form>div:has(>ul)]:text-wine',
  // a tick box reads box then label, so its field is a row with the box moved first
  '[&_div:has(>input:not(:read-write))]:flex [&_div:has(>input:not(:read-write))]:flex-wrap [&_div:has(>input:not(:read-write))]:gap-x-3 [&_div:has(>input:not(:read-write))]:gap-y-1',
  '[&_input:not(:read-write)]:order-first [&_input:not(:read-write)]:mt-0.5 [&_input:not(:read-write)]:size-4 [&_input:not(:read-write)]:accent-brass-deep',
  '[&_div:has(>input:not(:read-write))>label]:flex-1 [&_div:has(>input:not(:read-write))>label]:text-base [&_div:has(>input:not(:read-write))>label]:font-normal [&_div:has(>input:not(:read-write))>label]:tracking-normal [&_div:has(>input:not(:read-write))>label]:text-ink [&_div:has(>input:not(:read-write))>label]:normal-case',
  '[&_div:has(>input:not(:read-write))>p]:basis-full [&_div:has(>input:not(:read-write))>p]:pl-7',
  // the button
  '[&_button]:mt-8 [&_button]:min-h-12 [&_button]:cursor-pointer [&_button]:bg-ink [&_button]:px-6 [&_button]:text-xs [&_button]:font-medium [&_button]:tracking-caps [&_button]:text-foam [&_button]:uppercase [&_button:hover]:bg-brass-deep',
  // the thanks, once it is sent
  '[&>div]:font-display [&>div]:text-2xl [&>div]:leading-snug',
].join(' ')
