/**
 * engine ⇔ RPC の一致の証明の**アダプタ**(生成物)の本文。
 *
 * 生成テストと閉世界の見張りテストが呼ぶ住所(`__tests__/eq-{world,expect}.ts`)に置く配線であり、
 * 中身は「製品の生成物と口(`HarnessPorts`)を、実行時パッケージのハーネス本体に渡す」だけである
 * (束 ①-d 手 2。設計メモ §9-12)。
 *
 * **アプリの語彙は 1 語も無い**。規約どおりファイル I/O はしない純粋関数。
 */

import type { BodyModules } from '../body-modules.js';

/** `eq-world.ts`(world の作り方のアダプタ)の本文。 */
export const EQ_WORLD_ADAPTER: readonly string[] = [
  "import type { Client as PgClient } from 'pg';",
  "import type { BuiltEqWorld, EqBuildableWorld } from '@kaninabe/runtime/testing/equivalence/world';",
  'import {',
  '  createEqWorld as buildEqWorld,',
  '  eqPg as eqPgWith,',
  '  resetEqWorld as resetEqWorldWith,',
  "} from '@kaninabe/runtime/testing/equivalence/world';",
  "import { HARNESS_PORTS } from './harness-ports';",
  '',
  'export type {',
  '  BuiltEqRow,',
  '  BuiltEqWorld,',
  '  EqBuildableWorld,',
  '  EqSelection,',
  '  EqSubject,',
  "} from '@kaninabe/runtime/testing/equivalence/world';",
  "export { placementsOf, subjectOf } from '@kaninabe/runtime/testing/equivalence/world';",
  '',
  '/**',
  ' * このテストファイル 1 本のあいだ開いたままにする接続を得る(無ければ開く)。',
  ' *',
  ' * @returns 接続済みクライアント',
  ' */',
  'export function eqPg(): Promise<PgClient> {',
  '  return eqPgWith(HARNESS_PORTS);',
  '}',
  '',
  '/**',
  ' * 設計図どおりの world を実 DB に作る。',
  ' *',
  ' * @param world 集約 1 つぶんの設計図(生成物)',
  ' * @returns 行と実行者の実体(id と読み直した値)',
  ' */',
  'export function createEqWorld(world: EqBuildableWorld): Promise<BuiltEqWorld> {',
  '  return buildEqWorld(world, HARNESS_PORTS);',
  '}',
  '',
  '/**',
  ' * world を片付け、開いたままの接続も後始末する(次のテストファイルが同じ実 DB を使う)。',
  ' *',
  ' * @returns 片付け終わるまで',
  ' */',
  'export function resetEqWorld(): Promise<void> {',
  '  return resetEqWorldWith(HARNESS_PORTS);',
  '}',
];

/**
 * `eq-expect.ts`(表明のアダプタ)の本文。
 *
 * @param modules 本文が import する先の解決(置き場の配置が決める)
 * @returns 本文の行
 */
export function eqExpectAdapter(modules: BodyModules): readonly string[] {
  return [
    "import type { EqHarness } from '@kaninabe/runtime/testing/equivalence/expect';",
    'import {',
    '  expectSameDecisions as expectSameDecisionsWith,',
    '  expectWorldBuilt as expectWorldBuiltWith,',
    "} from '@kaninabe/runtime/testing/equivalence/expect';",
    "import { expectResendAlreadySaved as expectResendAlreadySavedWith, expectResendReturnsSameRow as expectResendReturnsSameRowWith } from '@kaninabe/runtime/testing/equivalence/resend';",
    `import type { EqWorld } from '${modules.generated('eq-worlds')}';`,
    `import { operationPlans } from '${modules.generated('operation-plans')}';`,
    "import type { BuiltEqWorld } from './eq-world';",
    "import { HARNESS_PORTS } from './harness-ports';",
    '',
    "export { enumerate } from '@kaninabe/runtime/testing/equivalence/expect';",
    '',
    '/** ハーネスに渡す口と実行計画(この製品の答え)。 */',
    'const HARNESS: EqHarness = { ports: HARNESS_PORTS, plans: operationPlans };',
    '',
    '/**',
    ' * その操作の全組み合わせで、engine の判定と RPC の結末が一致することを確かめる。',
    ' *',
    ' * @param world 集約 1 つぶんの設計図(生成物)',
    ' * @param built 実 DB に作った world',
    ' * @param op 操作 ID',
    ' * @returns 確かめ終わるまで',
    ' */',
    'export function expectSameDecisions(world: EqWorld, built: BuiltEqWorld, op: string): Promise<void> {',
    '  return expectSameDecisionsWith(world, built, op, HARNESS);',
    '}',
    '',
    '/**',
    ' * world が設計図どおりに作られたことを確かめる(検査そのものが空振りしていないことの検算)。',
    ' *',
    ' * @param world 集約 1 つぶんの設計図',
    ' * @param built 実 DB に作った world',
    ' */',
    'export function expectWorldBuilt(world: EqWorld, built: BuiltEqWorld): void {',
    '  expectWorldBuiltWith(world, built);',
    '}',
    '',
    '/**',
    ' * 作成の送り直し(同じ入力・同じ冪等キー)は 1 回目の行を返し、行を増やさないことを確かめる(点検 20 回目 B20-1)。',
    ' *',
    ' * @param world 集約 1 つぶんの設計図(生成物)',
    ' * @param built 実 DB に作った world',
    ' * @param op 操作 ID(作成)',
    ' * @returns 確かめ終わるまで',
    ' */',
    'export function expectResendReturnsSameRow(world: EqWorld, built: BuiltEqWorld, op: string): Promise<void> {',
    '  return expectResendReturnsSameRowWith(world, built, op, HARNESS);',
    '}',
    '',
    '/**',
    ' * 再送で既存の行を返さない表の作成の送り直し(同じ入力・同じ冪等キー)が、行を増やさず、画面に「既に保存されている」の種類の',
    ' * 文言を出すことを確かめる(resend.returns_existing: false)。',
    ' *',
    ' * @param world 集約 1 つぶんの設計図(生成物)',
    ' * @param built 実 DB に作った world',
    ' * @param op 操作 ID(作成)',
    ' * @returns 確かめ終わるまで',
    ' */',
    'export function expectResendAlreadySaved(world: EqWorld, built: BuiltEqWorld, op: string): Promise<void> {',
    '  return expectResendAlreadySavedWith(world, built, op, HARNESS);',
    '}',
  ];
}
