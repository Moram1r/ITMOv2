import { describe, it, expect } from 'vitest'
import { analyzeZipFile } from '../src/lib/zip-analyzer'
import { analyzeCsharpGraph, GraphAnalysisError } from '../src/lib/graph/build-graph'
import type { GraphEdge, GraphNode, GraphResult } from '../src/lib/graph/types'
import { buildZipFile, textEntries } from './graph-fixtures'

const BASE_FILES: Record<string, string> = {
  'Demo/A/A.csproj': `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="..\\B\\B.csproj" />
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>`,
  'Demo/A/Program.cs': `using System;
using B.Services;
namespace Demo.A;
class Program {}
`,
  'Demo/B/B.csproj': `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`,
  'Demo/B/Services.cs': `namespace B.Services;
class Services {}
`,
}

async function analyze(
  files: Record<string, string>,
  name = 'project.zip',
  limits?: Parameters<typeof analyzeCsharpGraph>[2]
): Promise<{ file: File; graph: GraphResult }> {
  const file = await buildZipFile(name, textEntries(files))
  const analysis = await analyzeZipFile(file)
  const graph = await analyzeCsharpGraph(file, analysis, limits)
  return { file, graph }
}

function node(graph: GraphResult, id: string): GraphNode {
  const found = graph.nodes.find((n) => n.id === id)
  if (!found) throw new Error(`Нет узла ${id}`)
  return found
}

function edge(
  graph: GraphResult,
  from: string,
  to: string,
  kind: GraphEdge['kind']
): GraphEdge {
  const found = graph.edges.find(
    (e) => e.from === from && e.to === to && e.kind === kind
  )
  if (!found) throw new Error(`Нет ребра ${from} -> ${to} (${kind})`)
  return found
}

describe('analyzeCsharpGraph: основная сборка', () => {
  it('строит проекты, файлы, пакет и связи', async () => {
    const { graph } = await analyze(BASE_FILES)

    expect(graph.archiveName).toBe('project.zip')
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'project:Demo/A/A.csproj',
      'project:Demo/B/B.csproj',
      'file:Demo/A/Program.cs',
      'file:Demo/B/Services.cs',
      'package:newtonsoft.json',
    ])
    expect(graph.nodes.map((n) => n.label)).toEqual([
      'A',
      'B',
      'Demo/A/Program.cs',
      'Demo/B/Services.cs',
      'newtonsoft.json',
    ])
    expect(graph.nodes.every((n) => n.status === 'known')).toBe(true)

    const projectA = node(graph, 'project:Demo/A/A.csproj')
    expect(projectA.kind).toBe('project')
    if (projectA.kind === 'project') {
      expect(projectA.name).toBe('A')
      expect(projectA.path).toBe('Demo/A/A.csproj')
      expect(projectA.tablePath).toBe('Demo/A/A.csproj')
      expect(projectA.targetFrameworks).toEqual(['net8.0'])
      expect(projectA.sourceFileIds).toEqual(['file:Demo/A/Program.cs'])
    }

    const program = node(graph, 'file:Demo/A/Program.cs')
    expect(program.kind).toBe('source')
    if (program.kind === 'source') {
      expect(program.projectId).toBe('project:Demo/A/A.csproj')
      expect(program.namespaces).toEqual(['Demo.A'])
      expect(program.usingCount).toBe(2)
      expect(program.tablePath).toBe('Demo/A/Program.cs')
    }

    expect(edge(graph, 'project:Demo/A/A.csproj', 'project:Demo/B/B.csproj', 'project-reference')).toMatchObject({
      certainty: 'declared',
      condition: null,
    })
    expect(edge(graph, 'project:Demo/A/A.csproj', 'package:newtonsoft.json', 'package-reference')).toMatchObject({
      certainty: 'declared',
      packageVersion: '13.0.3',
      condition: null,
    })
    expect(edge(graph, 'file:Demo/A/Program.cs', 'file:Demo/B/Services.cs', 'using')).toMatchObject({
      certainty: 'namespace-match',
      namespace: 'B.Services',
      condition: null,
    })

    expect(graph.stats).toEqual({
      projectCount: 2,
      sourceFileCount: 2,
      packageCount: 1,
      nodeCount: 5,
      edgeCount: 3,
      namespaceCount: 2,
      systemUsingCount: 1,
      externalUsingCount: 0,
      unresolvedCount: 0,
      excluded: { objBin: 0, otherTypes: 0, total: 0 },
    })
    expect(graph.unresolved).toEqual([])
    expect(graph.warnings).toEqual([])
  })

  it('объединяет пакет с разными версиями в один узел', async () => {
    const { graph } = await analyze({
      'A/A.csproj': `<Project>
  <ItemGroup>
    <PackageReference Include="Pkg" Version="1.0" />
    <PackageReference Include="pkg" Version="2.0" />
    <PackageReference Include="Pkg" />
  </ItemGroup>
</Project>`,
    })

    const pkg = node(graph, 'package:pkg')
    expect(pkg.kind).toBe('package')
    if (pkg.kind === 'package') {
      expect(pkg.packageId).toBe('Pkg')
      expect(pkg.label).toBe('pkg')
      expect(pkg.versions).toEqual([null, '1.0', '2.0'])
      expect(pkg.status).toBe('known')
    }
    const versions = graph.edges
      .filter((e) => e.kind === 'package-reference')
      .map((e) => e.packageVersion)
    expect(versions).toContain('1.0')
    expect(versions).toContain('2.0')
    expect(versions).toContain(null)
    expect(graph.stats.packageCount).toBe(1)
  })

  it('сортирует узлы, рёбра и неразрешённые ссылки детерминированно', async () => {
    const { graph } = await analyze({
      ...BASE_FILES,
      'Demo/A/Extra.cs': 'using Missing.One;\nusing Missing.Two;\nnamespace Demo.A;\n',
    })

    const kinds = graph.nodes.map((n) => n.kind)
    expect(kinds).toEqual([...kinds].sort((a, b) => {
      const order = { project: 0, file: 1, package: 2 }
      return order[a] - order[b]
    }))
    const edgeKeys = graph.edges.map((e) => [e.from, e.to, e.kind, e.id])
    expect(edgeKeys).toEqual(
      [...edgeKeys].sort((a, b) => {
        for (let i = 0; i < 4; i++) {
          if (a[i] < b[i]) return -1
          if (a[i] > b[i]) return 1
        }
        return 0
      })
    )
    expect(graph.unresolved.map((u) => u.target)).toEqual([
      'Missing.One',
      'Missing.Two',
    ])
  })
})

describe('analyzeCsharpGraph: namespace и using', () => {
  it('не создаёт ребро при совпадении namespace в другом регистре', async () => {
    const { graph } = await analyze({
      'A/A.csproj': '<Project />',
      'A/Program.cs': 'using b.services;\nnamespace A;\n',
      'B/B.csproj': '<Project />',
      'B/Services.cs': 'namespace B.Services;\n',
    })

    expect(graph.edges).toEqual([])
    expect(graph.unresolved).toEqual([
      expect.objectContaining({
        kind: 'using',
        reason: 'NAMESPACE_CASE_MISMATCH',
        target: 'b.services',
        candidates: ['B.Services'],
        count: 1,
      }),
    ])
    expect(graph.stats.unresolvedCount).toBe(1)
    expect(graph.stats.externalUsingCount).toBe(1)
  })

  it('обрабатывает using static, alias и System', async () => {
    const { graph } = await analyze({
      'A/A.csproj': '<Project />',
      'A/Program.cs': `using static B.Services.Helper;
using static System.Math;
using S = B.Services;
using T = Missing.Target;
using System.Text;
namespace A;
`,
      'B/B.csproj': '<Project />',
      'B/Services.cs': 'namespace B.Services;\n',
    })

    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]).toMatchObject({
      from: 'file:A/Program.cs',
      to: 'file:B/Services.cs',
      kind: 'using',
      namespace: 'B.Services',
    })
    expect(graph.unresolved.map((u) => u.reason).sort()).toEqual([
      'ALIAS_TARGET_UNSUPPORTED',
      'STATIC_USING_UNSUPPORTED',
    ])
    const staticItem = graph.unresolved.find(
      (u) => u.reason === 'STATIC_USING_UNSUPPORTED'
    )!
    expect(staticItem.candidates).toEqual(['B.Services'])
    expect(graph.stats.systemUsingCount).toBe(2)
    expect(graph.stats.externalUsingCount).toBe(2)
    expect(graph.stats.unresolvedCount).toBe(2)
  })

  it('не создаёт рёбер и unresolved для System/System.*', async () => {
    const { graph } = await analyze({
      'A/A.csproj': '<Project />',
      'A/Program.cs': `using System;
using System.Linq;
using External.Lib;
namespace A;
`,
    })

    expect(graph.edges).toEqual([])
    expect(graph.unresolved).toEqual([
      expect.objectContaining({
        reason: 'EXTERNAL_NAMESPACE',
        target: 'External.Lib',
        candidates: [],
      }),
    ])
    expect(graph.stats.systemUsingCount).toBe(2)
    expect(graph.stats.externalUsingCount).toBe(1)
  })

  it('создаёт рёбра ко всем файлам с namespace и пропускает собственный namespace', async () => {
    const { graph } = await analyze({
      'A/A.csproj': '<Project />',
      'A/Program.cs': 'using B.Services;\nusing B.Services;\nnamespace A;\n',
      'B/B.csproj': '<Project />',
      'B/One.cs': 'namespace B.Services;\n',
      'B/Two.cs': 'namespace B.Services;\n',
      'B/Own.cs': 'using B.Services;\nnamespace B.Services;\n',
    })

    const usingEdges = graph.edges.filter((e) => e.kind === 'using')
    expect(usingEdges).toHaveLength(3)
    expect(usingEdges.map((e) => e.to).sort()).toEqual([
      'file:B/One.cs',
      'file:B/Own.cs',
      'file:B/Two.cs',
    ])
    expect(usingEdges.filter((e) => e.from === 'file:B/Own.cs')).toEqual([])
    expect(graph.unresolved).toEqual([])
    expect(node(graph, 'file:A/Program.cs')).toMatchObject({ usingCount: 2 })
  })

  it('не создаёт self-edge и агрегирует повторные unresolved', async () => {
    const { graph } = await analyze({
      'A/A.csproj': '<Project />',
      'A/Program.cs': `using A;
using A;
using Missing;
using Missing;
namespace A;
`,
    })

    expect(graph.edges).toEqual([])
    expect(graph.unresolved).toHaveLength(1)
    expect(graph.unresolved[0]).toMatchObject({
      target: 'Missing',
      reason: 'EXTERNAL_NAMESPACE',
      count: 2,
    })
    expect(graph.stats.unresolvedCount).toBe(2)
    expect(graph.stats.externalUsingCount).toBe(1)
    expect(node(graph, 'file:A/Program.cs')).toMatchObject({ usingCount: 4 })
  })

  it('учитывает using во всех ветвях #if без дублей рёбер', async () => {
    const { graph } = await analyze({
      'A/A.csproj': '<Project />',
      'A/Program.cs': `#if DEBUG
using B.Services;
#else
using B.Services;
#endif
namespace A;
`,
      'B/B.csproj': '<Project />',
      'B/Services.cs': 'namespace B.Services;\n',
    })

    expect(graph.edges.filter((e) => e.kind === 'using')).toHaveLength(1)
    expect(node(graph, 'file:A/Program.cs')).toMatchObject({ usingCount: 2 })
  })
})

describe('analyzeCsharpGraph: csproj', () => {
  it('помечает условные рёбра и сохраняет условие', async () => {
    const { graph } = await analyze({
      'A/A.csproj': `<Project>
  <ItemGroup Condition="'$(A)' == 'x|y'">
    <ProjectReference Include="..\\B\\B.csproj" />
    <PackageReference Include="Pkg" Version="1.0" />
  </ItemGroup>
  <ItemGroup Condition="'$(A)' == 'z|w'">
    <PackageReference Include="Pkg" Version="1.0" />
  </ItemGroup>
</Project>`,
      'B/B.csproj': '<Project />',
    })

    const conditional = graph.edges.filter((e) => e.certainty === 'conditional')
    expect(conditional).toHaveLength(3)
    expect(conditional.every((e) => e.condition !== null)).toBe(true)
    expect(conditional.some((e) => e.condition === "'$(A)' == 'x|y'")).toBe(true)
    const packageEdges = conditional.filter(
      (e) => e.kind === 'package-reference'
    )
    expect(packageEdges).toHaveLength(2)
    expect(new Set(packageEdges.map((e) => e.id)).size).toBe(2)
    expect(packageEdges.every((e) => e.id.includes('\\|'))).toBe(true)
  })

  it('разрешает циклы и не считает их ошибкой', async () => {
    const { graph } = await analyze({
      'A/A.csproj':
        '<Project><ItemGroup><ProjectReference Include="..\\B\\B.csproj" /></ItemGroup></Project>',
      'B/B.csproj':
        '<Project><ItemGroup><ProjectReference Include="..\\A\\A.csproj" /></ItemGroup></Project>',
    })

    expect(graph.edges.filter((e) => e.kind === 'project-reference')).toHaveLength(2)
    expect(graph.unresolved).toEqual([])
  })

  it('не разрешает небезопасные ProjectReference и MSBuild-свойства', async () => {
    const { graph } = await analyze({
      'Demo/A/A.csproj': `<Project>
  <ItemGroup>
    <ProjectReference Include="C:\\X\\C.csproj" />
    <ProjectReference Include="$(SolutionDir)C.csproj" />
    <ProjectReference Include="..\\..\\..\\C.csproj" />
  </ItemGroup>
</Project>`,
    })

    expect(graph.edges).toEqual([])
    expect(graph.unresolved).toHaveLength(3)
    expect(graph.unresolved.every((u) => u.reason === 'PROJECT_NOT_FOUND')).toBe(true)
    expect(graph.stats.unresolvedCount).toBe(3)
  })

  it('сохраняет версию пакета с MSBuild-свойством как текст', async () => {
    const { graph } = await analyze({
      'A/A.csproj':
        '<Project><ItemGroup><PackageReference Include="Pkg" Version="$(Version)" /></ItemGroup></Project>',
    })

    expect(edge(graph, 'project:A/A.csproj', 'package:pkg', 'package-reference')).toMatchObject({
      packageVersion: '$(Version)',
    })
    expect(node(graph, 'package:pkg')).toMatchObject({
      versions: ['$(Version)'],
    })
  })
})

describe('analyzeCsharpGraph: статусы, предупреждения и пути', () => {
  it('помечает файл без namespace и слишком большой файл как partial/unknown', async () => {
    const big = `namespace Big;\n${'x'.repeat(100)}`
    const { graph } = await analyze(
      {
        'A/A.csproj': '<Project />',
        'A/Program.cs': 'using System;\nclass C {}\n',
        'A/Big.cs': big,
      },
      'project.zip',
      { maxFileBytes: 50 }
    )

    expect(node(graph, 'file:A/Program.cs')).toMatchObject({
      status: 'partial',
      namespaces: [],
    })
    expect(node(graph, 'file:A/Big.cs')).toMatchObject({
      status: 'unknown',
      namespaces: [],
      usingCount: 0,
    })
    expect(node(graph, 'project:A/A.csproj')).toMatchObject({ status: 'partial' })
    expect(graph.warnings).toEqual([
      expect.objectContaining({
        code: 'EMPTY_NAMESPACE',
        paths: ['A/Program.cs'],
        count: 1,
      }),
      expect.objectContaining({
        code: 'FILE_TOO_LARGE',
        paths: ['A/Big.cs'],
        count: 1,
      }),
    ])
  })

  it('объединяет дубликаты путей в один неизвестный узел', async () => {
    const { graph } = await analyze({
      'A/A.csproj': '<Project />',
      'A/Program.cs': 'namespace First;\n',
      'A/program.cs': 'namespace Second;\n',
    })

    const sources = graph.nodes.filter((n) => n.kind === 'source')
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      id: 'file:A/Program.cs',
      path: 'A/Program.cs',
      tablePath: null,
      status: 'unknown',
      namespaces: [],
      usingCount: 0,
    })
    expect(graph.stats.sourceFileCount).toBe(1)
    expect(graph.stats.namespaceCount).toBe(0)
    expect(graph.warnings).toEqual([
      expect.objectContaining({
        code: 'DUPLICATE_PATH',
        paths: ['A/Program.cs'],
        count: 2,
      }),
    ])
    expect(graph.stats.excluded.total).toBe(0)
  })

  it('нормализует обратные слэши и сохраняет исходный tablePath', async () => {
    const { graph } = await analyze({
      'Demo\\A\\A.csproj': '<Project />',
      'Demo\\A\\Program.cs': 'namespace Demo.A;\n',
    })

    const source = node(graph, 'file:Demo/A/Program.cs')
    expect(source).toMatchObject({
      path: 'Demo/A/Program.cs',
      tablePath: 'Demo\\A\\Program.cs',
      label: 'Demo/A/Program.cs',
    })
    expect(node(graph, 'project:Demo/A/A.csproj')).toMatchObject({
      path: 'Demo/A/A.csproj',
      tablePath: 'Demo\\A\\A.csproj',
    })
  })

  it('выбирает первый проект в каталоге и предупреждает о нескольких', async () => {
    const { graph } = await analyze({
      'A/One.csproj': '<Project />',
      'A/Two.csproj': '<Project />',
      'A/File.cs': 'namespace A;\n',
    })

    expect(node(graph, 'file:A/File.cs')).toMatchObject({
      projectId: 'project:A/One.csproj',
    })
    expect(graph.warnings).toEqual([
      expect.objectContaining({
        code: 'MULTIPLE_PROJECTS_IN_DIR',
        paths: ['A/One.csproj', 'A/Two.csproj'],
        count: 2,
      }),
    ])
  })

  it('сообщает о замечании разбора csproj', async () => {
    const { graph } = await analyze({
      'A/A.csproj': '<Project><ItemGroup>',
    })

    expect(node(graph, 'project:A/A.csproj')).toMatchObject({ status: 'partial' })
    expect(graph.warnings).toEqual([
      expect.objectContaining({
        code: 'PARSE_ISSUE',
        paths: ['A/A.csproj'],
        count: 1,
      }),
    ])
  })

  it('помечает нечитаемый csproj как unknown', async () => {
    const { graph } = await analyze(
      {
        'A/A.csproj': `<Project>${'x'.repeat(100)}</Project>`,
      },
      'project.zip',
      { maxFileBytes: 20 }
    )

    expect(node(graph, 'project:A/A.csproj')).toMatchObject({ status: 'unknown' })
    expect(graph.warnings).toEqual([
      expect.objectContaining({ code: 'FILE_TOO_LARGE', count: 1 }),
    ])
  })

  it('не включает исходный текст в результат', async () => {
    const secret = 'UNIQUE_SECRET_123'
    const { graph } = await analyze({
      'A/A.csproj': '<Project />',
      'A/Program.cs': `namespace A;\nclass C { string S = "${secret}"; }\n`,
    })

    const serialized = JSON.stringify(graph)
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('class C')
  })

  it('даёт одинаковый результат при повторном запуске', async () => {
    const first = await analyze(BASE_FILES)
    const second = await analyze(BASE_FILES)
    expect(second.graph).toEqual(first.graph)
  })

  it('отклоняет AnalysisResult от другого файла', async () => {
    const file = await buildZipFile('one.zip', textEntries(BASE_FILES))
    const analysis = await analyzeZipFile(file)
    await expect(
      analyzeCsharpGraph(file, { ...analysis, archiveName: 'other.zip' })
    ).rejects.toMatchObject({ code: 'INPUT_MISMATCH' })
  })
})
