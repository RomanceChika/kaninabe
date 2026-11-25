import { describe, expect, it } from 'vitest';
import { bodyModulesOf } from '../../../lib/generate/body-modules.js';
import type { BodyModules } from '../../../lib/generate/body-modules.js';
import { GeneratorPreconditionError } from '../../../lib/kernel/generator-precondition.js';
import { EMPTY_LAYOUT } from '../../../lib/model/product/layout.js';
import type { ProductLayout } from '../../../lib/model/product/layout.js';
import { FOREIGN_BODY_COMPATIBLE_LAYOUT, TEST_LAYOUT } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

/**
 * 生成物の本文が import する先を、置き場の配置から引く口(部品化 ③-e1)。
 *
 * 本番の配置(Next.js)では今までの綴りと一致し、別の綴りの配置を渡すと全部が別の綴りに変わる(生成器が指定子の綴りを持たない証拠)。
 * 決められなければ黙って空にせず、前提の失敗で配置の定義の検査を名指す。
 */

const ORIGIN = { what: '画面 sample のフォーム', location: { file: 'docs/specs/frontend/screens/x.md' } };

/** 前提の失敗(`GeneratorPreconditionError`)を受け取る。 */
function stopped(run: () => unknown): GeneratorPreconditionError {
  try {
    run();
  } catch (error) {
    if (error instanceof GeneratorPreconditionError) return error;
    throw error;
  }
  throw new Error('前提の失敗が起きませんでした');
}

/** 口を全部引く(1 つの配置で全部が解決できるか・どう綴られるか)。 */
function resolveAll(modules: BodyModules, adapter: string): readonly string[] {
  return [
    modules.generated('jobs'),
    modules.generated('workshop.labels'),
    modules.sourceFile(adapter),
    modules.operationHooks('workshop.confirm'),
    modules.computes('fee_calc'),
    modules.preflight(),
    modules.component('form-row'),
    modules.auth(),
    modules.clock(),
    modules.dbPorts(),
  ];
}

describe('本番の配置(Next.js): 今までの生成物と同じ指定', () => {
  it('生成物の根の下・ソースの下・手書きの接続点が、従来の綴りになる', () => {
    expect(resolveAll(bodyModulesOf({ layout: TEST_LAYOUT, roots: TEST_ROOTS }, ORIGIN), 'app/src/infrastructure/discord/webhook.ts')).toEqual([
      '@/domain/generated/jobs',
      '@/domain/generated/workshop.labels',
      '@/infrastructure/discord/webhook',
      '@/operation/workshop/hooks/confirm',
      '@/domain/computes/fee_calc',
      '@/domain/preflight',
      '@/components/form-row',
      '@/composition/auth',
      '@/infrastructure/system-clock',
      '@/infrastructure/supabase/db-ports',
    ]);
  });
});

describe('別の綴りの配置: 全部が配置の綴りに変わる(生成器は指定子の綴りを持たない)', () => {
  it('Next.js の別名が 1 つも残らず、生成物の根は製品の宣言から導かれる', () => {
    const moved = { ...TEST_ROOTS, generated: `${TEST_ROOTS.app ?? ''}/server_code/domain/generated` };
    const resolved = resolveAll(bodyModulesOf({ layout: FOREIGN_BODY_COMPATIBLE_LAYOUT, roots: moved }, ORIGIN), 'app/server_code/infrastructure/discord/webhook.ts');

    expect(resolved).toEqual([
      '~srv/domain/generated/jobs',
      '~srv/domain/generated/workshop.labels',
      '~srv/infrastructure/discord/webhook',
      '~srv/rules/workshop__confirm.guard',
      '~srv/pure/fee_calc.fn',
      '~srv/pure/entry_check',
      '~srv/ui/kit/form-row.view',
      '~srv/wiring/who',
      '~srv/store/clock',
      '~srv/etc/db_open',
    ]);
    expect(resolved.filter((module) => module.startsWith('@/'))).toEqual([]);
  });
});

describe('決められないとき: 黙って空にせず、前提の失敗で配置の定義の検査を名指す', () => {
  it('空の配置では、どの口も止まる(出どころの仕様の位置を指す)', () => {
    const modules = bodyModulesOf({ layout: EMPTY_LAYOUT, roots: TEST_ROOTS }, ORIGIN);
    for (const run of [
      () => modules.generated('jobs'),
      () => modules.sourceFile('app/src/x.ts'),
      () => modules.operationHooks('a.b'),
      () => modules.computes('x'),
      () => modules.preflight(),
      () => modules.component('x'),
      () => modules.auth(),
      () => modules.clock(),
      () => modules.dbPorts(),
    ]) {
      const finding = stopped(run).findings[0];

      expect(finding?.verifier).toBe('配置の定義の検査');
      expect(finding?.location.file).toBe(ORIGIN.location.file);
      expect(finding?.message).toContain(ORIGIN.what);
    }
  });

  it('役割が 1 つ欠けた配置では、その口だけが止まる(ほかは引ける)', () => {
    const { 'system-clock': _clock, ...withoutClock }: ProductLayout = TEST_LAYOUT;
    const modules = bodyModulesOf({ layout: withoutClock, roots: TEST_ROOTS }, ORIGIN);

    expect(modules.auth()).toBe('@/composition/auth');
    expect(stopped(() => modules.clock()).findings[0]?.message).toContain('時計の口');
  });

  it('製品の roots.generated がソースの根の外にあると、生成物の根の下の指定は決められない', () => {
    const outside = { ...TEST_ROOTS, generated: 'elsewhere/generated' };
    const finding = stopped(() => bodyModulesOf({ layout: TEST_LAYOUT, roots: outside }, ORIGIN).generated('jobs')).findings[0];

    expect(finding?.verifier).toBe('配置の定義の検査');
    expect(finding?.message).toContain('roots.generated');
  });

  it('ソースの根の外のパス・ソースの根そのもの・.ts でないパスは、黙って別名に接がず前提の失敗で止める(アダプタのパスは製品の仕様が書く)', () => {
    const modules = bodyModulesOf({ layout: TEST_LAYOUT, roots: TEST_ROOTS }, ORIGIN);
    for (const path of ['other/dir/x.ts', '/abs/app/src/x.ts', '../app/src/x.ts', 'app/src', 'app/src/a/b.tsx', 'app/src/a/b']) {
      const finding = stopped(() => modules.sourceFile(path)).findings[0];

      expect(finding?.verifier, path).toBe('X1');
      expect(finding?.message, path).toContain(path);
      expect(finding?.counterexample, path).toEqual({ path, sourceRoot: 'app/src' });
      expect(finding?.location.file).toBe(ORIGIN.location.file);
    }
    // 対照: 根の中の .ts は引ける。
    expect(modules.sourceFile('app/src/a/b.adapter.ts')).toBe('@/a/b.adapter');
  });

  it('生成物の名前が空だと、末尾が区切りの指定を黙って返さず止まる', () => {
    const finding = stopped(() => bodyModulesOf({ layout: TEST_LAYOUT, roots: TEST_ROOTS }, ORIGIN).generated('')).findings[0];

    expect(finding?.verifier).toBe('配置の定義の検査');
    expect(finding?.message).toContain('名前が空');
  });

  it('roots.generated がソースの根そのものでも指定は引ける(選択の検査が許す範囲と同じ)', () => {
    const atRoot = { ...TEST_ROOTS, generated: 'app/src/' };

    expect(bodyModulesOf({ layout: TEST_LAYOUT, roots: atRoot }, ORIGIN).generated('jobs')).toBe('@/jobs');
  });
});
