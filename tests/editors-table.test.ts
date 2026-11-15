/**
 * Story 357: the editor table matches the vendored back office, and every editor
 * it offers is a preset that writes only settings its data type editor has, with
 * every value that editor fills in for a new data type. This stands in for
 * opening each in the data type editor.
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  DATA_TYPE_PRESETS,
  EDITOR_SCHEMAS,
  EDITOR_UIS,
  editorDefaults,
  editorSettings,
  presetDataType,
  presetOf,
} from '@crombolo/schema'
import { ROOT } from '../scripts/packages.ts'

describe('the editor table', () => {
  test('matches the vendored manifests', () => {
    const run = Bun.spawnSync(['bun', join(ROOT, 'scripts/editors-table.ts'), '--check'], {
      cwd: ROOT,
    })
    expect(run.exitCode, run.stderr.toString()).toBe(0)
  }, 60_000)

  test('every editor the back office offers is a preset, none named for Umbraco', () => {
    const missing = Object.entries(EDITOR_UIS)
      .filter(([ui, entry]) => presetOf(entry.schema, ui)?.[1].editorUi !== ui)
      .map(([ui]) => ui)
    expect(missing).toEqual([])
    const prefixed = Object.keys(DATA_TYPE_PRESETS).filter((name) => /^umb/i.test(name))
    expect(prefixed).toEqual([])
  })

  test("each preset's editor and UI are the back office's, and it writes only their settings, with every default", () => {
    for (const [name, preset] of Object.entries(DATA_TYPE_PRESETS)) {
      expect(EDITOR_UIS[preset.editorUi]?.schema, name).toBe(preset.editor)
      if (preset.editor !== 'Umbraco.Plain.String')
        expect(EDITOR_SCHEMAS[preset.editor], name).toBeDefined()
      const built = presetDataType('x', name)
      if (!built.ok) throw new Error(`${name}: ${built.reason}`)
      const shown = editorSettings(preset.editor, preset.editorUi)
      expect(
        Object.keys(built.dataType.config).filter((setting) => !shown.has(setting)),
        name,
      ).toEqual([])
      expect(
        Object.keys(editorDefaults(preset.editor, preset.editorUi)).filter(
          (setting) => !(setting in built.dataType.config),
        ),
        name,
      ).toEqual([])
    }
  })
})
