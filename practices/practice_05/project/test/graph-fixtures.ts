import {
  BlobWriter,
  Uint8ArrayReader,
  ZipWriter,
} from '@zip.js/zip.js/index-native.js'

// Полифилл File для Node/Vitest, как в analyzer.test.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G: any = globalThis as any
if (!G.File) {
  G.File = class File extends Blob {
    name: string
    lastModified: number
    constructor(parts: BlobPart[], name: string, options?: FilePropertyBag) {
      super(parts, options)
      this.name = name
      this.lastModified = options?.lastModified || Date.now()
    }
  }
}

export type FixtureEntry = {
  name: string
  data?: string | Uint8Array
  directory?: boolean
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

export async function buildZip(entries: FixtureEntry[]): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  for (const entry of entries) {
    if (entry.directory) {
      await writer.add(entry.name, undefined as unknown as Uint8ArrayReader, {
        directory: true,
      })
      continue
    }
    const data =
      typeof entry.data === 'string'
        ? utf8(entry.data)
        : entry.data ?? new Uint8Array([])
    await writer.add(entry.name, new Uint8ArrayReader(data), { level: 0 })
  }
  return await writer.close()
}

export async function buildZipFile(
  name: string,
  entries: FixtureEntry[]
): Promise<File> {
  const blob = await buildZip(entries)
  return new File([blob], name, { type: 'application/zip' })
}

/** Удобная фикстура: путь → текст файла. */
export function textEntries(files: Record<string, string>): FixtureEntry[] {
  return Object.entries(files).map(([name, data]) => ({ name, data }))
}
