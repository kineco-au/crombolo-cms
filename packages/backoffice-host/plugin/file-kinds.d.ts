/** Types for file-kinds.js, so a site's own tsconfig, without allowJs, checks the server against them. */
export type FileKindEditor =
  | 'markdown'
  | 'text'
  | 'json'
  | 'xml'
  | 'html'
  | 'svg'
  | 'csv'
  | 'upload'

export interface FileKindEntry {
  extension: string
  contentType: string
  editor: FileKindEditor
  text: boolean
  check?: 'json' | 'xml'
}

export interface FileBodyProblem {
  message: string
  line?: number
  column?: number
}

export const FILE_KINDS: readonly FileKindEntry[]
export const FILE_EXTENSIONS: readonly string[]
export const FILE_UPLOAD_MAX_BYTES: number
export function extensionOf(name: string): string
export function kindOf(name: string): FileKindEntry | undefined
export function editorFor(name: string): FileKindEditor | 'folder' | 'unknown'
export function isUpload(value: unknown): boolean
export function nameProblem(
  name: string,
  parentName?: string | null,
  options?: { folder?: boolean },
): string | undefined
export function bodyProblem(
  name: string,
  value: unknown,
  upload?: { name: string; size: number },
): FileBodyProblem | undefined
export function wellFormedJson(text: string): FileBodyProblem | undefined
export function wellFormedXml(text: string): FileBodyProblem | undefined
export const DEFAULT_EXTENSION: string
export function nameSuffixes(): {
  options: Array<{ value: string; label: string }>
  initial: string
}
export function editingName(name: string): string
export function nameAfterUpload(name: string, uploaded: string): string
export function replaceNote(name: string, value: unknown): string | undefined
export function sizeText(bytes: number): string
