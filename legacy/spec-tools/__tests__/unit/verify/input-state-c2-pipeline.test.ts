/**
 * external / auth の阻害の基準と、T 群の裏づけの阻害(束 入力の状態-c2)を、**実ローダー・実パイプラインを通して**確かめる。
 *
 *   - external / auth は「仕様を落としたとき」だけ阻害にする(未知のキー・id の食い違いのように行を落とさない error では止めない)
 *   - jobs / usecases / external の阻害を T 群の側から名指す(未選択は事実なので行を出さない)
 *
 * 実パイプラインを回す回数が多いので、`input-state-c-pipeline.test.ts` とは別のファイルにしてある(共有部品は `helpers/stores-pipeline.ts`)。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ALL, breakFile, findingsOf, removeFile, removeTrees, rewrite, rowsOf, verifyTree, without } from '../../helpers/stores-pipeline.js';

afterEach(removeTrees);

describe('項目 2(c2) — external / auth の阻害は「仕様を落としたとき」だけ(行を落とさない error では止めない)', () => {
  const READERS = ['S13', 'S16', 'Y3', 'Y5'];

  it('external: 未知のキー(行を落とさない error)なら X 群は宣言を読む検査も回す。X0 の error は出る', async () => {
    const result = await verifyTree(ALL, rewrite(['backend', 'external.md'], 'id: external-catalog\n', 'id: external-catalog\nbogus_key: 1\n'));

    expect(findingsOf(result.findings, 'X0').some((finding) => finding.message.includes('bogus_key'))).toBe(true);
    expect(rowsOf(result.lines, ['X1〜X8'])).toEqual([]);
    expect(result.lines.some((line) => line.startsWith('X 群(外部連携カタログ): 連携 1 件に対し X1〜X8'))).toBe(true);
  });

  it('external: 行を読めずに落としたら(値域の外)X 群は宣言を読む検査を止めて名指し、台帳だけを見る X4 は実行する', async () => {
    const result = await verifyTree(ALL, rewrite(['backend', 'external.md'], 'degrade: refuse ', 'degrade: maybe  '));

    expect(rowsOf(result.lines, ['X1〜X8'])).toEqual([
      expect.stringContaining('X1〜X8: 阻害 — external を採っているが検査へ渡せない(読めなかった仕様があってモデルが欠けている、または欠けていないと言えない'),
    ]);
    expect(result.lines).toContain('X 群(外部連携カタログ): 宣言を読めないため、台帳だけを見る検査を実行しました。');
  });

  it('auth: id の食い違い(行を落とさない error)なら関門は読込済みで、到達を読む 4 本は止まらない。H0 の error は出る', async () => {
    const result = await verifyTree(ALL, rewrite(['backend', 'auth.md'], 'id: auth-flow\n', 'id: auth-flow-typo\n'));

    expect(findingsOf(result.findings, 'H0').length).toBeGreaterThan(0);
    expect(rowsOf(result.lines, READERS)).toEqual([]);
  });

  it('auth: 関門を読めずに落としたら(値域の外)到達を読む 4 本が「auth を採っているが検査へ渡せない」と名指す', async () => {
    const result = await verifyTree(ALL, rewrite(['backend', 'auth.md'], 'on_fail: not_found', 'on_fail: maybe'));

    const rows = rowsOf(result.lines, READERS);
    expect(rows.map((row) => row.slice(0, row.indexOf(':')))).toEqual(READERS);
    expect(rows.every((row) => row.includes('auth を採っているが検査へ渡せない(読めなかった仕様があってモデルが欠けている、または欠けていないと言えない'))).toBe(true);
  });
});

describe('項目 6(c2) — jobs / usecases / external の阻害を、実パイプラインで T 群の側から確かめる', () => {
  it('jobs が阻害(壊れた仕様): T11 が副作用がジョブに依る操作の一致の証明を見ていないと名指す。未選択は行を出さない', async () => {
    const blocked = await verifyTree(ALL, breakFile('backend', 'jobs.md'));
    const unselected = await verifyTree(without('jobs'), removeFile('backend', 'jobs.md'));

    expect(rowsOf(blocked.lines, ['T11'])).toEqual([
      expect.stringContaining('T11: 阻害 — jobs を採っているが検査へ渡せない(読めない・壊れている。'),
    ]);
    expect(rowsOf(blocked.lines, ['T11'])[0]).toContain('ため、副作用がジョブに依る操作の一致の証明を生成できるかは見ていません。');
    expect(blocked.skipNotes).toContain(rowsOf(blocked.lines, ['T11'])[0]);
    expect(rowsOf(unselected.lines, ['T11'])).toEqual([]);
  });

  it('usecases が阻害(仕様を読めずに落とした): T11 と T12 が保存点に依る判定を見ていないと名指す。未選択は行を出さない', async () => {
    const blocked = await verifyTree(ALL, breakFile('frontend', 'usecases', 'stock_receipt.md'));
    const unselected = await verifyTree(without('usecases'));

    const rows = rowsOf(blocked.lines, ['T11', 'T12']);
    expect(rows.map((row) => row.slice(0, row.indexOf(':')))).toEqual(['T12', 'T11']);
    expect(rows.every((row) => row.includes(': 阻害 — usecases を採っているが検査へ渡せない('))).toBe(true);
    expect(rows[0]).toContain('ため、公開スキーマの土台より前に当たるべき保存点の migration の順序は見ていません。');
    expect(rows[1]).toContain('ため、保存点の一致の証明を生成できるかは見ていません。');
    expect(rowsOf(unselected.lines, ['T11', 'T12'])).toEqual([]);
  });

  it('external が阻害(壊れた仕様): T12 が受信の migration の順序を見ていないと名指す(X 群の側の行とは別に)。未選択は行を出さない', async () => {
    const blocked = await verifyTree(ALL, breakFile('backend', 'external.md'));
    const unselected = await verifyTree(without('external'), removeFile('backend', 'external.md'));

    expect(rowsOf(blocked.lines, ['T12'])).toEqual([
      expect.stringContaining('T12: 阻害 — external を採っているが検査へ渡せない('),
    ]);
    expect(rowsOf(blocked.lines, ['T12'])[0]).toContain('ため、公開スキーマの土台より前に当たるべき受信の migration の順序は見ていません。');
    expect(rowsOf(unselected.lines, ['T12'])).toEqual([]);
  });
});
