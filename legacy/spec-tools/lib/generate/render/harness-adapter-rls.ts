/**
 * RLS の挙動テストの**アダプタ**(生成物)の本文。
 *
 * 生成テストが呼ぶ住所(`__tests__/rls-{world,expect}.ts`)に置く配線であり、中身は
 * 「製品の生成物と口(`HarnessPorts`)を、実行時パッケージのハーネス本体に渡す」だけである
 * (束 ①-d 手 2。設計メモ §9-12)。
 *
 * **アプリの語彙は 1 語も無い** —— 集約名・ロール名・列名は設計図(生成物)が運ぶ。
 * 規約どおりファイル I/O はしない純粋関数(scripts-code-quality.md)。
 */

import type { BodyModules } from '../body-modules.js';

/**
 * `rls-world.ts`(world の作り方のアダプタ)の本文。
 *
 * @param modules 本文が import する先の解決(置き場の配置が決める)
 * @returns 本文の行
 */
export function rlsWorldAdapter(modules: BodyModules): readonly string[] {
  return [
    "import type { BuiltRlsWorld, ReadResult } from '@kaninabe/runtime/testing/rls/world';",
    'import {',
    '  createRlsWorld as buildRlsWorld,',
    '  readAsActor as readAsActorWith,',
    '  resetRlsWorld as resetRlsWorldWith,',
    "} from '@kaninabe/runtime/testing/rls/world';",
    `import type { RlsWorld } from '${modules.generated('rls-worlds')}';`,
    "import { HARNESS_PORTS } from './harness-ports';",
    '',
    "export type { BuiltRlsActor, BuiltRlsRow, BuiltRlsWorld, ReadResult } from '@kaninabe/runtime/testing/rls/world';",
    '',
    '/**',
    ' * 設計図どおりの world を実 DB に作る。',
    ' *',
    ' * @param world 表 1 枚ぶんの設計図(生成物)',
    ' * @returns 行と実行者の実体(id・トークン・セッション属性)',
    ' */',
    'export function createRlsWorld(world: RlsWorld): Promise<BuiltRlsWorld> {',
    '  return buildRlsWorld(world, HARNESS_PORTS);',
    '}',
    '',
    '/**',
    ' * world を片付ける(次のテストファイルが同じ実 DB を使う)。',
    ' *',
    ' * @returns 片付け終わるまで',
    ' */',
    'export function resetRlsWorld(): Promise<void> {',
    '  return resetRlsWorldWith(HARNESS_PORTS);',
    '}',
    '',
    '/**',
    ' * その実行者として `api` のビューを読む(画面と同じ経路)。',
    ' *',
    ' * @param world 設計図',
    ' * @param built 実 DB の world',
    ' * @param actorKey 実行者の名前',
    ' * @returns 拒否されたか、見えた id',
    ' */',
    'export function readAsActor(',
    '  world: RlsWorld,',
    '  built: BuiltRlsWorld,',
    '  actorKey: string,',
    '): Promise<ReadResult> {',
    '  return readAsActorWith(world, built, actorKey, HARNESS_PORTS);',
    '}',
  ];
}

/**
 * `rls-expect.ts`(表明のアダプタ)の本文。
 *
 * @param modules 本文が import する先の解決(置き場の配置が決める)
 * @returns 本文の行
 */
export function rlsExpectAdapter(modules: BodyModules): readonly string[] {
  return [
    "import type { RlsHarness } from '@kaninabe/runtime/testing/rls/expect';",
    'import {',
    '  expectTenantBoundary as expectTenantBoundaryWith,',
    '  expectVisibleRows as expectVisibleRowsWith,',
    '  expectWorldBuilt as expectWorldBuiltWith,',
    "} from '@kaninabe/runtime/testing/rls/expect';",
    `import type { RlsWorld } from '${modules.generated('rls-worlds')}';`,
    `import { rlsRoles } from '${modules.generated('rls-worlds')}';`,
    "import type { BuiltRlsWorld } from './rls-world';",
    "import { HARNESS_PORTS } from './harness-ports';",
    '',
    '/** ハーネスに渡す口とロールの根拠(この製品の答え)。 */',
    'const HARNESS: RlsHarness = { ports: HARNESS_PORTS, roles: rlsRoles };',
    '',
    '/**',
    ' * その実行者に「宣言どおりの行だけ」が返ることを確かめる。',
    ' *',
    ' * @param world 設計図',
    ' * @param built 実 DB の world',
    ' * @param actorKey 実行者の名前',
    ' * @returns 確かめ終わるまで',
    ' */',
    'export function expectVisibleRows(',
    '  world: RlsWorld,',
    '  built: BuiltRlsWorld,',
    '  actorKey: string,',
    '): Promise<void> {',
    '  return expectVisibleRowsWith(world, built, actorKey, HARNESS);',
    '}',
    '',
    '/**',
    ' * 実行者の属性で狭める境界(テナント)を越えた行が返らないことを確かめる。',
    ' *',
    ' * @param world 設計図',
    ' * @param built 実 DB の world',
    ' * @param actorField 境界に使う実行者の欄(`filters` の右辺 `actor.{欄}`)',
    ' * @returns 確かめ終わるまで',
    ' */',
    'export function expectTenantBoundary(',
    '  world: RlsWorld,',
    '  built: BuiltRlsWorld,',
    '  actorField: string,',
    '): Promise<void> {',
    '  return expectTenantBoundaryWith(world, built, actorField, HARNESS);',
    '}',
    '',
    '/**',
    ' * world が設計図どおりに作られたことを確かめる(検査そのものが空振りしていないことの検算)。',
    ' *',
    ' * @param world 設計図',
    ' * @param built 実 DB の world',
    ' */',
    'export function expectWorldBuilt(world: RlsWorld, built: BuiltRlsWorld): void {',
    '  expectWorldBuiltWith(world, built);',
    '}',
  ];
}
