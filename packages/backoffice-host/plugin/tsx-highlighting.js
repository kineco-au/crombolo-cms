/**
 * Colours JSX in a view's code editor. monaco's TypeScript highlighting has no
 * rules for markup, so `<div className="x">` read as plain text in a TSX file;
 * `withJsx` adds them to its grammar: tags, attributes and their values, and
 * `{…}` inside markup, which is TypeScript again. A `<` right after a name is a
 * type argument, `useState<string>`, never a tag: monaco's grammar matches from
 * where it is and cannot look back, so the name and its `<` are read together. Pure.
 */

/** A name with `<` straight after it: a type argument, as in `useState<string>`. */
export const TYPE_ARGUMENTS = /([A-Za-z_$][\w$]*)(<)/
/** A tag starts at `<` and a name, or `<>` for a fragment. */
export const TAG_START = /(<)([A-Za-z_$][\w$.:-]*)(?=[\s/>])/
const FRAGMENT_START = /(<)(>)/

/**
 * monaco's TypeScript grammar, as its loader gives it, with JSX states added.
 *
 * @param {{ tokenizer: Record<string, unknown[]> } & Record<string, unknown>} language
 */
export function withJsx(language) {
  const root = language.tokenizer.root ?? []
  return {
    ...language,
    tokenizer: {
      ...language.tokenizer,
      root: [
        [
          TYPE_ARGUMENTS,
          [{ cases: { '@keywords': 'keyword', '@default': 'identifier' } }, 'delimiter.bracket'],
        ],
        [TAG_START, ['delimiter.html', { token: 'tag', next: '@jsxTag' }]],
        [FRAGMENT_START, ['delimiter.html', { token: 'delimiter.html', next: '@jsxChildren' }]],
        ...root,
      ],
      // Inside an opening tag: attributes until `>` (children follow) or `/>`.
      jsxTag: [
        [/\s+/, ''],
        [/\/>/, { token: 'delimiter.html', next: '@pop' }],
        [/>/, { token: 'delimiter.html', switchTo: '@jsxChildren' }],
        [/[A-Za-z_$][\w$:-]*/, 'attribute.name'],
        [/=/, 'delimiter'],
        [/"[^"]*"/, 'attribute.value'],
        [/'[^']*'/, 'attribute.value'],
        [/\{/, { token: 'delimiter.bracket', next: '@jsxExpression' }],
      ],
      // Between an opening tag and its closing one: text, nested tags, `{…}`.
      jsxChildren: [
        [
          /(<\/)([A-Za-z_$][\w$.:-]*)?(>)/,
          ['delimiter.html', 'tag', { token: 'delimiter.html', next: '@pop' }],
        ],
        [/(<)([A-Za-z_$][\w$.:-]*)/, ['delimiter.html', { token: 'tag', next: '@jsxTag' }]],
        [/(<)(>)/, ['delimiter.html', { token: 'delimiter.html', next: '@jsxChildren' }]],
        [/\{/, { token: 'delimiter.bracket', next: '@jsxExpression' }],
        [/[^<{]+/, ''],
      ],
      // TypeScript inside `{…}`, which may hold markup of its own.
      jsxExpression: [
        [/\{/, { token: 'delimiter.bracket', next: '@jsxExpression' }],
        [/\}/, { token: 'delimiter.bracket', next: '@pop' }],
        { include: '@root' },
      ],
    },
  }
}

/**
 * Puts JSX into monaco's `typescript` grammar, once. monaco sets the grammar when
 * a language is first used, so it is used first, and ours goes in after it.
 */
export async function highlightJsx(monaco) {
  const typescript = monaco.languages.getLanguages().find((l) => l.id === 'typescript')
  if (!typescript?.loader) return false
  monaco.editor.createModel('', 'typescript').dispose()
  const { language } = await typescript.loader()
  // Let monaco's own registration, queued by the model above, land first.
  await new Promise((resolve) => setTimeout(resolve, 0))
  monaco.languages.setMonarchTokensProvider('typescript', withJsx(language))
  return true
}
