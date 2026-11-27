/**
 * The save-time step for uploaded files: a value naming a temporary upload has
 * the file placed under the media root and stores its path instead. When the
 * file is `umbracoFile`, the width, height, size and extension properties are
 * filled in, as Umbraco's `AutoFillImageProperties` does for media types.
 */
import {
  type DocumentValue,
  FILE_BODY_EDITOR_ALIAS,
  FILE_UPLOAD_MAX_BYTES,
  FILE_VALUE_EDITORS,
  type FileUpload,
  fileObjectKey,
  IMAGE_CROPPER_EDITOR_ALIAS,
  toStoredUpload,
} from '@crombolo/core'
import type { ValueIntake } from '@crombolo/data'
import type { MediaFileStore, PlacedFile } from './media-files.ts'

const AUTO_FILL = {
  file: 'umbracoFile',
  width: 'umbracoWidth',
  height: 'umbracoHeight',
  bytes: 'umbracoBytes',
  extension: 'umbracoExtension',
} as const

export class TemporaryFileMissingError extends Error {}

/** A File's upload over the limit (story 450): the sender's to fix. */
export class FileUploadTooLargeError extends TemporaryFileMissingError {}

const temporaryIdOf = (value: unknown): string | undefined => {
  const id = (value as { temporaryFileId?: unknown } | null)?.temporaryFileId
  return typeof id === 'string' && id ? id : undefined
}

export function createFileIntake(store: MediaFileStore): ValueIntake {
  return async (values, propertyTypes, item) => {
    const editorOf = new Map(propertyTypes.map((p) => [p.alias, p.editorAlias]))
    const result: DocumentValue[] = [...values]
    const fills: DocumentValue[] = []

    for (const [index, value] of result.entries()) {
      const editor = editorOf.get(value.alias)
      // Story 450: a File's upload is kept apart from media, by item and version.
      if (editor === FILE_BODY_EDITOR_ALIAS) {
        const temporaryId = temporaryIdOf(value.value)
        if (!temporaryId) continue
        const temporary = await store.temporary(temporaryId)
        if (!temporary || !item)
          throw new TemporaryFileMissingError(
            'The upload has expired or does not exist; upload it again.',
          )
        if (temporary.size > FILE_UPLOAD_MAX_BYTES)
          throw new FileUploadTooLargeError(
            `The upload is ${megabytes(temporary.size)}; a File takes at most ${megabytes(FILE_UPLOAD_MAX_BYTES)}.`,
          )
        const key = fileObjectKey(item.key, item.version, temporary.fileName)
        const placed = await store.placeAt(temporaryId, key)
        if (!placed)
          throw new TemporaryFileMissingError(
            'The upload has expired or does not exist; upload it again.',
          )
        const stored: FileUpload = {
          src: key,
          name: temporary.fileName,
          size: placed.bytes,
          contentType: placed.contentType,
        }
        result[index] = { ...value, value: stored }
        continue
      }
      if (!editor || !FILE_VALUE_EDITORS.has(editor)) continue
      const temporaryId = temporaryIdOf(value.value)
      let placed: PlacedFile | undefined
      if (temporaryId) {
        placed = await store.place(temporaryId)
        if (!placed)
          throw new TemporaryFileMissingError(
            `The upload for '${value.alias}' has expired or does not exist; upload it again.`,
          )
      }
      let stored: unknown
      if (editor === IMAGE_CROPPER_EDITOR_ALIAS) {
        const incoming = (value.value ?? {}) as Record<string, unknown>
        const src = placed?.src ?? (typeof incoming.src === 'string' ? incoming.src : '')
        stored = src
          ? {
              src,
              crops: Array.isArray(incoming.crops) ? incoming.crops : [],
              focalPoint: incoming.focalPoint ?? null,
            }
          : null
      } else {
        stored = placed?.src ?? toStoredUpload(value.value)
      }
      result[index] = { ...value, value: stored }

      if (placed && value.alias === AUTO_FILL.file) {
        const fill = (alias: string, fact: unknown) => {
          if (editorOf.has(alias) && fact !== undefined)
            fills.push({ alias, culture: value.culture, segment: value.segment, value: fact })
        }
        fill(AUTO_FILL.width, placed.width)
        fill(AUTO_FILL.height, placed.height)
        fill(AUTO_FILL.bytes, placed.bytes)
        fill(AUTO_FILL.extension, placed.extension)
      }
    }

    // A filled-in fact replaces whatever the editor sent for it.
    const filled = new Set(fills.map((f) => `${f.alias}|${f.culture ?? ''}|${f.segment ?? ''}`))
    return [
      ...result.filter((v) => !filled.has(`${v.alias}|${v.culture ?? ''}|${v.segment ?? ''}`)),
      ...fills,
    ]
  }
}

const megabytes = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`
