/**
 * The File content type (story 450): an item in the content tree served at its
 * name exactly, extension included, with a body of text or an upload. The
 * kinds of File a site serves, each with its content type, and the shape a
 * File's body is stored in. docs/rendering.md, "Files in the content tree".
 */

export const FILE_CONTENT_TYPE_KEY = '8d9df7ad-2312-4fb9-9f44-7fb37e3690a8'
export const FILE_CONTENT_TYPE_ALIAS = 'fileItem'
/** The File's one field. */
export const FILE_BODY_ALIAS = 'body'
export const FILE_BODY_PROPERTY_KEY = 'e622f909-40c4-4500-8ef5-2f5faf0b14ab'
export const FILE_BODY_DATA_TYPE_KEY = 'a6549c2b-7638-44be-9431-83d8264b4063'
export const FILE_BODY_EDITOR_ALIAS = 'Crombolo.FileBody'
export const FILE_BODY_EDITOR_UI_ALIAS = 'Crombolo.PropertyEditorUi.FileBody'
/** Where an upload is kept in the site's file store: never under the media root's folders. */
export const FILE_OBJECT_PREFIX = 'files/'
/** The largest upload a File takes. */
export const FILE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024

/** The Folder content type: a folder of Files, whose name is a segment of their addresses. */
export const FILE_FOLDER_CONTENT_TYPE_KEY = 'c4f1a9e2-6b3d-4e58-9a07-3d2f8b6c1e94'
export const FILE_FOLDER_CONTENT_TYPE_ALIAS = 'fileFolder'

export const isFileType = (key: string | null | undefined): boolean =>
  typeof key === 'string' && key.toLowerCase() === FILE_CONTENT_TYPE_KEY

export const isFileFolderType = (key: string | null | undefined): boolean =>
  typeof key === 'string' && key.toLowerCase() === FILE_FOLDER_CONTENT_TYPE_KEY

/** A File or a Folder: an item whose name is its address segment exactly. */
export const isFileTreeType = (key: string | null | undefined): boolean =>
  isFileType(key) || isFileFolderType(key)

/** A File or a Folder, by its type's alias. */
export const isFileTreeAlias = (alias: string | null | undefined): boolean =>
  alias === FILE_CONTENT_TYPE_ALIAS || alias === FILE_FOLDER_CONTENT_TYPE_ALIAS

/** Which editor a File's body opens in. */
export type FileEditor = 'markdown' | 'text' | 'json' | 'xml' | 'html' | 'svg' | 'csv' | 'upload'

export interface FileKind {
  /** Lowercase, with its dot. */
  extension: string
  contentType: string
  /** Whether its body may be text edited in place; every kind takes an upload. */
  text: boolean
  /** Served with `Content-Security-Policy: sandbox`, so nothing in it runs. */
  sandboxed: boolean
  editor: FileEditor
  /** Checked well-formed on save. */
  check?: 'json' | 'xml'
  /** The tree icon. */
  icon: string
}

const kind = (
  extension: string,
  contentType: string,
  editor: FileEditor,
  more: Partial<Pick<FileKind, 'sandboxed' | 'check' | 'icon'>> = {},
): FileKind => ({
  extension,
  contentType,
  text: editor !== 'upload',
  sandboxed: more.sandboxed ?? false,
  editor,
  ...(more.check ? { check: more.check } : {}),
  icon: more.icon ?? (editor === 'upload' ? 'icon-picture' : 'icon-document'),
})

/** Every kind of File, in the order the refusal lists them. */
export const FILE_KINDS: readonly FileKind[] = [
  kind('.txt', 'text/plain; charset=utf-8', 'text'),
  kind('.md', 'text/markdown; charset=utf-8', 'markdown'),
  kind('.json', 'application/json', 'json', { check: 'json', icon: 'icon-code' }),
  kind('.xml', 'application/xml', 'xml', { check: 'xml', sandboxed: true, icon: 'icon-code' }),
  kind('.csv', 'text/csv; charset=utf-8', 'csv', { icon: 'icon-grid' }),
  kind('.webmanifest', 'application/manifest+json', 'json', { check: 'json', icon: 'icon-code' }),
  kind('.html', 'text/html; charset=utf-8', 'html', { sandboxed: true, icon: 'icon-code' }),
  kind('.svg', 'image/svg+xml', 'svg', { check: 'xml', sandboxed: true, icon: 'icon-picture' }),
  kind('.pdf', 'application/pdf', 'upload', { icon: 'icon-document' }),
  kind('.png', 'image/png', 'upload'),
  kind('.jpg', 'image/jpeg', 'upload'),
  kind('.jpeg', 'image/jpeg', 'upload'),
  kind('.gif', 'image/gif', 'upload'),
  kind('.webp', 'image/webp', 'upload'),
  kind('.ico', 'image/x-icon', 'upload'),
]

/** A Folder's tree icon, and an extensionless File's, which is a folder too. */
export const FILE_FOLDER_ICON = 'icon-folder'

/** `agents.md` is `.md`; a name with none, or only a leading dot, has none. Pure. */
export function fileExtensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

/** The kind a File's name makes it, or undefined for a folder or an extension off the list. Pure. */
export function fileKindOf(name: string): FileKind | undefined {
  const extension = fileExtensionOf(name)
  return extension ? FILE_KINDS.find((k) => k.extension === extension) : undefined
}

/** A File's body when it is an upload, as it is stored. */
export interface FileUpload {
  /** Its key in the site's file store: `files/<item key>/<version>/<name>`. */
  src: string
  name: string
  size: number
  contentType: string
}

/** The upload a stored body names, or undefined for text or nothing. Pure. */
export function fileUploadOf(value: unknown): FileUpload | undefined {
  let parsed = value
  if (typeof value === 'string' && value.startsWith('{')) {
    try {
      parsed = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  const upload = parsed as Partial<FileUpload> | null
  if (!upload || typeof upload !== 'object' || typeof upload.src !== 'string') return undefined
  if (!upload.src.startsWith(FILE_OBJECT_PREFIX)) return undefined
  return {
    src: upload.src,
    name: typeof upload.name === 'string' ? upload.name : upload.src.split('/').pop() || '',
    size: typeof upload.size === 'number' ? upload.size : 0,
    contentType:
      typeof upload.contentType === 'string' ? upload.contentType : 'application/octet-stream',
  }
}

/** A File's body as text, or undefined when it is an upload or not text. Pure. */
export function fileTextOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return fileUploadOf(value) ? undefined : value
}

/** The store key of a File's upload: `files/<item key>/<version>/<name>`. Pure. */
export function fileObjectKey(itemKey: string, version: number | string, name: string): string {
  return `${FILE_OBJECT_PREFIX}${itemKey.toLowerCase()}/${version}/${name}`
}

/** Whether a store key is a File's upload, which nothing but its File serves. Pure. */
export const isFileObjectKey = (key: string): boolean =>
  key.replace(/^\/+/, '').toLowerCase().startsWith(FILE_OBJECT_PREFIX)

/** A File's path segment in an address: its name, escaped only where a URL must be. Pure. */
export function fileSegment(name: string): string {
  return encodeURIComponent(name).replace(/%40/g, '@').replace(/%2C/g, ',').replace(/%3A/g, ':')
}

/** A File's icon in the tree: its kind's, or a folder's for a name with no extension. Pure. */
export function fileIconFor(name: string): string {
  if (!fileExtensionOf(name)) return FILE_FOLDER_ICON
  return fileKindOf(name)?.icon ?? 'icon-document'
}
