/**
 * 「書き方の例」章の実装・テストの抜粋元の置き場の口(`examples-sources.ts`)のテスト。
 *
 * 層・土台の位置(操作の本体の層・基盤の層・テスト支援の土台)だけを配置が決める。Next.js の値では、以前 `paths.ts` の口に綴りで渡していたときと同じパス。
 * 別の配置では、配置の値に従う。決められなければ空文字(読めなかったら鮮度エラーになる読み取りは、空に倒してよい)。
 */

import { describe, expect, it } from 'vitest';
import { baseDirSource, INFRA_TESTS, infrastructureSource, operationSource } from '../../../../../lib/generate/render/book/examples-sources.js';
import { EMPTY_LAYOUT } from '../../../../../lib/model/product/layout.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

describe('抜粋元の置き場: Next.js の値(以前の綴りと同じパス)', () => {
  it('操作の本体・基盤の層の集約の置き場・テスト支援の土台の下', () => {
    expect(operationSource(TEST_LAYOUT, TEST_ROOTS, 'entry.submit')).toBe('app/src/operation/entry/submit.ts');
    expect(infrastructureSource(TEST_LAYOUT, TEST_ROOTS, 'workshop/queries.ts')).toBe('app/src/infrastructure/workshop/queries.ts');
    expect(baseDirSource(TEST_LAYOUT, TEST_ROOTS, INFRA_TESTS, 'entry/submit.test.ts')).toBe('app/src/infrastructure/__tests__/entry/submit.test.ts');
    expect(baseDirSource(TEST_LAYOUT, TEST_ROOTS, { layer: 'operation', dir: 'jobs' }, 'handlers.ts')).toBe('app/src/operation/jobs/handlers.ts');
    expect(baseDirSource(TEST_LAYOUT, TEST_ROOTS, { layer: 'composition', dir: '__tests__' }, 'workshop/workshop_my_list.test.ts')).toBe('app/src/composition/__tests__/workshop/workshop_my_list.test.ts');
  });
});

describe('抜粋元の置き場: 別の配置・解決できない構成', () => {
  it('別の配置(架空の値): 操作の本体と基盤の層は配置の役割の置き場に従い、宣言の無い土台は空文字', () => {
    expect(operationSource(FOREIGN_LAYOUT, TEST_ROOTS, 'entry.submit')).toBe('app/server_code/rules/entry__submit.rule.ts');
    expect(infrastructureSource(FOREIGN_LAYOUT, TEST_ROOTS, 'workshop/queries.ts')).toBe('app/server_code/store/workshop/queries.ts');
    expect(baseDirSource(FOREIGN_LAYOUT, TEST_ROOTS, INFRA_TESTS, 'entry/submit.test.ts')).toBe('app/server_code/infrastructure/__tests__/entry/submit.test.ts');
    expect(baseDirSource(FOREIGN_LAYOUT, TEST_ROOTS, { layer: 'composition', dir: 'jobs' }, 'x.ts')).toBe('');
    expect(baseDirSource(FOREIGN_LAYOUT, TEST_ROOTS, { layer: 'operation', dir: 'common' }, 'x.ts')).toBe('app/server_code/operation/common/x.ts');
  });

  it('実装の木を持たない製品・空の配置は、空文字', () => {
    expect(operationSource(TEST_LAYOUT, { ...TEST_ROOTS, app: null }, 'entry.submit')).toBe('');
    expect(infrastructureSource(EMPTY_LAYOUT, TEST_ROOTS, 'workshop/queries.ts')).toBe('');
    expect(baseDirSource(EMPTY_LAYOUT, TEST_ROOTS, INFRA_TESTS, 'x.ts')).toBe('');
  });
});
