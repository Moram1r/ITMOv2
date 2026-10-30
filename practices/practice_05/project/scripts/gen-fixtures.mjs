import { ZipWriter } from '@zip.js/zip.js/index-native.js'
import { BlobWriter } from '@zip.js/zip.js/index-native.js'
import { Uint8ArrayReader } from '@zip.js/zip.js/index-native.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { Buffer } from 'node:buffer'

async function buildZip(entries) {
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  for (const e of entries) {
    if (e.directory) {
      await writer.add(e.name, undefined, { directory: true })
    } else {
      await writer.add(e.name, new Uint8ArrayReader(e.data || new Uint8Array()), { level: 0 })
    }
  }
  const blob = await writer.close()
  const ab = await blob.arrayBuffer()
  return Buffer.from(ab)
}

await mkdir(new URL('../test/fixtures/', import.meta.url), { recursive: true })

const valid = await buildZip([
  { name: 'folder/', directory: true },
  { name: 'folder/a.txt', data: new Uint8Array([0x41]) },
  { name: 'b', data: new Uint8Array([0x42]) },
  { name: 'c.md', data: new Uint8Array([0x43, 0x43]) },
])
await writeFile(new URL('../test/fixtures/valid.zip', import.meta.url), valid)

const empty = await buildZip([])
await writeFile(new URL('../test/fixtures/empty.zip', import.meta.url), empty)

await writeFile(new URL('../test/fixtures/broken.bin', import.meta.url), Buffer.from([1,2,3,4]))

console.log('Fixtures generated in project/test/fixtures')
