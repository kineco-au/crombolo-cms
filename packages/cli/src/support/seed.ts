/**
 * What the `seed` commands share (story 163): compiling the site's `seed/`
 * against its database, and reporting what stops it, file by file and line by
 * line.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrapDatabase, compileSeed, type SeedBuild, useSchemaStore } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import { many } from './flags.ts'
import { type Io, siteConfig } from './site.ts'

/** The import's answers, which a seed's findings take too. */
export const seedResolveFlags = {
  resolve: many(
    'answer a finding: <key>=take-bundle|keep-local|skip, or <key>/<property>[@<culture>]=take-bundle|keep-local',
    '<answer>',
  ),
  'resolve-all': Flags.string({
    summary: 'answer every finding the same way',
    options: ['take-bundle', 'keep-local', 'skip'],
  }),
}

export const findingFields = [
  {
    name: 'findings',
    type: 'array',
    items: {
      type: 'object',
      fields: [
        { name: 'file', type: 'string' },
        { name: 'line', type: 'integer' },
        { name: 'code', type: 'string' },
        { name: 'message', type: 'string' },
      ],
    },
  },
] as const

/** The seed compiled against this site's database. */
export async function buildSeed(): Promise<SeedBuild> {
  const config = await siteConfig()
  await useSchemaStore(config)
  const { db } = await bootstrapDatabase(config)
  try {
    return await compileSeed(db, config)
  } finally {
    await db.close()
  }
}

export function sayFindings(io: Io, build: SeedBuild): void {
  for (const finding of build.findings)
    io.say(`  ${finding.file}:${finding.line}  ${finding.message}`)
}

/** Refuses a seed that has findings, naming each one. */
export function refuseFindings(build: SeedBuild): void {
  if (build.findings.length === 0) return
  throw new CliError(
    'refused',
    `The seed has ${build.findings.length} problem(s), so nothing was built.`,
    {
      hint: '`crombolo seed check` lists them.',
      details: build.findings.map((f) => `${f.file}:${f.line}  ${f.message}`),
    },
  )
}

/** Writes a built seed's package files into `dir`. */
export function writeSeedPackage(build: SeedBuild, dir: string): void {
  for (const file of build.files ?? []) {
    const target = join(dir, file.path)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, file.bytes ?? (file.text as string))
  }
}

/** A built seed in a directory of its own for the length of `work`. */
export async function withSeedPackage<T>(build: SeedBuild, work: (dir: string) => Promise<T>) {
  const dir = mkdtempSync(join(tmpdir(), 'crombolo-seed-'))
  try {
    writeSeedPackage(build, dir)
    return await work(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
