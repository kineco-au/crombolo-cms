/**
 * Migration 102 — service accounts' secrets (story 433): when each client id was last used,
 * and the secret it is moving from with when that stops, so a secret is replaced with no gap.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { schemaOps } from '../schema-ops.ts'
import { STATE_KEYS_PER_WORKSPACE } from './keys-per-workspace.ts'

export const STATE_SERVICE_ACCOUNT_SECRETS = '{3c9e1b74-0102-4f6a-8d25-7b0e4a1c0102}'

export const serviceAccountSecretsMigration: Migration = {
  from: STATE_KEYS_PER_WORKSPACE,
  to: STATE_SERVICE_ACCOUNT_SECRETS,
  name: 'AddServiceAccountSecrets',
  kind: 'expand',
  release: '0.81.0',
  async up(db: Db) {
    const ops = schemaOps(db)
    const t = db.dialect.types
    await ops.addColumn('user_client_credential', 'last_used_at', t.timestamp)
    await ops.addColumn('user_client_credential', 'old_secret_hash', t.varchar(255))
    await ops.addColumn('user_client_credential', 'old_secret_until', t.timestamp)
  },
}
