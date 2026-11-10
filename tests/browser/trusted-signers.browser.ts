/**
 * Settings → Trusted signers (story 316): an administrator adds a key, sees it
 * listed with its fingerprint, and removes it again.
 */
import { createHash, generateKeyPairSync } from 'node:crypto'
import { expect, signIn, test } from './fixtures.ts'

/** A key's public line and fingerprint, made as `crombolo keys create` makes them. */
function newKey(comment: string) {
  const raw = generateKeyPairSync('ed25519')
    .publicKey.export({ format: 'der', type: 'spki' })
    .subarray(12)
  return {
    line: `crombolo-ed25519 ${raw.toString('base64')} ${comment}`,
    fingerprint: `SHA256:${createHash('sha256').update(raw).digest('base64').replace(/=+$/, '')}`,
  }
}

test('an administrator adds a trusted key, sees its fingerprint, and removes it', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/crombolo/section/settings/dashboard/trusted-signers')
  const screen = page.locator('crombolo-trusted-signers')
  await expect(screen.getByText('(this site)')).toBeVisible({ timeout: 30_000 })

  const key = newKey('browser')
  await screen.getByLabel('Name', { exact: true }).fill('Browser test key')
  await screen.getByLabel('Public key', { exact: true }).fill(key.line)
  await screen.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(screen.getByText('Browser test key')).toBeVisible()
  await expect(screen.getByText(key.fingerprint)).toBeVisible()

  const row = screen.locator('li.signer', { hasText: 'Browser test key' })
  await row.getByRole('button', { name: 'Remove' }).click()
  await page.getByRole('button', { name: 'Remove' }).last().click()
  await expect(screen.getByText('Browser test key')).toBeHidden()
})
