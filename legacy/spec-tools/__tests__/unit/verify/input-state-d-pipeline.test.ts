/**
 * 残り 8 種の「落とした行」の数え方と、X2 が読む設定カタログの入力の状態(束 入力の状態-d)を、**実ローダー・実パイプラインを通して**確かめる。
 *
 *   - jobs / surface / usecases は「仕様を落としたとき」だけ阻害にする(行を落とさない error では、読む検査を止めない)
 *   - 設定カタログは X2 の接地先で、入力の状態を持つ(未選択は事実 = 何も言わない / 阻害は X2 が見ていないと名指す / 読込済みは回る)
 *
 * 種類ごとのローダーの数え方は `model/loaders-dropped-d.test.ts`、入口(ハンドブック)との一致は `generate/generate-inputs-dropped.test.ts` が見る。
 * 実パイプライン(Z3 を使う)を回すのは 11 回(共有部品 `helpers/stores-pipeline.ts` の注意: Z3 は隔離した worker で、回数の上限は無い)。
 */

import { cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL, breakFile, findingsOf, removeTrees, rewrite, rowsOf, verifyTree, without } from '../../helpers/stores-pipeline.js';

afterEach(removeTrees);

const EXPENSES_CONFIG = fileURLToPath(new URL('../../fixtures/samples/expenses/docs/specs/backend/config.md', import.meta.url));

/** stores の木の設定カタログを、expenses の写し(stores の連携が挙げる設定を持たない)に差し替える。 */
const withConfig =
  (...edits: readonly ((specs: string) => void)[]) =>
  (specs: string): void => {
    cpSync(EXPENSES_CONFIG, path.join(specs, 'backend', 'config.md'));
    for (const edit of edits) edit(specs);
  };

/** 土台(stores)は設定カタログを採る(外部連携を採るなら設定カタログも採る — P2 が要求する)。 */
const WITH_CONFIG = ALL;

/** 阻害の行の言い回し(仕様を落とした = 読めなかった仕様があってモデルが欠けている)。 */
const DROPPED_WORDS = '読めなかった仕様があってモデルが欠けている、または欠けていないと言えない';

describe('jobs — 行を落とさない error では読む検査を止めず、行を落としたときだけ阻害', () => {
  it('カタログの id の食い違い(行を落とさない): J0 の error は出るが、A13 と T11 の阻害の行は出ない', async () => {
    const result = await verifyTree(ALL, rewrite(['backend', 'jobs.md'], 'id: job-catalog\n', 'id: job-catalog-typo\n'));

    expect(findingsOf(result.findings, 'J0').length).toBeGreaterThan(0);
    expect(rowsOf(result.lines, ['A13', 'T11'])).toEqual([]);
  });

  it('値域の外の source(行を落とした): A13 と T11 が「jobs を採っているが検査へ渡せない」と名指す', async () => {
    const result = await verifyTree(ALL, rewrite(['backend', 'jobs.md'], '    source: schedule\n', '    source: bogus\n'));

    const rows = rowsOf(result.lines, ['A13', 'T11']);
    expect(rows.map((row) => row.slice(0, row.indexOf(':'))).sort()).toEqual(['A13', 'T11']);
    expect(rows.every((row) => row.includes('jobs を採っているが検査へ渡せない(') && row.includes(DROPPED_WORDS))).toBe(true);
  });
});

describe('surface — 行を落とさない error では T12 を止めず、宣言を読めずに落としたときだけ阻害', () => {
  it('未知のキー(行を落とさない): T12 の阻害の行は出ない', async () => {
    const result = await verifyTree(ALL, rewrite(['backend', 'surface.md'], 'id: surface\n', 'id: surface\nbogus_key: 1\n'));

    expect(rowsOf(result.lines, ['T12'])).toEqual([]);
  });

  it('文字列として読めなかった土台の宣言(宣言を落とした): T12 が「surface を採っているが検査へ渡せない」と名指す', async () => {
    const result = await verifyTree(ALL, rewrite(['backend', 'surface.md'], 'surface_base_migration: 20260911000000_api_base.sql', 'surface_base_migration: 20260911000000'));

    expect(rowsOf(result.lines, ['T12'])).toEqual([expect.stringContaining('T12: 阻害 — surface を採っているが検査へ渡せない(')]);
    expect(rowsOf(result.lines, ['T12'])[0]).toContain(DROPPED_WORDS);
  });
});

describe('usecases — 仕様の中の行を落としたときも阻害(ファイルごと落ちたときと同じ扱い)', () => {
  it('id が name から導かれる ID と違う(行を落とさない): T11 と T12 の阻害の行は出ない', async () => {
    const result = await verifyTree(ALL, rewrite(['frontend', 'usecases', 'stock_receipt.md'], 'id: usecase-stock-receipt\n', 'id: usecase-stock-receipt-typo\n'));

    expect(findingsOf(result.findings, 'Y0').length).toBeGreaterThan(0);
    expect(rowsOf(result.lines, ['T11', 'T12'])).toEqual([]);
  });

  it('対象の無い accept の行(仕様の中の行を落とした): T11 と T12 が「usecases を採っているが検査へ渡せない」と名指す', async () => {
    const result = await verifyTree(ALL, rewrite(['frontend', 'usecases', 'stock_receipt.md'], 'test_cases:\n', 'accept:\n  - reason: 理由だけ\n\ntest_cases:\n'));

    const rows = rowsOf(result.lines, ['T11', 'T12']);
    expect(rows.map((row) => row.slice(0, row.indexOf(':'))).sort()).toEqual(['T11', 'T12']);
    expect(rows.every((row) => row.includes(': 阻害 — usecases を採っているが検査へ渡せない(') && row.includes(DROPPED_WORDS))).toBe(true);
  });
});

describe('config(X2 の接地先)— 入力の状態を持つ: 未選択は事実・阻害は名指す・読込済みは回る', () => {
  const x2Rows = (lines: readonly string[]): string[] => rowsOf(lines, ['X2']);

  it('土台のまま(設定カタログを採り、連携が挙げる設定が載っている): X2 は回り、指摘も阻害の行も出ない', async () => {
    const result = await verifyTree(ALL);

    expect(x2Rows(result.lines)).toEqual([]);
    expect(findingsOf(result.findings, 'X2')).toEqual([]);
    expect(findingsOf(result.findings, 'P2')).toEqual([]);
  });

  it('未選択(土台から config を外す): X2 は何も言わない — 行も Finding も出ない。外部連携を採るのに設定カタログを採らない食い違いは宣言の段(P2)が error にする', async () => {
    const result = await verifyTree(without('config'));

    expect(x2Rows(result.lines)).toEqual([]);
    expect(findingsOf(result.findings, 'X2')).toEqual([]);
    // 同じ「uses に config を足す」を重ねて言わない(先の種類が置き場にあるのに採っていない指摘 1 件だけ)。
    expect(findingsOf(result.findings, 'P2').map((finding) => finding.message)).toEqual([expect.stringContaining('config の仕様が置き場')]);
  });

  it('読込済み(設定カタログを採って置く): X2 が回り、設定カタログに無い設定を挙げた連携を指摘する。阻害の行は出ない', async () => {
    const result = await verifyTree(WITH_CONFIG, withConfig());

    expect(findingsOf(result.findings, 'X2').some((finding) => finding.message.includes('config カタログに実在しません'))).toBe(true);
    expect(x2Rows(result.lines)).toEqual([]);
  });

  it('設定カタログの id の食い違い(行を落とさない): K0 の error は出るが、X2 は回る', async () => {
    const result = await verifyTree(WITH_CONFIG, withConfig(rewrite(['backend', 'config.md'], 'id: config-catalog\n', 'id: config-catalog-typo\n')));

    expect(findingsOf(result.findings, 'K0').length).toBeGreaterThan(0);
    expect(findingsOf(result.findings, 'X2').length).toBeGreaterThan(0);
    expect(x2Rows(result.lines)).toEqual([]);
  });

  it('語彙に無い kind の行(行を落とした): X2 は判定を出さず、設定を挙げた連携を名指して「見ていません」と言う(偽の「実在しません」を出さない)', async () => {
    const result = await verifyTree(WITH_CONFIG, withConfig(rewrite(['backend', 'config.md'], '    kind: secret', '    kind: ghost')));

    expect(findingsOf(result.findings, 'K0').length).toBeGreaterThan(0);
    expect(findingsOf(result.findings, 'X2')).toEqual([]);
    expect(x2Rows(result.lines)).toEqual([
      expect.stringContaining('X2: 阻害 — config を採っているが検査へ渡せない('),
    ]);
    expect(x2Rows(result.lines)[0]).toContain(DROPPED_WORDS);
    expect(x2Rows(result.lines)[0]).toContain('(対象 1 件: ');
    expect(result.skipNotes).toContain(x2Rows(result.lines)[0]);
  });

  it('設定カタログが読めない・壊れている: X2 は同じく見ていないと名指す(原因の K0 の error は 1 回だけ)', async () => {
    const result = await verifyTree(WITH_CONFIG, withConfig(breakFile('backend', 'config.md')));

    expect(findingsOf(result.findings, 'X2')).toEqual([]);
    expect(x2Rows(result.lines)).toHaveLength(1);
    expect(x2Rows(result.lines)[0]).toContain('X2: 阻害 — config を採っているが検査へ渡せない(読めない・壊れている');
    expect(findingsOf(result.findings, 'K0').length).toBeGreaterThan(0);
  });
});
