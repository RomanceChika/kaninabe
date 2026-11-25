/**
 * 外部の SDK の置き場の表の生成器(`code-sdk-homes.ts`)のうち、**外へ送る口の置き場**(`outbound`。点検 10 回目 B10-3)のテスト。
 *
 * 見るのは 3 つ —— ①口の表は `outbound-primitives.ts` の 1 か所をそのまま写す ②置き場は SDK を宣言しない外部連携も含めた全部の
 * `adapter_root` と土台(重複なし・製品の木の根からの相対) ③製品の木が無ければ置き場は空(口の表は残る)。
 */

import { describe, expect, it } from 'vitest';
import { sdkHomesOf } from '../../../../lib/generate/render/code-sdk-homes.js';
import { OUTBOUND_PRIMITIVE_MODULES } from '../../../../lib/model/external/outbound-primitives.js';
import { externalCatalog, integration } from '../../../helpers/external-builder.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/** SDK を宣言する連携と、しない連携(REST だけ)。 */
const CATALOG = {
  ...externalCatalog([integration('chat', { service: 'chat_vendor', port: 'ChatPort', adapter: 'app/src/infrastructure/chat_vendor/chat.ts' })]),
  vocabulary: {
    service: [
      { id: 'chat_vendor', adapterRoot: 'app/src/infrastructure/chat_vendor', sdkPackages: ['chat-sdk'], clientUi: [] },
      { id: 'hook_vendor', adapterRoot: 'app/src/infrastructure/hook_vendor', sdkPackages: [], clientUi: [] },
    ],
  },
};

describe('code-sdk-homes の外へ送る口の置き場', () => {
  it('口の表は閉じた表をそのまま写し、置き場は全部の adapter_root と土台', () => {
    const table = sdkHomesOf(CATALOG, { layout: TEST_LAYOUT, roots: TEST_ROOTS });
    expect(table.outbound.primitives).toEqual(OUTBOUND_PRIMITIVE_MODULES);
    expect(table.outbound.homes).toEqual(['src/infrastructure/chat_vendor', 'src/infrastructure/hook_vendor', 'src/infrastructure/supabase']);
    // SDK の置き場(homes)は SDK を宣言した連携と土台だけ(外へ送る口の置き場とは別の表)。
    expect(table.homes.map((home) => home.dir)).toEqual(['src/infrastructure/chat_vendor', 'src/infrastructure/supabase']);
  });

  it('製品の木が無ければ置き場は空(口の表は残る)', () => {
    const table = sdkHomesOf(CATALOG, { layout: TEST_LAYOUT, roots: { ...TEST_ROOTS, app: null } });
    expect(table.outbound).toEqual({ primitives: OUTBOUND_PRIMITIVE_MODULES, homes: [] });
  });

  it('カタログが無ければ土台だけ', () => {
    expect(sdkHomesOf(null, { layout: TEST_LAYOUT, roots: TEST_ROOTS }).outbound.homes).toEqual(['src/infrastructure/supabase']);
  });
});
