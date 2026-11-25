/**
 * M12(文体の検査)のユニットテスト。人が書く列(仕様の `summary:`)の 1 文ずつに、設計メモ §7-6 の
 * 規則を当てる: 1 文 50 字超・括弧の補足・文中の記号接続・常体の混在。
 *
 * いまは仕様に `summary:` が無いので本番の入力は 0 件で、規則そのものをここで固定する(テスト先行)。
 */

import { describe, expect, it } from 'vitest';
import { proseStyleIssues, verifyProseStyle } from '../../../../lib/terms/verifiers/m12-prose-style.js';
import type { HumanSentence } from '../../../../lib/model/terms/types.js';

/** 人が書く文 1 つ(位置は固定)。 */
function sentence(text: string): HumanSentence {
  return { file: 'docs/specs/domain/x/states.md', pointer: 'machines[0].states[1].summary', text };
}

describe('proseStyleIssues(§7-6 の規則を文字の側で見る)', () => {
  it('規則を守った敬体の短い文は 0 件', () => {
    expect(proseStyleIssues('世話役が催しを立てた直後の段です。メンバーが枠を申し込める期間です。')).toEqual([]);
  });

  it('1 文が 50 字を超えると「長い文」になる(50 字ちょうどは通す)', () => {
    expect(proseStyleIssues(`${'あ'.repeat(48)}です。`)).toEqual([]);
    const long = `${'あ'.repeat(49)}です。`;
    expect(proseStyleIssues(long).map((issue) => issue.kind)).toEqual(['long']);
  });

  it('括弧(全角・半角)の補足は「括弧」になる。コードの中の括弧は数えない', () => {
    expect(proseStyleIssues('承認待ち(requested)の枠です。').map((issue) => issue.kind)).toEqual(['paren']);
    expect(proseStyleIssues('承認待ち（requested）の枠です。').map((issue) => issue.kind)).toEqual(['paren']);
    expect(proseStyleIssues('`f(x)` を呼びます。')).toEqual([]);
  });

  it('文中の記号接続(= → / ・)は「記号」になる。コードの中は数えない', () => {
    expect(proseStyleIssues('締切 → 承認制です。').map((issue) => issue.kind)).toEqual(['symbol']);
    expect(proseStyleIssues('一般/学割です。').map((issue) => issue.kind)).toEqual(['symbol']);
    expect(proseStyleIssues('部・プログラムです。').map((issue) => issue.kind)).toEqual(['symbol']);
    expect(proseStyleIssues('a = b です。').map((issue) => issue.kind)).toEqual(['symbol']);
    expect(proseStyleIssues('`now >= a/b` が条件です。')).toEqual([]);
  });

  it('常体の文は「常体」になる(敬体と混ざっても、常体だけでも)', () => {
    expect(proseStyleIssues('受付が止まった段である。').map((issue) => issue.kind)).toEqual(['plain']);
    expect(proseStyleIssues('受付が止まった段です。料金は動いていないのだ。').map((issue) => issue.kind)).toEqual(['plain']);
  });

  it('辞書形(動詞の言い切り・「ある。」)は、判定を強めたときだけ「常体」になる。敬体と体言止めは常体ではない', () => {
    const strict = { dictionaryForm: true };

    for (const plain of ['世話役が締める。', '参加者が申し込める。', 'メンバーが使う。', '枠が増える。', '上限がある。', '世話役が読む。', '席を決める。']) {
      expect(proseStyleIssues(plain, strict).map((issue) => issue.kind), plain).toEqual(['plain']);
      // 既定(機械の箇条の見方)では、辞書形は常体に数えない。
      expect(proseStyleIssues(plain), plain).toEqual([]);
    }
    for (const fine of ['世話役が締めます。', '参加者が申し込めます。', '上限があります。', '受付が止まった段です。', '締めませんでした。', '見てください。', '承認待ちの枠の数', '料金が確定した時点の単価']) {
      expect(proseStyleIssues(fine, strict), fine).toEqual([]);
    }
    // 括弧の補足は除いて文末を見る。
    expect(proseStyleIssues('世話役が締める(戻せる)。', strict).map((issue) => issue.kind)).toEqual(['paren', 'plain']);
  });

  it('1 つの文に複数の問題があれば、問題ごとに 1 件', () => {
    const kinds = proseStyleIssues(`${'あ'.repeat(50)}(補足)です。`).map((issue) => issue.kind);
    expect(kinds).toEqual(['long', 'paren']);
  });
});

describe('verifyProseStyle', () => {
  it('summary が 0 件なら何も言わない(いまの本番の入力)', () => {
    expect(verifyProseStyle([])).toEqual([]);
  });

  it('summary の辞書形の文(「締める。」)は warning になる(人が書く文は辞書形も常体として見る)', () => {
    const findings = verifyProseStyle([sentence('世話役が締める。')]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('常体');
  });

  it('規則を守った summary は指摘しない', () => {
    expect(verifyProseStyle([sentence('世話役が催しを立てた直後の段です。')])).toEqual([]);
  });

  it('破れた summary は 1 つにつき warning 1 件(場所と問題の種類と直し方つき)', () => {
    const findings = verifyProseStyle([sentence('受付が止まった段である(戻せる)。'), sentence('終端です。')]);

    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.verifier).toBe('M12');
    expect(finding?.severity).toBe('warning');
    expect(finding?.location).toEqual({ file: 'docs/specs/domain/x/states.md', pointer: 'machines[0].states[1].summary' });
    expect(finding?.counterexample?.issues).toContain('括弧');
    expect(finding?.counterexample?.issues).toContain('常体');
    expect(finding?.suggestion).toContain('敬体');
  });
});
