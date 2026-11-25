/**
 * 設定の章が「設定の値」を出さないことの見張り(束 ブック ⑧-c2)。
 *
 * 見張りは「クリーンな章が通る」だけでは弱い(検出器が何も拾えなくても緑になる)。ここでは、
 * **値らしい文字列を仕様の自由文(summary / absence)に植えて章を生成し、見張りが赤になること**を確かめる。
 * 植える形は、短い名前・空白つき・バッククォート・コロン(半角と全角)。安全の根拠の 1 つである
 * 「設定の行に値の欄が無い」ことは、型の全列挙(欄が増えたら型検査が落ちる)で固定する。
 * (型の定義 `lib/model/config/types.ts` にコメントで書かないのは、そのファイルが C24 の写し元の閉包に入っていて、コメント 1 つで鮮度が赤になるため。)
 */

import { describe, expect, it } from 'vitest';
import { bookHtmlPage, pageText } from '../../../../helpers/book-html.js';
import type { ConfigVariableDecl } from '../../../../../lib/model/config/types.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { configValueLeaks } from '../../../../helpers/config-leak.js';
import { configModel, configVariable } from '../../../../helpers/config-builder.js';

/** カタログの設定の名前(短い名前を含む)。 */
const NAMES = ['TZ', 'CI', 'APP_NAME', 'SUPABASE_URL', 'API_KEY'] as const;

/** 設定の章(HTML の本)を、与えた設定で生成して本文の字を返す。 */
function generated(variables: readonly ConfigVariableDecl[]): string {
  const ctx = { ...bookCtx(), config: configModel(variables) };
  return pageText(bookHtmlPage(bookModel(), ctx, 'config.html') ?? '');
}

describe('検出器そのもの', () => {
  it('名前の直後の = / : / ：(前後の空白・バッククォート・太字を許す)を拾う', () => {
    for (const leak of ['TZ=Asia/Tokyo', 'CI=1', 'SUPABASE_URL = https://x', '`APP_NAME`=foo', '**API_KEY**: sk-x', 'API_KEY：x', 'TZ :  x']) {
      expect(configValueLeaks(leak, NAMES), leak).not.toEqual([]);
    }
  });

  it('名前の一部になる並びと、記号が続かない言及は拾わない', () => {
    for (const fine of ['CRON_TZ=1', 'MYCI: 1', '`TZ` を読む', 'TZ が無いと落ちる', '| `CI` | 開発機 |', '例 Asia/Tokyo']) {
      expect(configValueLeaks(fine, NAMES), fine).toEqual([]);
    }
    expect(configValueLeaks('TZ=1', [])).toEqual([]);
  });
});

describe('値を植えると見張りが赤になる(章の生成を通して)', () => {
  const clean = generated(NAMES.map((id) => configVariable(id)));

  it('何も植えていない章は、見張りを通る', () => {
    expect(clean).toContain('API_KEY');
    expect(configValueLeaks(clean, NAMES)).toEqual([]);
  });

  const planted: readonly (readonly [string, string])[] = [
    ['TZ', 'TZ=Asia/Tokyo'],
    ['CI', 'CI=1'],
    ['SUPABASE_URL', 'SUPABASE_URL = https://example.invalid'],
    ['APP_NAME', '`APP_NAME`=Foo'],
    ['API_KEY', 'API_KEY: sk-test-0000'],
    ['API_KEY', 'API_KEY：sk-test-0000'],
  ];

  for (const [id, text] of planted) {
    it(`summary に「${text}」を植えると赤になる`, () => {
      const body = generated(NAMES.map((name) => (name === id ? configVariable(name, { summary: text }) : configVariable(name))));

      expect(configValueLeaks(body, NAMES)).not.toEqual([]);
    });

    it(`absence に「${text}」を植えると赤になる`, () => {
      const body = generated(NAMES.map((name) => (name === id ? configVariable(name, { absence: text }) : configVariable(name))));

      expect(configValueLeaks(body, NAMES)).not.toEqual([]);
    });
  }
});

describe('設定の行に値の欄は無い(安全の根拠)', () => {
  it('設定 1 本の宣言が持つ欄の全列挙。欄を足すと型検査が落ちる(値の欄を足していないか、ここで人が見る)', () => {
    // `Record<keyof ConfigVariableDecl, true>` は欄の全列挙を強いる。欄が増えると、ここが型エラーになる。
    const fields: Record<keyof ConfigVariableDecl, true> = {
      id: true,
      kind: true,
      requirement: true,
      usedBy: true,
      provision: true,
      targets: true,
      summary: true,
      absence: true,
      format: true,
      scheme: true,
      rotation: true,
      strength: true,
      previous: true,
      notInTemplateReason: true,
      location: true,
    };

    expect(Object.keys(fields).sort()).toEqual(
      ['absence', 'format', 'id', 'kind', 'location', 'notInTemplateReason', 'previous', 'provision', 'requirement', 'rotation', 'scheme', 'strength', 'summary', 'targets', 'usedBy'],
    );
    // 値を持ちうる名前の欄(value / default / example など)は無い。
    expect(Object.keys(fields).filter((key) => /value|default|example|secret|token/i.test(key))).toEqual([]);
  });
});
