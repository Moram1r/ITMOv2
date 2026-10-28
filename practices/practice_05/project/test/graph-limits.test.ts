import { describe, it, expect } from 'vitest'
import { analyzeZipFile } from '../src/lib/zip-analyzer'
import { analyzeCsharpGraph } from '../src/lib/graph/build-graph'
import { buildZipFile, textEntries, utf8 } from './graph-fixtures'

async function graphFor(
  files: Record<string, string | Uint8Array>,
  limits?: Parameters<typeof analyzeCsharpGraph>[2]
) {
  const entries = Object.entries(files).map(([name, data]) => ({ name, data }))
  const file = await buildZipFile('limits.zip', entries)
  const analysis = await analyzeZipFile(file)
  return analyzeCsharpGraph(file, analysis, limits)
}

describe('лимиты и границы графа', () => {
  it('возвращает NO_CSHARP_FILES для архива без C#-файлов', async () => {
    const file = await buildZipFile(
      'readme.zip',
      textEntries({ 'README.md': '# Привет' })
    )
    const analysis = await analyzeZipFile(file)
    await expect(analyzeCsharpGraph(file, analysis)).rejects.toMatchObject({
      code: 'NO_CSHARP_FILES',
    })
  })

  it('возвращает NO_CSHARP_FILES, если все C#-пути небезопасны', async () => {
    // zip.js сам отвергает небезопасные имена при чтении, поэтому проверяем
    // защиту analyzeCsharpGraph на подготовленном AnalysisResult.
    const file = await buildZipFile(
      'unsafe.zip',
      textEntries({ 'README.md': '# Архив' })
    )
    const analysis = await analyzeZipFile(file)
    const unsafeAnalysis = {
      ...analysis,
      files: [
        { path: '/absolute/File.cs', ext: 'cs', sizeUncompressed: 10 },
        { path: 'C:\\drive\\File.cs', ext: 'cs', sizeUncompressed: 10 },
        { path: '../escape/File.cs', ext: 'cs', sizeUncompressed: 10 },
      ],
    }
    await expect(
      analyzeCsharpGraph(file, unsafeAnalysis)
    ).rejects.toMatchObject({
      code: 'NO_CSHARP_FILES',
    })
  })

  it('не читает файл больше maxFileBytes, но продолжает граф', async () => {
    const graph = await graphFor(
      {
        'A/A.csproj': '<Project />',
        'A/Big.cs': `namespace Big;\n${'x'.repeat(100)}`,
      },
      { maxFileBytes: 20 }
    )

    const big = graph.nodes.find((n) => n.id === 'file:A/Big.cs')
    expect(big).toMatchObject({ status: 'unknown' })
    expect(graph.warnings).toEqual([
      expect.objectContaining({ code: 'FILE_TOO_LARGE', count: 1 }),
    ])
  })

  it('считает суммарный текст в UTF-8 байтах и даёт LIMIT_TEXT_BYTES', async () => {
    const files = {
      'A/A.csproj': '<Project />',
      'A/Program.cs': 'namespace Демо.Пример;\nclass C {}\n',
    }
    const total = utf8(files['A/A.csproj']).length + utf8(files['A/Program.cs']).length

    await expect(graphFor(files, { maxTextBytes: total - 1 })).rejects.toMatchObject({
      code: 'LIMIT_TEXT_BYTES',
      limit: total - 1,
      actual: total,
      limitName: 'maxTextBytes',
    })
  })

  it('даёт LIMIT_NODES с фактическим числом узлов', async () => {
    await expect(
      graphFor(
        {
          'A/A.csproj': '<Project />',
          'A/Program.cs': 'namespace A;\n',
        },
        { maxNodes: 1 }
      )
    ).rejects.toMatchObject({
      code: 'LIMIT_NODES',
      limit: 1,
      actual: 2,
      limitName: 'maxNodes',
    })
  })

  it('даёт LIMIT_EDGES с фактическим числом рёбер', async () => {
    await expect(
      graphFor(
        {
          'A/A.csproj': `<Project><ItemGroup>
  <PackageReference Include="One" Version="1.0" />
  <PackageReference Include="Two" Version="1.0" />
</ItemGroup></Project>`,
        },
        { maxEdges: 1 }
      )
    ).rejects.toMatchObject({
      code: 'LIMIT_EDGES',
      limit: 1,
      actual: 2,
      limitName: 'maxEdges',
    })
  })

  it('не читает .env и ключи, учитывая их только как исключённые', async () => {
    const secret = 'UNIQUE_SECRET_VALUE'
    const graph = await graphFor({
      'A/A.csproj': '<Project />',
      'A/Program.cs': 'namespace A;\n',
      '.env': `API_KEY=${secret}`,
      'keys/private.key': `KEY=${secret}`,
    })

    const serialized = JSON.stringify(graph)
    expect(serialized).not.toContain(secret)
    expect(graph.stats.excluded).toEqual({
      objBin: 0,
      otherTypes: 2,
      total: 2,
    })
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'project:A/A.csproj',
      'file:A/Program.cs',
    ])
  })

  it('относит obj/, bin/ и прочие типы только в excluded', async () => {
    const graph = await graphFor({
      'A/A.csproj': '<Project />',
      'A/Program.cs': 'namespace A;\n',
      'obj/Generated.cs': 'namespace Generated;\n',
      'bin/Debug/Out.cs': 'namespace Out;\n',
      'README.md': '# Проект',
      'Solution.sln': 'Microsoft Visual Studio Solution File',
      '.env': 'SECRET=1',
    })

    expect(graph.stats.excluded).toEqual({
      objBin: 2,
      otherTypes: 3,
      total: 5,
    })
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'project:A/A.csproj',
      'file:A/Program.cs',
    ])
    expect(graph.stats.namespaceCount).toBe(1)
  })

  it('относит небезопасные пути в excluded.otherTypes', async () => {
    const file = await buildZipFile(
      'unsafe-mixed.zip',
      textEntries({
        'A/A.csproj': '<Project />',
        'A/Program.cs': 'namespace A;\n',
      })
    )
    const analysis = await analyzeZipFile(file)
    const withUnsafe = {
      ...analysis,
      files: [
        ...analysis.files,
        { path: '../escape.cs', ext: 'cs', sizeUncompressed: 10 },
        { path: '/absolute.cs', ext: 'cs', sizeUncompressed: 10 },
        { path: 'C:\\drive.cs', ext: 'cs', sizeUncompressed: 10 },
      ],
    }
    const graph = await analyzeCsharpGraph(file, withUnsafe)

    expect(graph.stats.excluded).toEqual({
      objBin: 0,
      otherTypes: 3,
      total: 3,
    })
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'project:A/A.csproj',
      'file:A/Program.cs',
    ])
  })

  it('не считает дубликаты путей исключёнными', async () => {
    const graph = await graphFor({
      'A/A.csproj': '<Project />',
      'A/Program.cs': 'namespace One;\n',
      'A/program.cs': 'namespace Two;\n',
    })

    expect(graph.stats.excluded.total).toBe(0)
    expect(graph.warnings).toEqual([
      expect.objectContaining({ code: 'DUPLICATE_PATH', count: 2 }),
    ])
  })
})
