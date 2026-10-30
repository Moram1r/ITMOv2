import { describe, it, expect } from 'vitest'
import { parseCsFile } from '../src/lib/graph/cs-parser'
import { parseCsproj } from '../src/lib/graph/csproj-parser'

describe('parseCsFile', () => {
  it('извлекает using, using static, alias и namespace', () => {
    const parsed = parseCsFile(`
using System;
using System.Collections.Generic;
using B.Services;
using static B.Services.Helper;
using S = B.Services;
using G = global::System.Text;
namespace Demo.A;
class C {}
`)

    expect(parsed.namespaces).toEqual(['Demo.A'])
    expect(parsed.usings.map((u) => u.target)).toEqual([
      'System',
      'System.Collections.Generic',
      'B.Services',
      'B.Services.Helper',
      'B.Services',
      'System.Text',
    ])
    expect(parsed.usings[3]).toMatchObject({ isStatic: true, alias: null })
    expect(parsed.usings[4]).toMatchObject({ isStatic: false, alias: 'S' })
    expect(parsed.usings[5]).toMatchObject({ isStatic: false, alias: 'G' })
    expect(parsed.issue).toBeNull()
  })

  it('игнорирует комментарии, XML-комментарии, строки и char-литералы', () => {
    const parsed = parseCsFile(`
// using Fake.Line;
/* using Fake.Block; */
/// <summary>using Fake.Doc;</summary>
namespace Demo;
class C {
  string a = "using Fake.String;";
  string b = @"using Fake.Verbatim;";
  string c = $"using Fake.Interpolated;";
  string d = """using Fake.Raw;""";
  char e = '"';
  // using Fake.Trailing;
}
using Real.One;
`)

    expect(parsed.usings.map((u) => u.target)).toEqual(['Real.One'])
    expect(parsed.namespaces).toEqual(['Demo'])
    expect(parsed.issue).toBeNull()
  })

  it('считает using во всех ветвях #if', () => {
    const parsed = parseCsFile(`
#if DEBUG
using A.Debug;
#else
using A.Release;
#endif
namespace Demo;
`)

    expect(parsed.usings.map((u) => u.target)).toEqual([
      'A.Debug',
      'A.Release',
    ])
  })

  it('понимает блочный и вложенный namespace', () => {
    const block = parseCsFile(`
namespace Demo.Block
{
    class C {}
}
`)
    expect(block.namespaces).toEqual(['Demo.Block'])

    const nested = parseCsFile(`
namespace A.B
{
    namespace C
    {
        class X {}
    }
}
`)
    expect(nested.namespaces).toEqual(['A.B', 'A.B.C'])
  })

  it('возвращает пустой namespace без ошибки разбора', () => {
    const parsed = parseCsFile(`
using System;
class C {}
`)
    expect(parsed.namespaces).toEqual([])
    expect(parsed.issue).toBeNull()
  })

  it('сообщает о незавершённом строковом литерале', () => {
    const parsed = parseCsFile(`
namespace Demo;
class C { string s = "unterminated; }
`)
    expect(parsed.issue).not.toBeNull()
  })
})

describe('parseCsproj', () => {
  it('извлекает ProjectReference, PackageReference, версии, условия и TFM', () => {
    const parsed = parseCsproj(
      `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net8.0;net48</TargetFrameworks>
  </PropertyGroup>
  <ItemGroup Condition="'$(Configuration)' == 'Debug'">
    <ProjectReference Include="..\\B\\B.csproj" />
    <PackageReference Include="Pkg.Attr" Version="1.2.3" Condition="'$(OS)' == 'Windows'" />
    <PackageReference Include="Pkg.Child">
      <Version>2.0.0</Version>
    </PackageReference>
  </ItemGroup>
  <!-- <ProjectReference Include="..\\Ignored\\Ignored.csproj" /> -->
  <Choose>
    <When Condition="'$(A)' == '1'">
      <ItemGroup>
        <ProjectReference Include="..\\C\\C.csproj" />
      </ItemGroup>
    </When>
  </Choose>
</Project>`,
      'Demo/A/Demo.csproj'
    )

    expect(parsed.name).toBe('Demo')
    expect(parsed.targetFrameworks).toEqual(['net48', 'net8.0'])
    expect(parsed.projectRefs).toEqual([
      {
        include: '..\\B\\B.csproj',
        condition: "'$(Configuration)' == 'Debug'",
      },
      { include: '..\\C\\C.csproj', condition: "'$(A)' == '1'" },
    ])
    expect(parsed.packageRefs).toEqual([
      {
        id: 'Pkg.Attr',
        version: '1.2.3',
        condition:
          "'$(Configuration)' == 'Debug' && '$(OS)' == 'Windows'",
      },
      {
        id: 'Pkg.Child',
        version: '2.0.0',
        condition: "'$(Configuration)' == 'Debug'",
      },
    ])
    expect(parsed.issue).toBeNull()
  })

  it('объединяет вложенные условия от внешнего к внутреннему', () => {
    const parsed = parseCsproj(`<Project>
  <Choose>
    <When Condition="'$(A)' == '1'">
      <ItemGroup Condition="'$(B)' == '2'">
        <PackageReference Include="Pkg" Version="1.0" Condition="'$(C)' == '3'" />
      </ItemGroup>
    </When>
  </Choose>
</Project>`)

    expect(parsed.packageRefs).toHaveLength(1)
    expect(parsed.packageRefs[0].condition).toBe(
      "'$(A)' == '1' && '$(B)' == '2' && '$(C)' == '3'"
    )
  })

  it('понимает TargetFramework, версию без значения и отсутствие Include', () => {
    const parsed = parseCsproj(`<Project>
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="No.Version" />
    <ProjectReference />
  </ItemGroup>
</Project>`)

    expect(parsed.targetFrameworks).toEqual(['net8.0'])
    expect(parsed.packageRefs).toEqual([
      { id: 'No.Version', version: null, condition: null },
    ])
    expect(parsed.projectRefs).toEqual([])
  })

  it('декодирует XML-сущности в условии и корректно читает > в кавычках', () => {
    const parsed = parseCsproj(`<Project>
  <ItemGroup Condition="'$(Version)' &gt; '1.0'">
    <PackageReference Include="Pkg" Version="1.0" Condition="'$(X)' == 'a>b'" />
  </ItemGroup>
</Project>`)

    expect(parsed.packageRefs[0].condition).toBe(
      "'$(Version)' > '1.0' && '$(X)' == 'a>b'"
    )
  })

  it('сообщает о незакрытом элементе', () => {
    const parsed = parseCsproj(
      '<Project><ItemGroup><PackageReference Include="A" /></Project>'
    )
    expect(parsed.issue).not.toBeNull()
  })
})
