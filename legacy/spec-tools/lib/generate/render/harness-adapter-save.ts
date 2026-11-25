/**
 * 保存点(ユースケース)の一致の証明の**アダプタ**(生成物)の本文。
 *
 * 生成テストと閉世界の見張りテストが呼ぶ住所(`composition/__tests__/eq-save-{world,expect}.ts`)に
 * 置く配線であり、中身は「製品の生成物と口(`HarnessPorts`)を、実行時パッケージのハーネス本体に
 * 渡す」だけである(束 ①-d 手 2。設計メモ §9-12)。
 *
 * **アプリの語彙は 1 語も無い**。規約どおりファイル I/O はしない純粋関数。
 */

import { SAVE_ADAPTER_TO_BASE_ADAPTER_DIR } from '../../model/product/layout-body-imports.js';
import type { BodyModules } from '../body-modules.js';

/** 基盤の層のアダプタ(`eq-world` ・`harness-ports`)への相対(契約は `layout-body-imports.ts`。配置が置き場の根を変えると本文が食い違うので、定義の検査が止める)。 */
const BASE_ADAPTER_DIR = SAVE_ADAPTER_TO_BASE_ADAPTER_DIR;

/**
 * `eq-save-world.ts`(world の使い方のアダプタ)の本文。
 *
 * world の作り方は単発の操作と**同じ 1 本**なので、口を渡すアダプタも 1 つだけである ——
 * ここはその再輸出と、保存点だけの口(実行する相手の決め方)の素通しを持つ。
 */
export const EQ_SAVE_WORLD_ADAPTER: readonly string[] = [
  `export type { BuiltEqWorld } from '${BASE_ADAPTER_DIR}/eq-world';`,
  `export { createEqWorld, resetEqWorld } from '${BASE_ADAPTER_DIR}/eq-world';`,
  "export type { EqSaveSelection, EqSaveSubject } from '@kaninabe/runtime/testing/save/world';",
  "export { subjectOfSave, targetsOf } from '@kaninabe/runtime/testing/save/world';",
];

/**
 * `eq-save-expect.ts`(表明のアダプタ)の本文。
 *
 * @param modules 本文が import する先の解決(置き場の配置が決める)
 * @returns 本文の行
 */
export function eqSaveExpectAdapter(modules: BodyModules): readonly string[] {
  return [
    "import type { SaveHarness } from '@kaninabe/runtime/testing/save/expect';",
    'import {',
    '  expectSaveDecisions as expectSaveDecisionsWith,',
    '  expectSaveWorldBuilt as expectSaveWorldBuiltWith,',
    '  expectSaveWrites as expectSaveWritesWith,',
    "} from '@kaninabe/runtime/testing/save/expect';",
    "import { expectSaveResendEdited as expectSaveResendEditedWith } from '@kaninabe/runtime/testing/save/resend';",
    "import { expectSaveResendRace as expectSaveResendRaceWith } from '@kaninabe/runtime/testing/save/resend-race';",
    `import type { EqSaveWorld } from '${modules.generated('eq-worlds')}';`,
    `import { usecasePlans } from '${modules.generated('usecase-plans')}';`,
    `import { invariantOfMessage } from '${modules.generated('constraint-invariants')}';`,
    `import { runtimeBindings } from '${modules.generated('runtime-bindings')}';`,
    `import { SESSION_FIELDS } from '${modules.generated('session-profile')}';`,
    `import { HARNESS_PORTS } from '${BASE_ADAPTER_DIR}/harness-ports';`,
    "import type { BuiltEqWorld } from './eq-save-world';",
    '',
    "export { enumerateDecisions, enumerateWrites } from '@kaninabe/runtime/testing/save/expect';",
    '',
    '/** ハーネスに渡す口と宣言(この製品の答え)。 */',
    'const HARNESS: SaveHarness = {',
    '  ports: HARNESS_PORTS,',
    '  plans: usecasePlans,',
    '  roleTables: runtimeBindings.roleTables,',
    '  sessionFields: SESSION_FIELDS,',
    '  invariantOfMessage,',
    '};',
    '',
    '/**',
    ' * 口と宣言の束(**閉世界の見張りテストが期待を計算するために借りる**)。',
    ' *',
    ' * 見張りテストは「実行する組み合わせの数」と「許可される組み合わせが 1 つ以上ある」ことを数えるために',
    ' * 期待そのもの(`saveOracle`)を呼ぶので、同じ宣言をもう 1 か所で組み立てないようにここから配る。',
    ' */',
    'export const saveHarness: SaveHarness = HARNESS;',
    '',
    '/**',
    ' * その保存点の判定の全組み合わせで、実行器の判定と複合 RPC の結末が一致することを確かめる。',
    ' *',
    ' * @param world その保存点の設計図(生成物)',
    ' * @param built 実 DB に作った world',
    ' * @returns 確かめ終わるまで',
    ' */',
    'export function expectSaveDecisions(world: EqSaveWorld, built: BuiltEqWorld): Promise<void> {',
    '  return expectSaveDecisionsWith(world, built, HARNESS);',
    '}',
    '',
    '/**',
    ' * 許可される組み合わせの上で、書き込み経路の全組み合わせが宣言どおりの行を作ることを確かめる。',
    ' *',
    ' * @param world その保存点の設計図(生成物)',
    ' * @param built 実 DB に作った world',
    ' * @returns 確かめ終わるまで',
    ' */',
    'export function expectSaveWrites(world: EqSaveWorld, built: BuiltEqWorld): Promise<void> {',
    '  return expectSaveWritesWith(world, built, HARNESS);',
    '}',
    '',
    '/**',
    ' * world が設計図どおりに作られたことを確かめる(検査そのものが空振りしていないことの検算)。',
    ' *',
    ' * @param world その保存点の設計図',
    ' * @param built 実 DB に作った world',
    ' */',
    'export function expectSaveWorldBuilt(world: EqSaveWorld, built: BuiltEqWorld): void {',
    '  expectSaveWorldBuiltWith(world, built, HARNESS);',
    '}',
    '',
    '/**',
    ' * 同じ鍵で入力を 1 欄変えた押し直しが resend_input_mismatch で断られ、行が 1 回目のままであることを確かめる',
    ' * (再送で既存の行を返す保存点 = 複合の作成だけ。点検 21 回目 A21-1)。',
    ' *',
    ' * @param world その保存点の設計図(生成物)',
    ' * @param built 実 DB に作った world',
    ' * @returns 確かめ終わるまで',
    ' */',
    'export function expectSaveResendEdited(world: EqSaveWorld, built: BuiltEqWorld): Promise<void> {',
    '  return expectSaveResendEditedWith(world, built, HARNESS);',
    '}',
    '',
    '/**',
    ' * 1 回目がコミットする前に届いた同じ鍵の押し直しが、同じ入力なら 1 回目の行を返し、変えた入力なら resend_input_mismatch で',
    ' * 断られることを確かめる(1 本目を開いたまま 2 本目を送る交錯。点検 22 回目 A22-1)。',
    ' *',
    ' * @param world その保存点の設計図(生成物)',
    ' * @param built 実 DB に作った world',
    ' * @returns 確かめ終わるまで',
    ' */',
    'export function expectSaveResendRace(world: EqSaveWorld, built: BuiltEqWorld): Promise<void> {',
    '  return expectSaveResendRaceWith(world, built, HARNESS);',
    '}',
  ];
}
