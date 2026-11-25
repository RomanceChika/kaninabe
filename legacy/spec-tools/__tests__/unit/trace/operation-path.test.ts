/**
 * 実装ファイルのパス → 操作 ID の写し(`lib/trace/operation-path.ts` の `operationIdOf`。A11 / A14 の共有)のテスト。
 *
 * 写す規約そのものは置き場の配置の役割 `operation-logic` の逆引きが持つ(部品化 ③-c4b)。ここでは、**配置から走査の根を引いて**写すこと —— Next.js の値では旧い規約と同じ結果になり、
 * 別の配置(架空の値)ではその配置の走査の根の下だけが操作として読まれること —— を固定する。規約の細部(土台・補助ファイル・テスト)は `targets/nextjs/layer-roles.test.ts`。
 */

import { describe, expect, it } from 'vitest';
import { operationIdOf } from '../../../lib/trace/operation-path.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../helpers/platform.js';

const ROOTS = { app: 'app' };

describe('operationIdOf', () => {
  it('Next.js の値: 操作の本体の置き場の下の実装ファイルを、{集約}.{イベント} に写す', () => {
    expect(operationIdOf('app/src/operation/entry/submit.ts', TEST_LAYOUT, ROOTS)).toBe('entry.submit');
    expect(operationIdOf('app/src/operation/workshop_publication/publish_public.ts', TEST_LAYOUT, ROOTS)).toBe('workshop_publication.publish_public');
  });

  it('操作ではないファイル(横断・補助・土台・テスト支援・置き場の外・規約の外の根)は null', () => {
    for (const file of [
      'app/src/operation/logging.ts',
      'app/src/operation/entry/ports.ts',
      'app/src/operation/shared/x.ts',
      'app/src/operation/usecase/demo/register.ts',
      'app/src/operation/__tests__/plan-harness.ts',
      'app/src/composition/entry/submit.ts',
      'src/operation/entry/submit.ts',
      'other/app/src/operation/entry/submit.ts',
    ]) {
      expect(operationIdOf(file, TEST_LAYOUT, ROOTS), file).toBeNull();
    }
  });

  it('別の配置(架空の値)では、その配置の走査の根の下だけが操作として読まれる(Next.js の綴りの木は読まれない)', () => {
    expect(operationIdOf('app/server_code/rules/entry__submit.rule.ts', FOREIGN_LAYOUT, ROOTS)).toBe('entry.submit');
    expect(operationIdOf('app/src/operation/entry/submit.ts', FOREIGN_LAYOUT, ROOTS)).toBeNull();
  });

  it('実装の木を持たない製品・配置が役割を宣言していない構成は、操作の実装が無い(null)', () => {
    expect(operationIdOf('app/src/operation/entry/submit.ts', TEST_LAYOUT, { app: null })).toBeNull();
    expect(operationIdOf('app/src/operation/entry/submit.ts', {}, ROOTS)).toBeNull();
  });
});
