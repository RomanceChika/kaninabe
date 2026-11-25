/**
 * アプリの枠の後段 Next.js の、生成テストの置き場の値(役割 `operation-test` ・`compute-example-test` ・`eq-test` ・`eq-save-test` ・`rls-test` ・
 * `harness-adapter` ・`save-harness-adapter` ・`cron-route-test`。部品化 ③-c3)のテスト。
 *
 * 固定するのは 4 点 —— ①置き場が、直書きしていたときと**同じパス**(生成物がバイト同一の根拠。置き場は 1 か所に移っただけ)②持ち主の生成器が実在の生成器の ID と一致する
 * ③逆引きを持つ 3 種(実 DB で実行する)が置き場 → 逆引きで同じキーに戻り、他の種類のファイルを拾わない ④8 役割の置き場が互いに衝突しない(同じキーを
 * 2 つの生成器が取る・手書きと生成が混ざる、を契約の衝突の検査が見つけない)。
 */

import { describe, expect, it } from 'vitest';
import { actionComputeExampleCasesGenerator } from '../../../../lib/generate/render/action-compute-example-cases.js';
import { computeExamplesGenerator } from '../../../../lib/generate/render/code-compute-examples.js';
import { eqSaveTestsGenerator } from '../../../../lib/generate/render/code-eq-save-tests.js';
import { equivalenceTestsGenerator } from '../../../../lib/generate/render/code-equivalence-tests.js';
import { harnessAdaptersGenerator } from '../../../../lib/generate/render/code-harness-adapters.js';
import { operationTestsGenerator } from '../../../../lib/generate/render/code-operation-tests.js';
import { rlsBehaviourTestsGenerator } from '../../../../lib/generate/render/code-rls-behaviour-tests.js';
import { layoutClaimProblems } from '../../../../lib/model/product/layout-claims.js';
import type { LayoutClaim } from '../../../../lib/model/product/layout-claims.js';
import { layoutDefinitionProblems } from '../../../../lib/model/product/layout-definition.js';
import { layoutKeyFits, layoutPath, layoutRoundTrips, layoutScan } from '../../../../lib/model/product/layout.js';
import type { LayoutRole } from '../../../../lib/model/product/layout.js';
import { NEXTJS_LAYOUT } from '../../../../lib/targets/nextjs/layout.js';
import { cronRouteTestsGenerator } from '../../../../lib/targets/vercel/generate/code-cron-route-tests.js';
import { FOREIGN_BODY_COMPATIBLE_LAYOUT, FOREIGN_LAYOUT } from '../../../helpers/platform.js';

/** 生成テストの置き場の 8 役割。 */
const TEST_ROLES: readonly LayoutRole[] = [
  'operation-test',
  'compute-example-test',
  'eq-test',
  'eq-save-test',
  'rls-test',
  'harness-adapter',
  'save-harness-adapter',
  'cron-route-test',
];

/** 実 DB で実行する、逆引きを持つ 3 種。 */
const DB_ROLES = ['eq-test', 'eq-save-test', 'rls-test'] as const;

describe('NEXTJS_LAYOUT: 生成テストの置き場', () => {
  it('置き場は、直書きしていたときと同じパス(基準は製品の根 app の下の src)', () => {
    const at = (role: LayoutRole, key?: string): string | null => layoutPath(NEXTJS_LAYOUT, 'app', role, key);
    expect(at('operation-test', 'widget.send')).toBe('app/src/operation/__tests__/generated/widget/send.test.ts');
    expect(at('compute-example-test', 'feeOf')).toBe('app/src/operation/__tests__/generated/computes/feeOf.examples.test.ts');
    expect(at('eq-test', 'shelf')).toBe('app/src/infrastructure/__tests__/generated/equivalence/shelf.eq.test.ts');
    expect(at('eq-save-test', 'demo')).toBe('app/src/composition/__tests__/generated/equivalence/demo.uc.eq.test.ts');
    expect(at('rls-test', 'shelves')).toBe('app/src/infrastructure/__tests__/generated/rls/shelves.rls.test.ts');
    expect(at('harness-adapter', 'rls-world')).toBe('app/src/infrastructure/__tests__/rls-world.ts');
    expect(at('save-harness-adapter', 'eq-save-expect')).toBe('app/src/composition/__tests__/eq-save-expect.ts');
    expect(at('cron-route-test')).toBe('app/src/app/api/__tests__/generated/cron-routes.test.ts');
  });

  it('キーの形: 操作 ID は {集約}.{イベント} の 2 語・仕様の名前は区切りと空白を含まない・キーを持たない役割はキー無し', () => {
    for (const bad of ['widget', 'widget.', '.send', 'a.b.c', 'a b.c', 'a/b.c', '']) expect(layoutKeyFits(NEXTJS_LAYOUT, 'operation-test', bad), bad).toBe(false);
    expect(layoutKeyFits(NEXTJS_LAYOUT, 'operation-test', undefined)).toBe(false);
    expect(layoutKeyFits(NEXTJS_LAYOUT, 'operation-test', 'entry_participant.link')).toBe(true);
    for (const role of ['compute-example-test', 'eq-test', 'eq-save-test', 'rls-test', 'harness-adapter', 'save-harness-adapter'] as const) {
      expect(layoutKeyFits(NEXTJS_LAYOUT, role, 'a.b'), role).toBe(true);
      for (const bad of ['', 'a/b', 'a b']) expect(layoutKeyFits(NEXTJS_LAYOUT, role, bad), `${role}:${bad}`).toBe(false);
    }
    expect(layoutKeyFits(NEXTJS_LAYOUT, 'cron-route-test', undefined)).toBe(true);
    expect(layoutKeyFits(NEXTJS_LAYOUT, 'cron-route-test', 'x')).toBe(false);
  });

  it('持ち主の生成器は、実在の生成器の ID と一致する(食い違えば赤)・書くのは持ち主だけ・生成物', () => {
    const owners = (role: LayoutRole): string[] =>
      (NEXTJS_LAYOUT[role]?.owners ?? []).map((owner) => (owner.kind === 'generator' ? owner.id : owner.kind));
    expect(owners('operation-test')).toEqual([operationTestsGenerator.id]);
    expect(owners('compute-example-test')).toEqual([computeExamplesGenerator.id]);
    expect(owners('eq-test')).toEqual([equivalenceTestsGenerator.id]);
    expect(owners('eq-save-test')).toEqual([eqSaveTestsGenerator.id]);
    expect(owners('rls-test')).toEqual([rlsBehaviourTestsGenerator.id]);
    expect(owners('harness-adapter')).toEqual([harnessAdaptersGenerator.id]);
    expect(owners('save-harness-adapter')).toEqual([harnessAdaptersGenerator.id]);
    expect(owners('cron-route-test')).toEqual([cronRouteTestsGenerator.id]);
    // test_cases の生成ブロックを書く生成器は、仕様のファイルへ書く側で、この置き場の持ち主ではない(置き場を読むだけ)。
    expect(actionComputeExampleCasesGenerator.id).not.toBe(computeExamplesGenerator.id);
    for (const role of TEST_ROLES) {
      expect(NEXTJS_LAYOUT[role]?.origin, role).toBe('generated');
      expect(NEXTJS_LAYOUT[role]?.access.writers, role).toEqual(owners(role));
    }
  });

  it('配置そのものの契約を満たす(Next.js の値・架空の値の両方。下限 1・基準・逆引きの往復)', () => {
    expect(layoutDefinitionProblems(NEXTJS_LAYOUT)).toEqual([]);
    expect(layoutDefinitionProblems(FOREIGN_BODY_COMPATIBLE_LAYOUT)).toEqual([]);
  });

  it('実 DB で実行する 3 種は逆引きを持ち、置き場 → 逆引きで同じキーに戻り、他の種類のファイルは拾わない', () => {
    for (const layout of [NEXTJS_LAYOUT, FOREIGN_LAYOUT]) {
      for (const role of [...DB_ROLES, 'compute-example-test' as const]) {
        expect(layoutRoundTrips(layout, role, 'sample_name'), role).toBe(true);
        expect(layoutScan(layout, 'app', role), role).not.toBeNull();
      }
    }
    const eq = layoutScan(NEXTJS_LAYOUT, 'app', 'eq-test');
    expect(eq?.dir).toBe('app/src/infrastructure/__tests__/generated/equivalence');
    expect(eq?.keyOf('shelf.eq.test.ts')).toBe('shelf');
    expect(eq?.keyOf('shelf.uc.eq.test.ts')).toBe('shelf.uc');
    expect(eq?.keyOf('shelf.rls.test.ts')).toBeNull();
    expect(eq?.keyOf('sub/shelf.eq.test.ts')).toBeNull();
    expect(eq?.keyOf('.eq.test.ts')).toBeNull();
    const rls = layoutScan(NEXTJS_LAYOUT, 'app', 'rls-test');
    expect(rls?.dir).toBe('app/src/infrastructure/__tests__/generated/rls');
    expect(rls?.keyOf('shelves.rls.test.ts')).toBe('shelves');
    const save = layoutScan(NEXTJS_LAYOUT, 'app', 'eq-save-test');
    expect(save?.dir).toBe('app/src/composition/__tests__/generated/equivalence');
    expect(save?.keyOf('demo.uc.eq.test.ts')).toBe('demo');
    expect(layoutScan(NEXTJS_LAYOUT, 'app', 'compute-example-test')?.keyOf('feeOf.examples.test.ts')).toBe('feeOf');
    // 逆引きを持たない役割は走査の根を持たない。
    for (const role of ['operation-test', 'harness-adapter', 'save-harness-adapter', 'cron-route-test'] as const) expect(NEXTJS_LAYOUT[role]?.classify, role).toBeUndefined();
  });

  it('8 役割の置き場は互いに衝突しない(同じ名前のキーを別の種類の生成器が取っても、別の置き場になる)', () => {
    const key = (role: LayoutRole, value: string): LayoutClaim => ({ role, key: value, owner: NEXTJS_LAYOUT[role]?.access.writers[0] ?? '', source: `${role}:${value}` });
    const claims: LayoutClaim[] = [
      key('operation-test', 'shelf.send'),
      key('compute-example-test', 'shelf'),
      key('eq-test', 'shelf'),
      key('eq-save-test', 'shelf'),
      key('rls-test', 'shelf'),
      key('harness-adapter', 'eq-world'),
      key('save-harness-adapter', 'eq-world'),
      { role: 'cron-route-test', owner: cronRouteTestsGenerator.id, source: 'cron' },
    ];
    for (const layout of [NEXTJS_LAYOUT, FOREIGN_LAYOUT]) expect(layoutClaimProblems(layout, claims)).toEqual([]);
  });

  it('同じ種別・同じキーを 2 つの主張が取れば、衝突として止まる(契約の衝突の検査)', () => {
    const claim = (source: string): LayoutClaim => ({ role: 'eq-test', key: 'shelf', owner: equivalenceTestsGenerator.id, source });
    const problems = layoutClaimProblems(NEXTJS_LAYOUT, [claim('一つ目'), claim('二つ目')]);
    expect(problems.map((problem) => problem.kind)).toEqual(['duplicate_path']);
  });
});
