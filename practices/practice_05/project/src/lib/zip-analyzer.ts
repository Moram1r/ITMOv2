import { LIMITS, type Limits } from './limits'
// Use native JS build to avoid WASM in tests and simplify bundling
import * as zip from '@zip.js/zip.js/index-native.js'

// Ensure compatibility in Node/Vitest and browsers: disable web workers
zip.configure({ useWebWorkers: false })

export type ZipEntryInfo = {
  path: string
  ext: string | null
  sizeUncompressed: number
}

export type AnalysisResult = {
  archiveName: string
  fileCount: number
  totalUncompressedBytes: number
  files: ZipEntryInfo[]
}

export class ZipAnalysisError extends Error {
  code:
    | 'EMPTY_FILE'
    | 'NOT_ZIP'
    | 'DAMAGED'
    | 'NO_FILES'
    | 'LIMIT_ENTRIES'
    | 'LIMIT_ZIP_SIZE'
    | 'LIMIT_UNCOMPRESSED'
  constructor(code: ZipAnalysisError['code'], message: string) {
    super(message)
    this.code = code
  }
}

function extOf(path: string): string | null {
  const base = path.split('/').pop() || ''
  if (!base.includes('.')) return null
  const idx = base.lastIndexOf('.')
  if (idx <= 0 || idx === base.length - 1) return null
  return base.slice(idx + 1)
}

export async function analyzeZipFile(file: File, limits?: Partial<Limits>): Promise<AnalysisResult> {
  const L = { ...LIMITS, ...(limits || {}) }
  if (file.size === 0) {
    throw new ZipAnalysisError('EMPTY_FILE', 'Файл пустой, это не архив ZIP.')
  }
  if (file.size > L.maxZipBytes) {
    throw new ZipAnalysisError(
      'LIMIT_ZIP_SIZE',
      `Размер ZIP превышает лимит ${formatBytes(L.maxZipBytes)}.`
    )
  }

  // Use zip.js to read central directory without extracting data
  let entries: any[]
  try {
    const zr = new zip.ZipReader(new zip.BlobReader(file))
    entries = await zr.getEntries()
    await zr.close()
  } catch (e) {
    // zip.js throws on unsupported or damaged archives
    throw new ZipAnalysisError('NOT_ZIP', 'Файл не является поддерживаемым ZIP-архивом или он повреждён.')
  }

  if (!entries || entries.length === 0) {
    // Could be an empty archive or damaged central directory
    throw new ZipAnalysisError('NO_FILES', 'Архив не содержит записей.')
  }

  if (entries.length > L.maxEntries) {
    throw new ZipAnalysisError('LIMIT_ENTRIES', `Число записей превышает лимит ${L.maxEntries}.`)
  }

  // Filter out directories
  const files = entries
    .filter((e: any) => !e.directory)
    .map((e: any) => ({
      path: e.filename as string,
      ext: extOf(e.filename as string),
      sizeUncompressed: Number(e.uncompressedSize ?? 0),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))

  const total = files.reduce((sum, f) => sum + f.sizeUncompressed, 0)
  if (total > L.maxUncompressedBytes) {
    throw new ZipAnalysisError(
      'LIMIT_UNCOMPRESSED',
      `Суммарный несжатый размер превышает лимит ${formatBytes(L.maxUncompressedBytes)}.`
    )
  }

  return {
    archiveName: file.name,
    fileCount: files.length,
    totalUncompressedBytes: total,
    files,
  }
}

export function formatBytes(bytes: number): string {
  const units = ['Б', 'КиБ', 'МиБ', 'ГиБ']
  let v = bytes
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v = v / 1024
    u++
  }
  const s = v % 1 === 0 ? v.toString() : v.toFixed(1)
  return `${s} ${units[u]}`
}
