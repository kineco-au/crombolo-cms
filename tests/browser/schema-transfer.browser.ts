/**
 * Story 342: Settings → Schema, in place of Umbraco's Models Builder. The
 * schema downloads as TOML; an uploaded file waits on the Changes dashboard
 * and applies only from there.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, settle, signIn, test } from './fixtures.ts'

/** The throwaway site this run's server was given. */
function siteDir(): string {
  const tmp = join(process.cwd(), 'output')
  const newest = readdirSync(tmp)
    .filter((entry) => entry.startsWith('browser-site-'))
    .map((entry) => ({ entry, at: statSync(join(tmp, entry)).mtimeMs }))
    .sort((a, b) => b.at - a.at)[0]?.entry
  if (!newest) throw new Error('no browser site directory')
  return join(tmp, newest)
}

const NOTE_TYPE = `[content-type]
alias = "browserSchemaNote"
name = "Browser schema note"
allow-at-root = true
`

test('the Schema card exports, and an upload waits for approval on Changes', async ({ page }) => {
  const target = join(siteDir(), 'schema', 'content-types', 'browser-schema-note.toml')
  await signIn(page)
  await page.goto('/crombolo/section/settings')
  const card = page.locator('crombolo-settings-card[heading="Schema"]')
  await expect(card).toContainText('Import or export the model data types', { timeout: 30_000 })
  await card.click()
  await settle(page)

  const screen = page.locator('crombolo-schema-transfer')
  await expect(screen.getByRole('button', { name: 'Download the schema' })).toBeVisible()
  // Umbraco's own screen is gone, and nothing on this one talks code.
  await expect(page.locator('umb-models-builder-dashboard')).toHaveCount(0)
  await expect(screen).not.toContainText(/TypeScript|C#|Models ?Builder/)

  const download = page.waitForEvent('download')
  await screen.getByRole('button', { name: 'Download the schema' }).click()
  expect((await download).suggestedFilename()).toBe('schema.zip')

  await screen.locator('input[type=file]').setInputFiles({
    name: 'browser-schema-note.toml',
    mimeType: 'application/toml',
    buffer: Buffer.from(NOTE_TYPE),
  })
  await expect(screen.getByRole('status')).toContainText('waiting for approval')
  expect(existsSync(target)).toBe(false)

  await screen.getByRole('link', { name: 'Review it on the Changes dashboard' }).click()
  await settle(page)
  const changes = page.locator('crombolo-changes-dashboard')
  await expect(changes).toContainText('Schema import')
  await expect(changes).toContainText('browser-schema-note')
  await changes.getByRole('button', { name: 'Apply' }).click()
  await expect(changes).toContainText('The schema import was applied.')
  expect(existsSync(target)).toBe(true)
})
