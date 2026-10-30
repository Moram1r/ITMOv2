const DRIVE_RE = /^[A-Za-z]:/

/** Побайтовое сравнение без зависимости от локали. */
export function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Ключ сравнения путей без учёта регистра. */
export function pathKey(path: string): string {
  return path.toLowerCase()
}

export function sortUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort(byteCompare)
}

/**
 * Нормализует путь внутри архива. Возвращает null для пустого, абсолютного
 * пути, пути с диском или выхода за корень.
 */
export function normalizePath(raw: string): string | null {
  if (!raw) return null
  const replaced = raw.replace(/\\/g, '/')
  if (replaced.startsWith('/')) return null
  if (DRIVE_RE.test(replaced)) return null
  if (replaced.includes('\0')) return null

  const out: string[] = []
  for (const segment of replaced.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(segment)
  }
  if (out.length === 0) return null
  return out.join('/')
}

export function extOf(path: string): string | null {
  const base = path.split('/').pop() || ''
  const idx = base.lastIndexOf('.')
  if (idx <= 0 || idx === base.length - 1) return null
  return base.slice(idx + 1).toLowerCase()
}

export function graphExtOf(path: string): 'cs' | 'csproj' | null {
  const ext = extOf(path)
  return ext === 'cs' || ext === 'csproj' ? ext : null
}

/** Есть ли в пути сегмент obj или bin на любом уровне. */
export function hasObjBinSegment(raw: string): boolean {
  return raw
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => {
      const lower = segment.toLowerCase()
      return lower === 'obj' || lower === 'bin'
    })
}

export function directoryOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx < 0 ? '' : path.slice(0, idx)
}

export function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export type NearestProject = {
  projectPath: string | null
  directory: string | null
  candidates: string[]
}

/**
 * Ищет ближайший .csproj вверх по каталогам. Если в каталоге несколько
 * проектов, выбирает первый по побайтовому порядку и возвращает всех кандидатов.
 */
export function findNearestProject(
  sourcePath: string,
  projectPaths: Iterable<string>
): NearestProject {
  const byDirectory = new Map<string, string[]>()
  for (const projectPath of projectPaths) {
    const key = pathKey(directoryOf(projectPath))
    const list = byDirectory.get(key)
    if (list) list.push(projectPath)
    else byDirectory.set(key, [projectPath])
  }
  for (const list of byDirectory.values()) list.sort(byteCompare)

  let directory = directoryOf(sourcePath)
  for (;;) {
    const candidates = byDirectory.get(pathKey(directory))
    if (candidates && candidates.length > 0) {
      return { projectPath: candidates[0], directory, candidates }
    }
    if (directory === '') break
    directory = directoryOf(directory)
  }
  return { projectPath: null, directory: null, candidates: [] }
}

/**
 * Разрешает Include из ProjectReference относительно каталога проекта.
 * null означает небезопасный путь, диск, выход за корень или MSBuild-свойство.
 */
export function resolveProjectReference(
  projectPath: string,
  include: string
): string | null {
  const trimmed = include.trim()
  if (!trimmed || trimmed.includes('$(')) return null
  const replaced = trimmed.replace(/\\/g, '/')
  if (replaced.startsWith('/') || DRIVE_RE.test(replaced)) return null
  const directory = directoryOf(projectPath)
  return normalizePath(directory ? `${directory}/${replaced}` : replaced)
}

/** Представление неразрешённой цели ProjectReference для диагностики. */
export function referenceTarget(include: string): string {
  return include.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
}

export type PathEntry = { path: string }

/**
 * Строит карту «нормализованный путь без учёта регистра» → исходная строка.
 * null означает, что подходящих записей несколько или нет.
 */
export function buildTablePathMap(
  files: Iterable<PathEntry>
): Map<string, string | null> {
  const groups = new Map<string, string[]>()
  for (const file of files) {
    const normalized = normalizePath(file.path)
    if (!normalized) continue
    const key = pathKey(normalized)
    const list = groups.get(key)
    if (list) list.push(file.path)
    else groups.set(key, [file.path])
  }
  const result = new Map<string, string | null>()
  for (const [key, paths] of groups) {
    result.set(key, paths.length === 1 ? paths[0] : null)
  }
  return result
}
