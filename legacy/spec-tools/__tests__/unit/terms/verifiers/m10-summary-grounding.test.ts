/**
 * M10(`summary:` の語の接地)のユニットテスト。人が書く文に、仕様に無い語・数字・識別子が入っていないかを
 * 見る(設計メモ §2 の規約: 数字を書かない・仕様 ID を書かない。§7-6: 仕様の語だけを使う)。
 *
 * 文体(長さ・括弧・記号・常体)は M12 が見るので、ここでは見ない。
 */

import { describe, expect, it } from 'vitest';
import {
  groundingIssues,
  verifySummaryGrounding,
  type SummaryVocabulary,
} from '../../../../lib/terms/verifiers/m10-summary-grounding.js';
import type { HumanSentence } from '../../../../lib/model/terms/types.js';

/** 仕様の語(本文の断片)と、台帳の語から作る語彙。 */
function vocabulary(specText: string, ledgerWords: readonly string[] = []): SummaryVocabulary {
  return { specText, ledgerWords };
}

const SPEC = '催し 受付中 受付締切 料金 確定 世話役 メンバー エントリー 申込済み 下書き';

function sentence(text: string): HumanSentence {
  return { file: 'docs/specs/domain/workshop/states.md', pointer: 'machines[0].states[2].summary', text };
}

describe('groundingIssues(漢字・カタカナの語が仕様にあるか)', () => {
  it('仕様に書かれた語だけの文は 0 件', () => {
    expect(groundingIssues('世話役が催しを締め切ります。メンバーのエントリーは受付締切のあとも見えます。', vocabulary(SPEC))).toEqual([]);
  });

  it('仕様に無い語は「仕様に無い語」になる(2 字以上の漢字・カタカナの連なり)', () => {
    const issues = groundingIssues('世話役が盛況な催しを開きます。', vocabulary(SPEC));

    expect(issues).toEqual([{ kind: 'unknown', token: '盛況' }]);
  });

  it('語が 1 字だけの連なりは見ない(送り仮名で割れた語の頭・尻。ここは見えない部分として残る)', () => {
    expect(groundingIssues('華やかに申し込み', vocabulary(SPEC))).toEqual([]);
  });

  it('複合語は、2 字以上の仕様の語に割れれば通る(受付 + 締切 → 受付締切 は仕様にもある)', () => {
    expect(groundingIssues('料金確定のあとです。', vocabulary(SPEC)).map((issue) => issue.token)).toEqual([]);
    expect(groundingIssues('料金凍結のあとです。', vocabulary(SPEC)).map((issue) => issue.token)).toEqual(['料金凍結']);
  });

  it('台帳の語も仕様の語として通る', () => {
    expect(groundingIssues('マトリクスを読みます。', vocabulary(SPEC)).map((issue) => issue.token)).toEqual(['マトリクス']);
    expect(groundingIssues('マトリクスを読みます。', vocabulary(SPEC, ['マトリクス']))).toEqual([]);
  });
});

describe('groundingIssues(数字・識別子・等幅)', () => {
  it('数字(半角・全角)は「数字」になる。件数は生成が入れる', () => {
    expect(groundingIssues('催しは 3 つの段を通ります。', vocabulary(SPEC)).map((issue) => issue.kind)).toEqual(['digit']);
    expect(groundingIssues('催しは３つの段を通ります。', vocabulary(SPEC)).map((issue) => issue.kind)).toEqual(['digit']);
  });

  it('英字の語は、台帳の語でなければ「識別子」になる(仕様 ID を書かない)', () => {
    expect(groundingIssues('催しは accepting です。', vocabulary(SPEC)).map((issue) => issue.token)).toEqual(['accepting']);
    expect(groundingIssues('催しは permit です。', vocabulary(SPEC, ['permit']))).toEqual([]);
  });

  it('等幅(`…`)で書いた語は「等幅」になる(識別子・パスは読者が持たない)', () => {
    expect(groundingIssues('催しは `workshop` です。', vocabulary(SPEC)).map((issue) => issue.kind)).toEqual(['code']);
  });
});

describe('verifySummaryGrounding', () => {
  it('summary が 0 件なら何も言わない', () => {
    expect(verifySummaryGrounding([], vocabulary(SPEC))).toEqual([]);
  });

  it('接地した summary は指摘しない', () => {
    expect(verifySummaryGrounding([sentence('世話役が催しを締め切ります。')], vocabulary(SPEC))).toEqual([]);
  });

  it('破れた summary は 1 つにつき warning 1 件(場所と語と直し方つき)', () => {
    const findings = verifySummaryGrounding([sentence('催しは 3 つの盛況を見せます。')], vocabulary(SPEC));

    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.verifier).toBe('M10');
    expect(finding?.severity).toBe('warning');
    expect(finding?.location).toEqual({ file: 'docs/specs/domain/workshop/states.md', pointer: 'machines[0].states[2].summary' });
    expect(finding?.counterexample?.issues).toContain('数字');
    expect(finding?.counterexample?.issues).toContain('仕様に無い語');
    expect(finding?.counterexample?.at).toContain('盛況');
    expect(finding?.suggestion).toContain('仕様');
  });
});
