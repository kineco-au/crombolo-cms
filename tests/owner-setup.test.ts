/**
 * Story 321: the role, schema and statements a host makes for a custom-table
 * owner before a site boots, the same as the CMS's own.
 */
import { describe, expect, test } from 'bun:test'
import { BUNDLE_ID } from '@crombolo/backoffice-host'
import { ownerSetup as hostOwnerSetup } from '@crombolo/crombolo/host'
import { EXTENSION_ID, ownerSetup, roleComment, roleName } from '@crombolo/data'

const input = { siteName: 'Harbour Stone', database: 'harbour', grantee: 'harbour_app' }

describe('ownerSetup', () => {
  test("the site's role, schema, comment and statements", () => {
    const setup = ownerSetup({ ...input, owner: 'site' })
    const role = roleName('Harbour Stone', 'site', 'harbour')
    expect(setup).toEqual({
      role,
      schema: 'site',
      comment: roleComment('harbour'),
      statements: [
        `CREATE ROLE "${role}" NOLOGIN;`,
        `COMMENT ON ROLE "${role}" IS 'crombolo custom tables for harbour';`,
        `GRANT "${role}" TO "harbour_app";`,
        `CREATE SCHEMA IF NOT EXISTS "site" AUTHORIZATION "${role}";`,
      ],
    })
  })

  test("an extension's, under its own schema and role", () => {
    const setup = ownerSetup({ ...input, owner: 'acme-tasks' })
    expect(setup.role).toBe(roleName('Harbour Stone', 'acme-tasks', 'harbour'))
    expect(setup.role).toContain('acme_tasks')
    expect(setup.schema).toBe('bundle_acme_tasks')
  })

  test('quotes what it names', () => {
    const setup = ownerSetup({ ...input, owner: 'site', database: "o'neil", grantee: 'app"user' })
    expect(setup.statements[1]).toEndWith(`IS 'crombolo custom tables for o''neil';`)
    expect(setup.statements[2]).toEndWith(` TO "app""user";`)
  })

  test('refuses an owner that is neither the site nor an extension id', () => {
    expect(() => ownerSetup({ ...input, owner: 'Not An Id' })).toThrow(/neither "site"/)
  })

  test('reads an extension id as crombolo.id is read, and is the host API', () => {
    expect(EXTENSION_ID.source).toBe(BUNDLE_ID.source)
    expect(hostOwnerSetup).toBe(ownerSetup)
  })
})
