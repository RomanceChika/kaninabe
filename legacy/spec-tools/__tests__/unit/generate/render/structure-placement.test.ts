/**
 * 読む側が置き場の配置から引く口(`code-structure-expectations.ts` ・`structure-usecase-expectations.ts` ・`code-lint-exceptions.ts`。部品化 ③-c4b)のテスト。
 *
 * 固定するのは 4 点 —— ①Next.js の値では、直書きしていたときと**同じパス**(生成物のバイト同一は `generate:check` も見る)②**別の配置(架空の値)では、期待ファイル木と免除表の鍵が
 * その配置の値になり、Next.js の綴りが残らない**(製品の根からの相対で引く)③実装の木を持たない製品は期待も免除も出さない ④配置が役割を解決できなければ、黙って落とさず前提の失敗で止まる。
 */

import { describe, expect, it } from 'vitest';
import { lintExceptionsGenerator } from '../../../../lib/generate/render/code-lint-exceptions.js';
import { structureExpectationsGenerator } from '../../../../lib/generate/render/code-structure-expectations.js';
import { hooksFilePathOf, hooksModuleOf } from '../../../../lib/generate/render/usecase-app-names.js';
import { frameworkStructureJsonSection } from '../../../../lib/generate/render/structure-framework.js';
import { usecaseExpectations } from '../../../../lib/generate/render/structure-usecase-expectations.js';
import type { BuiltSave } from '../../../../lib/usecase/plan-build.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { GeneratorPreconditionError } from '../../../../lib/kernel/generator-precondition.js';
import { EMPTY_LAYOUT } from '../../../../lib/model/product/layout.js';
import type { ProductLayout } from '../../../../lib/model/product/layout.js';
import type { ScanDecl } from '../../../../lib/model/trace/types.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { FOREIGN_LAYOUT, leaksNextjsEntrySpelling, TEST_LAYOUT } from '../../../helpers/platform.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { querySpec } from '../../../helpers/query-builder.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../../helpers/usecase-rpc-fixture.js';

/** container.create → item.create → item.submit の 1 保存点を持つユースケース。 */
const USECASE = usecaseSpec({
  name: 'demo',
  saves: [
    usecaseSave('register', [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')], {
      migration: '20260909000050_usecase_demo_register.sql',
      name: 'demo',
    }),
  ],
});

/** 走査の宣言(手書きの操作の本体が要る)。 */
const SCAN: ScanDecl = {
  event: 'item.expire',
  implementation: 'app/src/operation/item/expire.ts',
  location: { file: 'docs/specs/backend/actions/README.md' },
} as unknown as ScanDecl;

/** 免除の宣言 1 件(ルール ID と理由)。 */
function exception(rule: string): { rule: string; reason: string; location: { file: string } } {
  return { rule, reason: '生成では導けない形のため', location: { file: 'docs/specs/backend/actions/container/create.md' } };
}

/** 手書き(runner: manual)の操作と、免除つきの操作と、免除つきのクエリを持つ文脈。 */
function context(layout: ProductLayout = TEST_LAYOUT, app: string | null = GEN_CTX.roots.app): GenerateContext {
  const base = rpcActions();
  const exempted = { ...actionSpec({ handles: 'container.create', input: ['container.title'], owner: 'container.owner_id' }), exceptions: [exception('layer/no-x')] };
  return {
    ...GEN_CTX,
    roots: { ...GEN_CTX.roots, app },
    layout,
    actions: {
      ...base,
      actions: [exempted, ...base.actions.slice(1), actionSpec({ handles: 'item.tune', runner: { reason: '定型では組み立てられない' } })],
      scans: [SCAN],
    },
    queries: { available: true, queries: [{ ...querySpec({ name: 'container_list', source: 'container', for: ['member'], scopeUsed: 'own' }), exceptions: [exception('layer/no-y')] }] },
    dataTables: rpcDataTables(),
    usecases: { available: true, usecases: [USECASE] },
  };
}

/** 生成された期待ファイル木の本文から、`file: '…'` の値を全部取る。 */
function expectedFiles(ctx: GenerateContext): string[] {
  const content = structureExpectationsGenerator.generate(rpcDomain(), ctx)[0]?.content ?? '';
  return [...content.matchAll(/file: '([^']+)'/g)].map((match) => match[1] ?? '');
}

/** 止まったときの例外(止まらなければテストの失敗)。 */
function stopped(act: () => unknown): GeneratorPreconditionError {
  try {
    act();
  } catch (error) {
    if (error instanceof GeneratorPreconditionError) return error;
    throw error;
  }
  throw new Error('止まらなかった');
}

describe('Next.js の値: 直書きしていたときと同じパス(製品の根からの相対)', () => {
  it('期待ファイル木: 手書きの操作の本体・Server Action・組み立ての根・保存点の 3 種', () => {
    const files = expectedFiles(context());

    expect(files).toEqual(
      expect.arrayContaining([
        'src/operation/item/tune.ts',
        'src/operation/item/expire.ts',
        'src/app/_actions/container/create.ts',
        'src/composition/item/submit.ts',
        'src/app/_actions/usecase/demo/register.ts',
        'src/composition/usecase/demo/register.ts',
        'src/components/usecase/generated/demo.register-form.tsx',
      ]),
    );
  });

  it('保存点の期待: Server Action・composition・1 画面フォーム(パス順)', () => {
    expect(usecaseExpectations(rpcDomain(), context()).map((file) => file.file)).toEqual([
      'src/app/_actions/usecase/demo/register.ts',
      'src/components/usecase/generated/demo.register-form.tsx',
      'src/composition/usecase/demo/register.ts',
    ]);
  });

  it('免除表: 操作の本体と、クエリの写像(集約のディレクトリの queries.ts)の鍵', () => {
    const table = JSON.parse(lintExceptionsGenerator.generate(rpcDomain(), context())[0]?.content ?? '{}') as Record<string, unknown>;

    expect(Object.keys(table).filter((key) => key !== '$generated')).toEqual(['src/infrastructure/container/queries.ts', 'src/operation/container/create.ts']);
  });
});

describe('別の配置(架空の値): 鍵がその配置の値になり、Next.js の綴りが残らない', () => {
  it('期待ファイル木: ソースの根・操作の本体・入口・組み立ての根・保存点・フォームが配置の値(製品の根からの相対)', () => {
    const files = expectedFiles(context(FOREIGN_LAYOUT));

    expect(files).toEqual(
      expect.arrayContaining([
        'server_code/rules/item__tune.rule.ts',
        'server_code/rules/item__expire.rule.ts',
        'server_code/handlers/ops/container__create.action.ts',
        'server_code/wiring/ops/item__submit.wire.ts',
        'server_code/handlers/saves/demo__register.action.ts',
        'server_code/wiring/saves/demo__register.wire.ts',
        'server_code/ui/forms/demo.register-form.tsx',
      ]),
    );
    // 保存点の hooks(手書き)は、不変条件を持たない保存点には無いので期待に載らない。
    for (const file of files.filter((candidate) => !candidate.startsWith('src/'))) expect(leaksNextjsEntrySpelling(file), file).toBe(false);
  });

  it('保存点の期待も配置の値', () => {
    expect(usecaseExpectations(rpcDomain(), context(FOREIGN_LAYOUT)).map((file) => file.file)).toEqual([
      'server_code/handlers/saves/demo__register.action.ts',
      'server_code/ui/forms/demo.register-form.tsx',
      'server_code/wiring/saves/demo__register.wire.ts',
    ]);
  });

  it('免除表の鍵も配置の値(操作の本体は操作の本体の役割・クエリの写像は基盤の層の役割の置き場)', () => {
    const table = JSON.parse(lintExceptionsGenerator.generate(rpcDomain(), context(FOREIGN_LAYOUT))[0]?.content ?? '{}') as Record<string, unknown>;

    expect(Object.keys(table).filter((key) => key !== '$generated')).toEqual(['server_code/rules/container__create.rule.ts', 'server_code/store/container/repo.ts']);
  });
});

describe('実装の木を持たない製品・配置が役割を解決できない構成', () => {
  it('実装の木を持たない製品(roots.app が null)は、期待ファイルも免除も出さない(置き場が無いのが事実)', () => {
    expect(expectedFiles(context(TEST_LAYOUT, null)).filter((file) => file.includes('/'))).toEqual([]);
    expect(usecaseExpectations(rpcDomain(), context(TEST_LAYOUT, null))).toEqual([]);
    const table = JSON.parse(lintExceptionsGenerator.generate(rpcDomain(), context(TEST_LAYOUT, null))[0]?.content ?? '{}') as Record<string, unknown>;
    expect(Object.keys(table)).toEqual(['$generated']);
  });

  it('実装の木があるのに配置が役割を宣言していなければ、黙って落とさず前提の失敗で止まる(名指すのは配置の定義の検査・出どころの仕様を指す)', () => {
    for (const [name, act] of [
      ['期待ファイル木', () => structureExpectationsGenerator.generate(rpcDomain(), context(EMPTY_LAYOUT))],
      ['保存点の期待', () => usecaseExpectations(rpcDomain(), context(EMPTY_LAYOUT))],
      ['免除表', () => lintExceptionsGenerator.generate(rpcDomain(), context(EMPTY_LAYOUT))],
    ] as const) {
      const finding = stopped(act).findings[0];
      expect(finding?.verifier, name).toBe('配置の定義の検査');
      expect(finding?.counterexample, name).toMatchObject({ declared: 'no' });
    }
    const exceptions = stopped(() => lintExceptionsGenerator.generate(rpcDomain(), context(EMPTY_LAYOUT))).findings[0];
    expect(exceptions?.message).toContain('操作 container.create の本体(ESLint の免除先)');
    expect(exceptions?.location.file).toContain('backend/actions/');
  });
});

/** 層と土台の表の JSON(`framework-structure.json`)を読み戻す。 */
function structureJson(layout: ProductLayout): { layers: { name: string }[]; baseDirs: { root: string; path: string; sdkPackages?: readonly string[] }[]; auxFiles: { layer: string; file: string }[]; foundationPackages?: readonly string[] } {
  return JSON.parse(frameworkStructureJsonSection(GEN_CTX.roots, layout).content);
}

describe('層と土台の表(framework-structure.json / structure-expectations.ts)は、配置が宣言した表の写し', () => {
  it('Next.js の値: 層 6 つ・土台 20 行(宣言順)・補助ファイル 1 つ', () => {
    const json = structureJson(TEST_LAYOUT);

    expect(json.layers.map((layer) => layer.name)).toEqual(['domain', 'operation', 'infrastructure', 'composition', 'components', 'app']);
    expect(json.baseDirs).toHaveLength(20);
    expect(json.baseDirs[0]).toEqual({ root: 'framework', path: 'src/domain/engine', role: expect.any(String), generated: false, vocabularyScan: true, layout: 'flat', perSpec: false, sdkPackages: [] });
    expect(json.baseDirs.find((entry) => entry.path === 'src/infrastructure/supabase')?.sdkPackages).toEqual(['@supabase/*']);
    expect(json.foundationPackages).toEqual(['next', 'react', 'react-dom', 'zod', 'server-only']);
    expect(json.baseDirs.at(-1)?.path).toBe('src/components/usecase/generated');
    expect(json.auxFiles.map((entry) => `${entry.layer}/${entry.file}`)).toEqual(['operation/ports.ts']);
  });

  it('別の配置(架空の値): 層・土台・補助ファイルがその配置の値で写り、Next.js の綴りが残らない(JSON と TypeScript の両方)', () => {
    const json = structureJson(FOREIGN_LAYOUT);
    const ts = structureExpectationsGenerator.generate(rpcDomain(), context(FOREIGN_LAYOUT))[0]?.content ?? '';

    expect(json.layers.map((layer) => layer.name)).toEqual(['domain', 'operation', 'infrastructure', 'composition', 'handlers', 'wiring', 'endpoints', 'ui']);
    expect(json.baseDirs.map((entry) => `${entry.root}:${entry.path}`)).toEqual([
      'framework:rt_code/domain/kernel',
      'product:server_code/domain/built',
      'product:server_code/operation/common',
      'product:server_code/operation/usecase',
      'product:server_code/operation/__tests__',
      'product:server_code/infrastructure/connectors',
      'product:server_code/infrastructure/__tests__',
      'product:server_code/handlers/saves',
      'product:server_code/wiring/saves',
      'product:server_code/wiring/webhooks',
      'product:server_code/endpoints/hooks/in',
      'product:server_code/ui/parts',
      'product:server_code/ui/forms',
    ]);
    expect(json.auxFiles).toEqual([{ layer: 'operation', file: 'iface.ts', role: '操作が宣言する IF' }]);
    expect(ts).toContain("path: 'server_code/ui/forms'");
    expect(leaksNextjsEntrySpelling(JSON.stringify(json))).toBe(false);
    expect(leaksNextjsEntrySpelling(ts.slice(ts.indexOf('export const frameworkLayers')))).toBe(false);
  });
});

describe('保存点の手書きの hooks の置き場: 配置が宣言する土台 operation/usecase の下', () => {
  /** 保存点の最小の形(名前と保存点 ID だけ読まれる)。 */
  const SAVE = { usecase: { name: 'demo' }, plan: { save: { id: 'register' } } } as unknown as BuiltSave;
  const LOCATION = { file: 'docs/specs/frontend/usecases/demo.md' };

  it('Next.js の値: 直書きしていたときと同じパス', () => {
    expect(hooksFilePathOf(SAVE, TEST_LAYOUT, { app: '' }, LOCATION)).toBe('src/operation/usecase/demo/register.ts');
    expect(hooksFilePathOf(SAVE, TEST_LAYOUT, { app: 'app' }, LOCATION)).toBe('app/src/operation/usecase/demo/register.ts');
  });

  it('ソースの根を動かした配置: 土台の置き場がその配置のソースの根の下になる', () => {
    const moved: ProductLayout = { ...TEST_LAYOUT, 'source-root': { ...(TEST_LAYOUT['source-root'] ?? failMissing()), place: () => 'server_code' } };

    expect(hooksFilePathOf(SAVE, moved, { app: '' }, LOCATION)).toBe('server_code/operation/usecase/demo/register.ts');
  });

  it('配置が土台を宣言していなければ、黙って落とさず前提の失敗で止まる(名指すのは配置の定義の検査・出どころの仕様を指す)', () => {
    const source = TEST_LAYOUT['source-root'] ?? failMissing();
    const structure = source.structure ?? failMissing();
    const withoutHooks: ProductLayout = {
      ...TEST_LAYOUT,
      'source-root': { ...source, structure: { ...structure, baseDirs: structure.baseDirs.filter((entry) => !(entry.layer === 'operation' && entry.dir === 'usecase')) } },
    };
    for (const layout of [withoutHooks, EMPTY_LAYOUT]) {
      const finding = stopped(() => hooksFilePathOf(SAVE, layout, { app: '' }, LOCATION)).findings[0];

      expect(finding?.verifier).toBe('配置の定義の検査');
      expect(finding?.message).toContain('手書きの hooks の置き場を、置き場の配置が宣言する土台の表から決められません');
      expect(finding?.location.file).toBe(LOCATION.file);
      expect(stopped(() => hooksModuleOf(SAVE, layout, LOCATION)).findings[0]?.verifier).toBe('配置の定義の検査');
    }
  });

  it('生成物の本文が import する hooks の指定は、置き場と同じ土台から引く(ソースの根の別名 + ソースの根からの相対)', () => {
    const moved: ProductLayout = { ...TEST_LAYOUT, 'source-root': { ...(TEST_LAYOUT['source-root'] ?? failMissing()), place: () => 'server_code', module: () => '~srv' } };

    expect(hooksModuleOf(SAVE, TEST_LAYOUT, LOCATION)).toBe('@/operation/usecase/demo/register');
    expect(hooksModuleOf(SAVE, moved, LOCATION)).toBe('~srv/operation/usecase/demo/register');
  });
});

/** 配置の元の値が足りないテストの書き間違いを知らせる。 */
function failMissing(): never {
  throw new Error('配置に必要な宣言がありません');
}
