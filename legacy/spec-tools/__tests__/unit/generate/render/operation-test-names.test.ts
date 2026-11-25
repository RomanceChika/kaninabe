/**
 * 生成テストの名前(`lib/generate/render/operation-test-names.ts`。束 ⑰-3)。
 *
 * 同じ綴りを 3 か所が組み立てる(生成テスト本体・action_spec の生成ブロック・A6 の突合)ので、
 * 正はこの 1 か所である。ここが固定するのはその規約 ——
 * ID は 900 番台、という規約である。**ファイルの置き場は配置の役割 `operation-test`**(`layout.test.ts` の生成テストの置き場の節が固定する)。
 */

import { describe, expect, it } from 'vitest';
import { GENERATED_TC_BASE, testCaseIdOf } from '../../../../lib/generate/render/operation-test-names.js';
import { layoutPath } from '../../../../lib/model/product/layout.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';

describe('生成テストの名前', () => {
  it('ファイルは集約とイベントから決まる', () => {
    expect(layoutPath(TEST_LAYOUT, 'app', 'operation-test', 'widget.send')).toBe('app/src/operation/__tests__/generated/widget/send.test.ts');
  });

  it('テストケース ID は 900 番台から振る(手書きの帯と分ける)', () => {
    expect(GENERATED_TC_BASE).toBe(900);
    expect(testCaseIdOf('widget.send', 1)).toBe('TC-WIDGET-SEND-901');
    expect(testCaseIdOf('widget.send', 7)).toBe('TC-WIDGET-SEND-907');
  });

  it('集約名・イベント名は大文字に畳んで ID にする', () => {
    expect(testCaseIdOf('entry_participant.link', 2)).toBe('TC-ENTRY_PARTICIPANT-LINK-902');
  });
});
