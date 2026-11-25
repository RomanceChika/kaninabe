/**
 * UX 検証器(U1・U3〜U5)のテスト用ビルダー。
 *
 * 画面・ドメインの構築は screen-builder / model-builder をそのまま使う(U 群の入力は
 * S 群の入力の部分集合であり、別のビルダーを持つと同じ画面を 2 通りに書けてしまう)。
 * ガードサービスは U4 / U5 が `when` 条件の共存判定そのものを見るため、実物を注入する。
 */

import { createGuardServices } from '../../lib/guard/services.js';
import type { UxInput } from '../../lib/model/ux/types.js';
import type { UxContext } from '../../lib/ux/context.js';
import { screenInput } from './screen-builder.js';
import { UNSELECTED } from './verify-inputs.js';

/** 全 UX 検証器テストで共有してよい(状態を持たない)。 */
export const UX_CTX: UxContext = { guards: createGuardServices(), actions: UNSELECTED };

/** screenInput と同じ宣言から UxInput を組み立てる。 */
export function uxInput(init: Parameters<typeof screenInput>[0] = {}): UxInput {
  const input = screenInput(init);
  return { domain: input.domain, screens: input.screens };
}
