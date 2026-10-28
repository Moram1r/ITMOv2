import { sortUnique } from './paths'
import type { ParsedCsFile, UsingRef } from './types'

const IDENT = String.raw`[\p{L}_][\p{L}\p{N}_]*`
const NAMESPACE_RE = new RegExp(
  String.raw`\bnamespace\s+(${IDENT}(?:\s*\.\s*${IDENT})*)\s*([;{])|\{|\}`,
  'gu'
)
const USING_RE = new RegExp(
  String.raw`\b(?:global\s+)?using\s+(?:(static)\s+)?(?:(${IDENT})\s*=\s*)?((?:global\s*::\s*)?${IDENT}(?:\s*\.\s*${IDENT})*)\s*;`,
  'gu'
)

type Stripped = { text: string; issue: string | null }

type StringPrefix = {
  quoteStart: number
  verbatim: boolean
  interpolated: boolean
  rawQuotes: number
}

function stringPrefix(source: string, index: number): StringPrefix | null {
  let i = index
  let verbatim = false
  let interpolated = false
  while (i < source.length && (source[i] === '@' || source[i] === '$')) {
    if (source[i] === '@') verbatim = true
    else interpolated = true
    i++
  }
  if (source[i] !== '"') return null
  let quotes = 0
  while (source[i + quotes] === '"') quotes++
  return { quoteStart: i, verbatim, interpolated, rawQuotes: quotes }
}

function scanCharLiteral(
  source: string,
  start: number
): { end: number; terminated: boolean } {
  let i = start + 1
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === "'") return { end: i + 1, terminated: true }
    if (ch === '\n' || ch === '\r') return { end: i, terminated: false }
    i++
  }
  return { end: source.length, terminated: false }
}

function scanRegularString(
  source: string,
  prefix: StringPrefix
): { end: number; terminated: boolean } {
  const start = prefix.quoteStart
  let i = start + 1
  let braceDepth = 0

  while (i < source.length) {
    const ch = source[i]

    if (braceDepth === 0) {
      if (prefix.interpolated) {
        if (ch === '{') {
          if (source[i + 1] === '{') {
            i += 2
            continue
          }
          braceDepth = 1
          i++
          continue
        }
        if (ch === '}') {
          i += source[i + 1] === '}' ? 2 : 1
          continue
        }
      }

      if (prefix.verbatim) {
        if (ch === '"') {
          if (source[i + 1] === '"') {
            i += 2
            continue
          }
          return { end: i + 1, terminated: true }
        }
        i++
        continue
      }

      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '\n' || ch === '\r') return { end: i, terminated: false }
      if (ch === '"') return { end: i + 1, terminated: true }
      i++
      continue
    }

    // Внутри выражения интерполяции: считаем фигурные скобки и пропускаем
    // вложенные строки, char-литералы и комментарии.
    if (ch === '{') {
      braceDepth++
      i++
      continue
    }
    if (ch === '}') {
      braceDepth--
      i++
      continue
    }
    if (ch === '"' || ch === '@' || ch === '$') {
      const nested = stringPrefix(source, i)
      if (nested) {
        if (nested.rawQuotes >= 3) {
          const end = scanRawString(source, nested)
          i = end.end
          if (!end.terminated) return { end: i, terminated: false }
          continue
        }
        const end = scanRegularString(source, nested)
        i = end.end
        if (!end.terminated) return { end: i, terminated: false }
        continue
      }
    }
    if (ch === "'") {
      const end = scanCharLiteral(source, i)
      i = end.end
      if (!end.terminated) return { end: i, terminated: false }
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i + 2)
      i = end < 0 ? source.length : end
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      if (end < 0) return { end: source.length, terminated: false }
      i = end + 2
      continue
    }
    i++
  }

  return { end: source.length, terminated: false }
}

function scanRawString(
  source: string,
  prefix: StringPrefix
): { end: number; terminated: boolean } {
  const delimiter = '"'.repeat(prefix.rawQuotes)
  const contentStart = prefix.quoteStart + prefix.rawQuotes
  const close = source.indexOf(delimiter, contentStart)
  if (close < 0) return { end: source.length, terminated: false }
  return { end: close + prefix.rawQuotes, terminated: true }
}

function scanString(
  source: string,
  prefix: StringPrefix
): { end: number; terminated: boolean } {
  if (prefix.rawQuotes >= 3) return scanRawString(source, prefix)
  return scanRegularString(source, prefix)
}

/**
 * Заменяет комментарии и литералы пробелами, сохраняя переводы строк.
 * Исходный C# не выполняется и не компилируется.
 */
export function stripCommentsAndLiterals(source: string): Stripped {
  let out = ''
  let copiedFrom = 0
  let issue: string | null = null

  const blank = (from: number, to: number) => {
    out += source.slice(copiedFrom, from)
    for (let i = from; i < to; i++) {
      out += source[i] === '\n' ? '\n' : ' '
    }
    copiedFrom = to
  }

  let i = 0
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]

    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i + 2)
      blank(i, end < 0 ? source.length : end)
      i = end < 0 ? source.length : end
      continue
    }

    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      if (end < 0) {
        issue = 'Не удалось полностью разобрать файл.'
        blank(i, source.length)
        i = source.length
        break
      }
      blank(i, end + 2)
      i = end + 2
      continue
    }

    if (ch === '"' || ch === '@' || ch === '$') {
      const prefix = stringPrefix(source, i)
      if (prefix) {
        const result = scanString(source, prefix)
        if (!result.terminated) issue = 'Не удалось полностью разобрать файл.'
        blank(i, result.end)
        i = result.end
        continue
      }
    }

    if (ch === "'") {
      const result = scanCharLiteral(source, i)
      if (!result.terminated) issue = 'Не удалось полностью разобрать файл.'
      blank(i, result.end)
      i = result.end
      continue
    }

    i++
  }

  out += source.slice(copiedFrom)
  return { text: out, issue }
}

function lineAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++
  return line
}

function normalizeNamespaceName(value: string): string {
  return value.replace(/\s+/g, '')
}

function normalizeUsingTarget(value: string): string {
  return normalizeNamespaceName(value.replace(/global\s*::\s*/g, ''))
}

export function parseCsFile(source: string): ParsedCsFile {
  const stripped = stripCommentsAndLiterals(source)
  const text = stripped.text
  let issue = stripped.issue

  const namespaces = new Set<string>()
  const stack: Array<{ name: string; depth: number }> = []
  let braceDepth = 0
  let fileScoped: { name: string; index: number } | null = null

  NAMESPACE_RE.lastIndex = 0
  for (let match = NAMESPACE_RE.exec(text); match; match = NAMESPACE_RE.exec(text)) {
    if (match[0] === '{') {
      braceDepth++
      continue
    }
    if (match[0] === '}') {
      braceDepth--
      if (braceDepth < 0) {
        issue = issue ?? 'Не удалось полностью разобрать файл.'
        braceDepth = 0
        continue
      }
      while (stack.length > 0 && stack[stack.length - 1].depth >= braceDepth) {
        stack.pop()
      }
      continue
    }

    const name = normalizeNamespaceName(match[1])
    const parent = stack.length > 0 ? stack[stack.length - 1].name : null
    const fullName = parent ? `${parent}.${name}` : name
    namespaces.add(fullName)

    if (match[2] === ';') {
      fileScoped = { name: fullName, index: match.index + match[0].length }
    } else {
      stack.push({ name: fullName, depth: braceDepth })
      braceDepth++
    }
  }
  if (braceDepth !== 0) issue = issue ?? 'Не удалось полностью разобрать файл.'

  const usings: UsingRef[] = []
  USING_RE.lastIndex = 0
  for (let match = USING_RE.exec(text); match; match = USING_RE.exec(text)) {
    const target = normalizeUsingTarget(match[3])
    if (!target) continue
    usings.push({
      target,
      isStatic: Boolean(match[1]),
      alias: match[2] ? match[2] : null,
      scopeNamespace:
        fileScoped && match.index > fileScoped.index ? fileScoped.name : null,
      line: lineAt(text, match.index),
    })
  }

  return {
    namespaces: sortUnique(namespaces),
    usings,
    issue,
  }
}
