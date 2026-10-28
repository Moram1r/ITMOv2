import { baseNameOf } from './paths'
import type {
  PackageRef,
  ParsedProjectFile,
  ProjectRef,
} from './types'

const TAG_RE =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
const ATTR_RE = /([A-Za-z_][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/g

type Frame = {
  tag: string
  condition: string | null
  attrs: Record<string, string>
  childVersion: string | null
  text: string
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10))
    )
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  ATTR_RE.lastIndex = 0
  for (let match = ATTR_RE.exec(raw); match; match = ATTR_RE.exec(raw)) {
    const name = match[1]
    const value = match[2].slice(1, -1)
    attrs[name] = decodeXml(value)
  }
  return attrs
}

function attr(attrs: Record<string, string>, name: string): string | null {
  const direct = attrs[name]
  if (direct !== undefined) return direct
  const key = Object.keys(attrs).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase()
  )
  return key ? attrs[key] : null
}

function combineConditions(
  outer: string | null,
  own: string | null
): string | null {
  const left = outer?.trim()
  const right = own?.trim()
  if (left && right) return `${left} && ${right}`
  return left || right || null
}

function normalizeVersion(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function projectName(fileName: string): string {
  const base = baseNameOf(fileName)
  const name = base.replace(/\.csproj$/i, '')
  return name || base || 'Project'
}

export function parseCsproj(
  source: string,
  fileName = 'Project.csproj'
): ParsedProjectFile {
  const projectRefs: ProjectRef[] = []
  const packageRefs: PackageRef[] = []
  const targetFrameworks = new Set<string>()
  const stack: Frame[] = []
  let issue: string | null = null
  let sawProject = false

  const finalize = (frame: Frame) => {
    const tag = frame.tag
    if (tag === 'ProjectReference') {
      const include = attr(frame.attrs, 'Include')
      if (include && include.trim()) {
        projectRefs.push({
          include: include.trim(),
          condition: frame.condition,
        })
      }
      return
    }
    if (tag === 'PackageReference') {
      const id = attr(frame.attrs, 'Include')
      if (!id || !id.trim()) return
      const version = normalizeVersion(
        attr(frame.attrs, 'Version') ?? frame.childVersion
      )
      packageRefs.push({
        id: id.trim(),
        version,
        condition: frame.condition,
      })
    }
  }

  const addTargetFrameworks = (value: string) => {
    for (const item of value.split(';')) {
      const trimmed = item.trim()
      if (trimmed) targetFrameworks.add(trimmed)
    }
  }

  const closeFrame = (frame: Frame) => {
    const parent = stack.length > 0 ? stack[stack.length - 1] : null
    if (frame.tag === 'Version' && parent?.tag === 'PackageReference') {
      parent.childVersion = frame.text.trim() || null
    }
    if (frame.tag === 'TargetFramework' || frame.tag === 'TargetFrameworks') {
      addTargetFrameworks(frame.text)
    }
    finalize(frame)
  }

  let lastIndex = 0
  TAG_RE.lastIndex = 0
  for (let match = TAG_RE.exec(source); match; match = TAG_RE.exec(source)) {
    const between = source.slice(lastIndex, match.index)
    if (stack.length > 0) stack[stack.length - 1].text += between
    lastIndex = match.index + match[0].length

    if (!match[1]) continue // комментарий, PI или CDATA
    const tag = match[1].split(':').pop() || match[1]
    const rawAttrs = match[2] || ''
    const selfClosing = match[0].endsWith('/>')
    const closing = match[0].startsWith('</')

    if (tag === 'Project' && !closing) sawProject = true

    if (closing) {
      const top = stack[stack.length - 1]
      if (!top || top.tag !== tag) {
        issue = issue ?? 'Не удалось полностью разобрать файл проекта.'
        // Попробуем найти соответствующий элемент ниже, чтобы не потерять данные.
        const index = stack.map((frame) => frame.tag).lastIndexOf(tag)
        if (index >= 0) {
          while (stack.length > index) {
            const frame = stack.pop()!
            closeFrame(frame)
          }
        }
        continue
      }
      stack.pop()
      closeFrame(top)
      continue
    }

    const parentCondition =
      stack.length > 0 ? stack[stack.length - 1].condition : null
    const attrs = parseAttrs(rawAttrs)
    const condition = combineConditions(
      parentCondition,
      attr(attrs, 'Condition')
    )
    const frame: Frame = {
      tag,
      condition,
      attrs,
      childVersion: null,
      text: '',
    }

    if (selfClosing) {
      if (tag === 'Version' && stack.length > 0 && stack[stack.length - 1].tag === 'PackageReference') {
        stack[stack.length - 1].childVersion = null
      }
      closeFrame(frame)
      continue
    }

    stack.push(frame)
  }

  const tail = source.slice(lastIndex)
  if (stack.length > 0) stack[stack.length - 1].text += tail
  if (stack.length > 0) {
    issue = issue ?? 'Не удалось полностью разобрать файл проекта.'
    while (stack.length > 0) closeFrame(stack.pop()!)
  }
  if (!sawProject) issue = issue ?? 'Не удалось полностью разобрать файл проекта.'

  return {
    name: projectName(fileName),
    targetFrameworks: Array.from(targetFrameworks).sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0
    ),
    projectRefs,
    packageRefs,
    issue,
  }
}
