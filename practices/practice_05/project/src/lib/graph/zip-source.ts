import * as zip from '@zip.js/zip.js/index-native.js'
import type { AnalysisResult } from '../zip-analyzer'
import type { GraphLimits, ReadSourceFile } from './types'
import {
  byteCompare,
  graphExtOf,
  hasObjBinSegment,
  normalizePath,
  pathKey,
} from './paths'

zip.configure({ useWebWorkers: false })

export type DuplicatePathGroup = {
  path: string
  count: number
}

export type GraphSourceRead = {
  sources: ReadSourceFile[]
  duplicateGroups: DuplicatePathGroup[]
  fileTooLargePaths: string[]
  readIssuePaths: string[]
  excluded: {
    objBin: number
    otherTypes: number
    total: number
  }
  textBytes: number
}

type Candidate = {
  originalPath: string
  path: string
  ext: 'cs' | 'csproj'
  size: number
}

/**
 * Переоткрывает ZIP и читает только безопасные .cs/.csproj вне obj/ и bin/.
 * Остальные записи учитываются в excluded и не декодируются.
 */
export async function readGraphSources(
  file: File,
  analysis: AnalysisResult,
  limits: GraphLimits
): Promise<GraphSourceRead> {
  let objBin = 0
  let otherTypes = 0
  const candidates: Candidate[] = []

  for (const entry of analysis.files) {
    if (hasObjBinSegment(entry.path)) {
      objBin++
      continue
    }
    const normalized = normalizePath(entry.path)
    const ext = normalized ? graphExtOf(normalized) : null
    if (!normalized || !ext) {
      otherTypes++
      continue
    }
    candidates.push({
      originalPath: entry.path,
      path: normalized,
      ext,
      size: entry.sizeUncompressed,
    })
  }

  const groups = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const key = pathKey(candidate.path)
    const list = groups.get(key)
    if (list) list.push(candidate)
    else groups.set(key, [candidate])
  }

  const orderedGroups = Array.from(groups.values()).sort((a, b) =>
    byteCompare(
      a.map((c) => c.path).sort(byteCompare)[0],
      b.map((c) => c.path).sort(byteCompare)[0]
    )
  )

  const duplicateGroups: DuplicatePathGroup[] = []
  const fileTooLargePaths: string[] = []
  const readIssuePaths: string[] = []
  const sources: ReadSourceFile[] = []
  let textBytes = 0

  const reader = new zip.ZipReader(new zip.BlobReader(file))
  try {
    const entries = (await reader.getEntries()) as any[]
    const byOriginalPath = new Map<string, any>()
    for (const entry of entries) {
      if (entry.directory) continue
      if (!byOriginalPath.has(entry.filename)) {
        byOriginalPath.set(entry.filename, entry)
      }
    }

    for (const group of orderedGroups) {
      const sorted = [...group].sort((a, b) => byteCompare(a.path, b.path))
      if (sorted.length > 1) {
        duplicateGroups.push({ path: sorted[0].path, count: sorted.length })
        sources.push({
          ...sorted[0],
          text: null,
          status: 'unknown',
        })
        continue
      }

      const candidate = sorted[0]
      if (candidate.size > limits.maxFileBytes) {
        fileTooLargePaths.push(candidate.path)
        sources.push({ ...candidate, text: null, status: 'unknown' })
        continue
      }

      const entry = byOriginalPath.get(candidate.originalPath)
      if (!entry) {
        readIssuePaths.push(candidate.path)
        sources.push({ ...candidate, text: null, status: 'unknown' })
        continue
      }

      try {
        const text = (await entry.getData(new zip.TextWriter())) as string
        textBytes += new TextEncoder().encode(text).byteLength
        sources.push({ ...candidate, text, status: 'known' })
      } catch {
        readIssuePaths.push(candidate.path)
        sources.push({ ...candidate, text: null, status: 'unknown' })
      }
    }
  } finally {
    await reader.close()
  }

  duplicateGroups.sort((a, b) => byteCompare(a.path, b.path))
  fileTooLargePaths.sort(byteCompare)
  readIssuePaths.sort(byteCompare)

  return {
    sources,
    duplicateGroups,
    fileTooLargePaths,
    readIssuePaths,
    excluded: {
      objBin,
      otherTypes,
      total: objBin + otherTypes,
    },
    textBytes,
  }
}
