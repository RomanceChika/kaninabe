/**
 * 実行計画・入力スキーマ・app 側の生成物(束⑯c-2)の規約網羅テスト。
 * 対象の要求: usecase-spec-writing.md §Y10 の考え方 / §app 側に生成されるもの。
 *   - 計画は「`permit` が要る値の供給元」を運ぶ(予測 / 外部 / 実行者 / 入力 / 判断時刻)
 *   - 入力スキーマは制約を再宣言せず、生成 zod から `.pick` で借りる
 *   - Server Action / composition / 1 画面フォームは全部生成され、手書きは hooks だけ
 *   - 参照(`ref`)の欄は入力欄を出さず、画面が `initial` で渡す
 */

import { describe, expect, it } from 'vitest';
import { usecasePlansGenerator } from '../../../../lib/generate/render/code-usecase-plans.js';
import { usecaseInputsGenerator } from '../../../../lib/generate/render/code-usecase-inputs.js';
import { usecaseAppGenerator } from '../../../../lib/generate/render/code-usecase-app.js';
import { usecaseFormGenerator } from '../../../../lib/generate/render/code-usecase-form.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../../helpers/usecase-rpc-fixture.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { UsecaseSpec } from '../../../../lib/model/usecase/types.js';

/** container.create → item.create → item.submit の 1 保存点。 */
function registerUsecase(): UsecaseSpec {
  return usecaseSpec({
    name: 'demo',
    saves: [
      usecaseSave(
        'register',
        [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')],
        { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' },
      ),
    ],
  });
}

/** container.create → item.create(繰り返し)の 1 保存点。 */
function repeatUsecase(): UsecaseSpec {
  return usecaseSpec({
    name: 'demo',
    saves: [
      usecaseSave('register', [usecaseStep('container.create'), usecaseStep('item.create', { repeat: true })], {
        migration: '20260909000050_usecase_demo_register.sql',
        name: 'demo',
      }),
    ],
  });
}

/** 生成器に渡す文脈。 */
function context(usecase: UsecaseSpec): GenerateContext {
  return {
    ...GEN_CTX,
    actions: rpcActions(),
    dataTables: rpcDataTables(),
    usecases: { available: true, usecases: [usecase] },
  };
}

describe('code-usecase-plans', () => {
  it('保存点の鍵で引ける計画を 1 ファイルに生成する', () => {
    const sections = usecasePlansGenerator.generate(rpcDomain(), context(registerUsecase()));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('app/src/domain/generated/usecase-plans.ts');
    expect(sections[0]?.wholeFile).toBe(true);
    expect(sections[0]?.content).toContain("'demo.register': {");
  });

  it('`permit` の材料は仕様から解決される(規則表・遷移表・予測した状態・成功値)', () => {
    const content = usecasePlansGenerator.generate(rpcDomain(), context(registerUsecase()))[0]?.content ?? '';

    // 規則表と遷移表は生成物の識別子として持つ(名前で引き直さない)。
    expect(content).toContain("import { containerCreateRules } from './container.creates';");
    expect(content).toContain("import { itemMachine } from './item.transitions';");
    expect(content).toContain('createRules: containerCreateRules,');
    expect(content).toContain('machine: itemMachine,');
    // 遷移元は仕様からの予測(作成の initial)。
    expect(content).toContain("kind: 'predicted'");
    expect(content).toContain("value: 'draft'");
    // 成功値は「最初の手順の集約」で、この保存点はそれを作るので冪等キーを返す。
    expect(content).toContain("idFrom: {\n        kind: 'idempotency',");
  });

  it('入力スキーマは生成 zod から借りるだけで、制約を再宣言しない', () => {
    const content = usecaseInputsGenerator.generate(rpcDomain(), context(registerUsecase()))[0]?.content ?? '';

    expect(content).toContain('containerInputSchema.pick({ title: true })');
    expect(content).toContain('itemInputSchema.pick({ name: true, size: true })');
    // 入力を 1 つも持たない手順(対象の id が前の手順の結果から決まる遷移)は鍵ごと現れない。
    expect(content).not.toContain("'item.submit':");
  });

  // 点検 25 回目 O25-2 / B の X3: 保存点の入力は作成の入力と同じく閉世界。手順の要素も保存点全体も z.strictObject で、開いた object を作らない。
  it('保存点の入力は手順の要素も全体も z.strictObject で閉じ、開いた object(z.object)を作らない', () => {
    const content = usecaseInputsGenerator.generate(rpcDomain(), context(registerUsecase()))[0]?.content ?? '';

    expect(content).toContain("'container.create': z.strictObject({ ...containerInputSchema.pick({ title: true }).shape })");
    expect(content).toContain('z.strictObject({ ...itemInputSchema.pick({ name: true, size: true }).shape })');
    expect(content).toMatch(/export const demoRegisterInputSchema = z\.strictObject\(\{/u);
    expect(content).not.toMatch(/z\.object\(|\.extend\(|\.passthrough\(|\.loose\(/u);
  });

  it('繰り返す手順の入力は配列になる', () => {
    const content = usecaseInputsGenerator.generate(rpcDomain(), context(repeatUsecase()))[0]?.content ?? '';

    expect(content).toContain("'item.create': z.array(demoRegisterStepSchemas['item.create'])");
  });

  it('Server Action と composition を保存点ごとに生成する(手書きは hooks だけ)', () => {
    const sections = usecaseAppGenerator.generate(rpcDomain(), context(registerUsecase()));

    expect(sections.map((section) => section.file)).toEqual([
      'app/src/app/_actions/usecase/demo/register.ts',
      'app/src/composition/usecase/demo/register.ts',
    ]);
    const action = sections[0]?.content ?? '';
    expect(action.startsWith("'use server';")).toBe(true);
    expect(action).toContain('export async function demoRegisterAction(input: unknown, intent?: unknown)');
    // Server Action は operation を直に見ない(層の境界)。
    expect(action).not.toContain('@/operation/');
    // 適用が要る不変条件が無い保存点は hooks を持たないので、配線は空の表を渡す。
    expect(sections[1]?.content).toContain('runPlanOperation(usecasePlans[\'demo.register\'], {})');
  });

  it('1 画面フォームは識別子の欄を出さず、画面が initial で渡す', () => {
    const sections = usecaseFormGenerator.generate(rpcDomain(), context(registerUsecase()));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('app/src/components/usecase/generated/demo.register-form.tsx');
    const content = sections[0]?.content ?? '';
    // 値の欄は入力欄として並ぶ。
    expect(content).toContain('.item_create.name`');
    // 入力を 1 つも持たない手順は欄そのものが無い。
    expect(content).not.toContain('.item_submit.');
    // 送信の最後はサーバーと同じ保存点のスキーマで検証する。
    expect(content).toContain('demoRegisterInputSchema.safeParse(');
    // 画面が initial で渡す欄の無い保存点は intentOf を渡さない(既定 = いつも同じ意図。点検 22 回目 B22-1)。
    // 渡す欄がある形(intentOfFields(initial, [...]))は製品の保存点のフォームの生成物の鮮度(generate:check)が見る。
    expect(content).not.toContain('intentOf');
  });

  it('繰り返す手順には行の追加・削除が付く', () => {
    const content = usecaseFormGenerator.generate(rpcDomain(), context(repeatUsecase()))[0]?.content ?? '';

    expect(content).toContain('.item_create.add`');
    expect(content).toContain('.item_create.remove`');
  });
});
