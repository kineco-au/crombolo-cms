/**
 * `types new` and `types property add`: the model they build.
 *
 * What matters is that the file they produce is one the rest of the system
 * accepts — parsed back to the same type, and valid — because a scaffold that writes something subtly
 * wrong is worse than no scaffold at all.
 */
import { describe, expect, test } from 'bun:test'
import {
  addProperty,
  allProperties,
  nameFor,
  newType,
  parseContentType,
  parseDataType,
  parseMediaType,
  presetDataType,
  validateSchemaSet,
  viewScaffold,
  writeContentType,
  writeDataType,
} from '@crombolo/schema'

/** Deterministic keys, so a test reads as what it is about. */
const keys = () => {
  let n = 0
  return () => {
    n += 1
    return `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
  }
}

describe('scaffolding a type', () => {
  test('writes a content type a site can publish, with a view to match', () => {
    const type = newType({ alias: 'articlePage', allowAtRoot: true, tab: 'Content' }, keys())
    expect(type.name).toBe('Article Page')
    expect(type.allowAtRoot).toBe(true)
    expect(type.components).toEqual(['articlePage'])
    expect(type.defaultComponent).toBe('articlePage')
    // A page with no properties cannot say anything, so it starts with one.
    expect(allProperties(type).map((p) => p.alias)).toEqual(['title'])
    expect(allProperties(type)[0]?.mandatory).toBe(true)

    const view = viewScaffold(type)
    expect(view).toContain("import type { PageProps } from '@crombolo/crombolo'")
    expect(view).toContain('export default function ArticlePage(')
    expect(view).toContain("model.text('title')")
  })

  test('writes an element type, which has no URL and so no template', () => {
    const type = newType({ alias: 'quote', element: true, tab: 'Content' }, keys())
    expect(type.isElement).toBe(true)
    // In the Library's Create dialog only when asked: most are blocks (story 255)
    expect(type.allowInLibrary).toBe(false)
    expect(newType({ alias: 'card', element: true, library: true }, keys()).allowInLibrary).toBe(
      true,
    )
    expect(type.components).toEqual([])
    expect(type.defaultComponent).toBeUndefined()
  })

  test('writes media and member types without the vocabulary they do not have', () => {
    for (const kind of ['media', 'member'] as const) {
      const type = newType({ alias: 'brochure', kind }, keys())
      expect(type.components).toEqual([])
      expect(type.allowAtRoot).toBe(false)
      // Nothing is assumed about what belongs on one.
      expect(allProperties(type)).toEqual([])
    }
  })

  test('the file it writes parses back to the same type, and validates', () => {
    const type = newType({ alias: 'article', allowAtRoot: true, tab: 'Content' }, keys())
    const parsed = parseContentType('schema/content-types/article.toml', writeContentType(type))
    expect(parsed.problems).toEqual([])
    // The parser fills every optional key in, so the shapes differ where the
    // values do not; what matters is that nothing was lost or invented.
    expect(parsed.value).toMatchObject({
      key: type.key,
      alias: 'article',
      name: 'Article',
      allowAtRoot: true,
      isElement: false,
      components: ['article'],
      defaultComponent: 'article',
    })
    expect(allProperties(parsed.value as typeof type).map((p) => p.alias)).toEqual(['title'])

    const problems = validateSchemaSet(
      {
        version: '1.0.0',
        contentTypes: [parsed.value as typeof type],
        dataTypes: [],
        languages: [],
      },
      { componentAliases: new Set(['article']) },
    )
    expect(problems).toEqual([])
  })

  test('a media type file round-trips under its own header', () => {
    const type = newType({ alias: 'brochure', kind: 'media' }, keys())
    const parsed = parseMediaType(
      'schema/media-types/brochure.toml',
      writeContentType(type, 'media'),
    )
    expect(parsed.problems).toEqual([])
    expect(parsed.value?.alias).toBe('brochure')
  })

  test('every key production asks for is already in the file', () => {
    const type = newType({ alias: 'article', tab: 'Content' }, keys())
    expect(type.key).toBeTruthy()
    for (const property of allProperties(type)) expect(property.key, property.alias).toBeTruthy()
  })

  test('turns an alias into the name a person would have typed', () => {
    expect(nameFor('articlePage')).toBe('Article Page')
    expect(nameFor('article-page')).toBe('Article page')
    expect(nameFor('article')).toBe('Article')
  })
})

describe('adding a property', () => {
  const article = () => newType({ alias: 'article', tab: 'Content' }, keys())

  test('appends to the tab that is there, because order in the file is order in the editor', () => {
    const result = addProperty(article(), { alias: 'summary', type: 'textarea' }, keys())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tab).toBe('Content')
    expect(result.type.tabs[0]?.properties.map((p) => p.alias)).toEqual(['title', 'summary'])
    expect(result.property.name).toBe('Summary')
    expect(result.property.key).toBeTruthy()
    expect(result.property.mandatory).toBe(false)
  })

  test('opens a tab that is not there yet, and leaves the others alone', () => {
    const result = addProperty(
      article(),
      { alias: 'hero', type: 'imageMediaPicker', tab: 'Media', mandatory: true },
      keys(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.type.tabs.map((tab) => tab.name)).toEqual(['Content', 'Media'])
    expect(result.type.tabs[0]?.properties.map((p) => p.alias)).toEqual(['title'])
    expect(result.type.tabs[1]?.properties.map((p) => p.alias)).toEqual(['hero'])
    expect(result.property.mandatory).toBe(true)
  })

  test('refuses an alias the type already has, wherever it sits', () => {
    const withHero = addProperty(article(), { alias: 'hero', type: 'textstring', tab: 'Media' })
    expect(withHero.ok).toBe(true)
    if (!withHero.ok) return
    for (const alias of ['title', 'hero']) {
      const again = addProperty(withHero.type, { alias, type: 'textstring' })
      expect(again.ok, alias).toBe(false)
      if (!again.ok) expect(again.reason).toContain(alias)
    }
  })

  test('what it adds survives the writer and the parser', () => {
    const result = addProperty(
      article(),
      { alias: 'summary', type: 'textarea', description: 'Shown in listings', mandatory: true },
      keys(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const parsed = parseContentType('article.toml', writeContentType(result.type))
    expect(parsed.problems).toEqual([])
    const summary = allProperties(parsed.value as never).find((p) => p.alias === 'summary')
    expect(summary).toMatchObject({
      name: 'Summary',
      type: 'textarea',
      description: 'Shown in listings',
      mandatory: true,
    })
  })
})

describe('the options a new type takes (story 161)', () => {
  test('compositions, children, variation, the Library and a list view reach the file', () => {
    const type = newType({
      alias: 'blog',
      allowAtRoot: true,
      tab: 'Content',
      compose: ['seo'],
      allowChildren: ['article'],
      variesByCulture: true,
      library: true,
      listView: 'listViewContent',
    })
    const parsed = parseContentType('blog.toml', writeContentType(type)).value
    expect(parsed).toMatchObject({
      compositions: ['seo'],
      allowChildren: ['article'],
      variesByCulture: true,
      variesBySegment: false,
      allowInLibrary: true,
      collection: 'listViewContent',
    })
    // A page that varies by language has a title that does too.
    expect(allProperties(parsed as never)[0]?.variesByCulture).toBe(true)
  })

  test('an alias that names nothing is a problem on the new file', () => {
    const type = newType({ alias: 'blog', tab: 'Content', compose: ['nothing'] })
    const problems = validateSchemaSet({
      version: '1.0.0',
      contentTypes: [type],
      dataTypes: [],
      languages: [],
    })
    expect(problems.map((p) => `${p.file}: ${p.message}`)).toContain(
      'schema/content-types/blog: unknown type "nothing"',
    )
  })
})

describe('data types by preset (story 161)', () => {
  test("each preset gives its editor, and its flags become config over the editor's defaults", () => {
    const cases: Array<[string, Parameters<typeof presetDataType>[2], Record<string, unknown>]> = [
      ['textstring', { maxChars: 80 }, { maxChars: 80, autocomplete: 'off', inputType: 'text' }],
      ['textarea', { rows: 4 }, { rows: 4 }],
      ['number', { min: 1, max: 9, step: 2 }, { min: 1, max: 9, step: 2 }],
      [
        'toggle',
        { defaultOn: true, label: 'On' },
        { default: true, showLabels: true, labelOn: 'On' },
      ],
      ['date', { withTime: true }, { format: 'YYYY-MM-DD HH:mm:ss' }],
      ['dropdown', { option: ['a', 'b'], multiple: true }, { multiple: true, items: ['a', 'b'] }],
      [
        'content-picker',
        { allow: ['page'] },
        { startNode: { type: 'content' }, filter: ['page'], minNumber: 0, maxNumber: 0 },
      ],
      [
        'content-picker',
        { of: 'media', allow: ['Image'] },
        { startNode: { type: 'media' }, filter: ['Image'], minNumber: 0, maxNumber: 0 },
      ],
      [
        'content-picker',
        { of: 'members' },
        { startNode: { type: 'member' }, minNumber: 0, maxNumber: 0 },
      ],
      [
        'media-picker',
        { allow: ['Image'] },
        { filter: ['Image'], multiple: false, validationLimit: { min: 0, max: 1 } },
      ],
      ['element-picker', { allow: ['quote'] }, { allowedContentTypes: ['quote'] }],
      ['block-grid', { columns: 6 }, { gridColumns: 6 }],
      ['tags', {}, { group: 'default', storageType: 'Json' }],
      ['tags', { group: 'topics' }, { group: 'topics', storageType: 'Json' }],
      ['color-picker', {}, {}],
      [
        'color-picker',
        { color: ['#1B264F=Navy', 'fff'] },
        {
          items: [
            { value: '#1b264f', label: 'Navy' },
            { value: '#fff', label: '#fff' },
          ],
          useLabel: true,
        },
      ],
      ['color-picker', { color: ['#000'] }, { items: [{ value: '#000', label: '#000' }] }],
      ['eye-dropper', {}, {}],
      ['eye-dropper', { alpha: true, palette: true }, { showAlpha: true, showPalette: true }],
      [
        'slider',
        {},
        { minVal: 0, maxVal: 100, minimumRange: 0, initVal1: 0, initVal2: 0, step: 1 },
      ],
      [
        'slider',
        { min: 1, max: 5, step: 0.5, range: true },
        {
          minVal: 1,
          maxVal: 5,
          minimumRange: 0,
          initVal1: 0,
          initVal2: 0,
          step: 0.5,
          enableRange: true,
        },
      ],
      ['multi-url-picker', {}, { minNumber: 0, maxNumber: 0 }],
      ['multi-url-picker', { min: 1, max: 3 }, { minNumber: 1, maxNumber: 3 }],
      ['upload', {}, {}],
      ['upload', { extension: ['.pdf', 'docx'] }, { fileExtensions: ['pdf', 'docx'] }],
      ['image-cropper', {}, {}],
      [
        'image-cropper',
        { crop: ['thumb:200x100'] },
        { crops: [{ label: 'Thumb', alias: 'thumb', width: 200, height: 100 }] },
      ],
      ['markdown', {}, {}],
      ['markdown', { preview: true }, { preview: true }],
      [
        'code',
        {},
        { language: 'javascript', height: 400, lineNumbers: true, minimap: true, wordWrap: false },
      ],
      [
        'code',
        { language: 'css' },
        { language: 'css', height: 400, lineNumbers: true, minimap: true, wordWrap: false },
      ],
      ['email', {}, { inputType: 'email' }],
      ['checkbox-list', {}, {}],
      ['checkbox-list', { option: ['Red', 'Blue'] }, { items: ['Red', 'Blue'] }],
      ['radio-list', { option: ['Yes', 'No'] }, { items: ['Yes', 'No'] }],
      ['member-picker', {}, {}],
      ['document-picker', {}, {}],
      ['document-picker', { allow: ['article'] }, { allowedContentTypes: ['article'] }],
      ['decimal', {}, { step: '0.01' }],
      ['decimal', { min: 0.5, max: 9.5, step: 0.25 }, { min: 0.5, max: 9.5, step: 0.25 }],
      ['label', {}, { umbracoDataValueType: 'STRING' }],
      ['label', { valueType: 'big-integer' }, { umbracoDataValueType: 'BIGINT' }],
      ['multiple-text', {}, { min: 0, max: 0 }],
      ['multiple-text', { min: 1, max: 4 }, { min: 1, max: 4 }],
      ['date-with-zone', {}, { timeFormat: 'HH:mm', timeZones: { mode: 'all', timeZones: [] } }],
      ['date-only', {}, {}],
      ['time-only', {}, { timeFormat: 'HH:mm' }],
      ['date-time', {}, { timeFormat: 'HH:mm' }],
      ['member-group-picker', {}, {}],
      ['user-picker', {}, {}],
      ['entity-data-picker', {}, {}],
    ]
    for (const [preset, options, config] of cases) {
      const built = presetDataType('x', preset, options)
      if (!built.ok) throw new Error(`${preset}: ${built.reason}`)
      expect(built.dataType.config, preset).toEqual(config)
    }
  })

  test('a full name is the preset it has, and --set adds settings over it', () => {
    for (const name of [
      'Umbraco.ColorPicker',
      'Umb.PropertyEditorUi.ColorPicker',
      'color-picker',
    ]) {
      const built = presetDataType('brand', name, { color: ['#000=Black'] }, undefined, {
        extra: 1,
      })
      expect(built.ok && built.dataType, name).toEqual({
        alias: 'brand',
        name: 'Brand',
        editor: 'Umbraco.ColorPicker',
        editorUi: 'Umb.PropertyEditorUi.ColorPicker',
        config: { items: [{ value: '#000', label: 'Black' }], useLabel: true, extra: 1 },
      })
    }
    const code = presetDataType('snippet', 'Umb.PropertyEditorUi.CodeEditor')
    expect(code.ok && [code.dataType.editor, code.dataType.editorUi]).toEqual([
      'Umbraco.Plain.String',
      'Umb.PropertyEditorUi.CodeEditor',
    ])
    const set = presetDataType('snippet', 'Umbraco.Plain.String', {}, undefined, {
      language: 'json',
    })
    expect(set.ok && set.dataType.config.language).toBe('json')
  })

  test('an unknown editor is refused, naming the closest; a fraction where a whole number goes is too', () => {
    const unknown = presetDataType('x', 'Umbraco.ColourPicker')
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) {
      expect(unknown.reason).toContain('unknown editor "Umbraco.ColourPicker"')
      expect(unknown.reason).toContain('Umbraco.ColorPicker')
      expect(unknown.reason).toContain('types editors --all')
    }
    const fraction = presetDataType('x', 'number', { step: 0.5 })
    expect(fraction).toEqual({ ok: false, reason: '--step takes a whole number for number' })
    expect(presetDataType('x', 'multi-url-picker', { max: 1.5 }).ok).toBe(false)
    expect(presetDataType('x', 'decimal', { step: 0.5 }).ok).toBe(true)
    const wrong: Array<[string, Parameters<typeof presetDataType>[2]]> = [
      ['color-picker', { color: ['navy'] }],
      ['image-cropper', { crop: ['thumb'] }],
      ['code', { language: 'cobol' }],
      ['label', { valueType: 'colour' }],
      ['content-picker', { of: 'things' }],
    ]
    for (const [preset, options] of wrong) {
      const refused = presetDataType('x', preset, options)
      expect(refused.ok, preset).toBe(false)
    }
  })

  test('blocks become block tables, and the file reads back', () => {
    const built = presetDataType('pageBlocks', 'block-list', {
      block: ['feature', 'quote'],
      min: 1,
    })
    if (!built.ok) throw new Error(built.reason)
    expect(built.dataType).toMatchObject({
      name: 'Page Blocks',
      editor: 'Umbraco.BlockList',
      config: { validationLimit: { min: 1 } },
      blocks: [{ element: 'feature' }, { element: 'quote' }],
    })
    expect(parseDataType('page-blocks', writeDataType(built.dataType)).value).toEqual(
      built.dataType,
    )
  })

  test('an unknown preset, or a flag it does not take, is refused', () => {
    expect(presetDataType('x', 'colour').ok).toBe(false)
    const wrong = presetDataType('x', 'toggle', { maxChars: 3 })
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.reason).toBe('toggle does not take --max-chars')
  })
})
