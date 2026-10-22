import { describe, it, expect } from 'vitest'
import { analyzeZipFile, ZipAnalysisError } from '../src/lib/zip-analyzer'

import {
  ZipWriter,
  BlobWriter,
  Uint8ArrayReader,
} from '@zip.js/zip.js/index-native.js'

// Polyfill File if missing (Node environments)
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

async function buildZip(entries: Array<{ name: string; data?: Uint8Array; directory?: boolean }>): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  for (const e of entries) {
    if (e.directory) {
      await writer.add(e.name, undefined as unknown as Uint8ArrayReader, { directory: true })
    } else {
      const data = e.data ?? new Uint8Array([])
      await writer.add(e.name, new Uint8ArrayReader(data), { level: 0 })
    }
  }
  return await writer.close()
}

describe('analyzeZipFile', () => {
  it('handles nested files, counts and sizes, ignores folders', async () => {
    const zipBlob = await buildZip([
      { name: 'folder/', directory: true },
      { name: 'folder/a.txt', data: new Uint8Array([0x41]) }, // 1 B
      { name: 'b', data: new Uint8Array([0x42]) }, // 1 B, no ext
      { name: 'c.md', data: new Uint8Array([0x43, 0x43]) }, // 2 B
    ])
    const file = new File([zipBlob], 'sample.zip', { type: 'application/zip' })
    const res = await analyzeZipFile(file)
    expect(res.archiveName).toBe('sample.zip')
    expect(res.fileCount).toBe(3)
    expect(res.totalUncompressedBytes).toBe(1 + 1 + 2)
    // sorted by path
    expect(res.files.map(f => f.path)).toEqual(['b', 'c.md', 'folder/a.txt'])
    const b = res.files.find(f => f.path === 'b')!
    expect(b.ext).toBeNull()
    const a = res.files.find(f => f.path === 'folder/a.txt')!
    expect(a.ext).toBe('txt')
  })

  it('empty archive (no entries) yields NO_FILES', async () => {
    const zipBlob = await buildZip([])
    const file = new File([zipBlob], 'empty.zip', { type: 'application/zip' })
    await expect(analyzeZipFile(file)).rejects.toMatchObject({ code: 'NO_FILES' })
  })

  it('broken data is reported as NOT_ZIP', async () => {
    const broken = new Blob([new Uint8Array([1,2,3,4])], { type: 'application/octet-stream' })
    const file = new File([broken], 'broken.zip')
    await expect(analyzeZipFile(file)).rejects.toMatchObject({ code: 'NOT_ZIP' })
  })

  it('respects entry count limit', async () => {
    const zipBlob = await buildZip([
      { name: 'a', data: new Uint8Array([1]) },
      { name: 'b', data: new Uint8Array([1]) },
      { name: 'c', data: new Uint8Array([1]) },
    ])
    const file = new File([zipBlob], 'many.zip', { type: 'application/zip' })
    await expect(analyzeZipFile(file, { maxEntries: 2 })).rejects.toMatchObject({ code: 'LIMIT_ENTRIES' })
  })

  it('respects total uncompressed size limit', async () => {
    const zipBlob = await buildZip([
      { name: 'a.txt', data: new Uint8Array([1,2]) },
    ])
    const file = new File([zipBlob], 'size.zip', { type: 'application/zip' })
    await expect(analyzeZipFile(file, { maxUncompressedBytes: 1 })).rejects.toMatchObject({ code: 'LIMIT_UNCOMPRESSED' })
  })

  it('respects zip file size limit', async () => {
    const zipBlob = await buildZip([{ name: 'a', data: new Uint8Array([1]) }])
    const file = new File([zipBlob], 'size.zip', { type: 'application/zip' })
    await expect(analyzeZipFile(file, { maxZipBytes: 1 })).rejects.toMatchObject({ code: 'LIMIT_ZIP_SIZE' })
  })
})
