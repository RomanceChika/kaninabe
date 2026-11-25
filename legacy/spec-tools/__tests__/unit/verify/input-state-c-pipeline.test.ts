/**
 * 入力の状態の報告の残り(束 入力の状態-c)を、**実ローダー・実パイプラインを通して**確かめる。
 *
 *   1. テーブル仕様の選択と阻害が T 群へ end-to-end で伝わる(以前は T 群が available だけから「選択済み」に組み直し、阻害を見なかった)
 *   2. 画面の到達の関門(auth_spec の `gates`)が入力の状態で渡る(以前は生のまま渡され、阻害だと到達が広く見積もられた)
 *   3. T 群が裏づけに読むほかの種類(actions / surface)・X 群が読む外部連携が、阻害なら依る判定を出さず名指す
 *
 * 項目ごとに「未選択 / 阻害」の反例を見る。**未選択は事実(採っていないものは無い)・阻害は名指す**。読めているときの出力が変わらない
 * ことは、製品と 6 題材の verify の全文比較で見る(行は 1 本も出ない)。
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_STEPS } from '../../../lib/data/checks.js';
import { loadDataTableSpecModel } from '../../../lib/model/data/loader.js';
import { ALL, BROKEN, breakFile, findingsOf, removeFile, removeTrees, rowsOf, verifyTree, without } from '../../helpers/stores-pipeline.js';

afterEach(removeTrees);

/** テーブル仕様の置き場を差し替える。 */
const withTables =
  (placement: 'none' | 'broken' | 'one-more-broken') =>
  (specs: string): void => {
    const dir = path.join(specs, 'backend', 'data', 'tables');
    if (placement === 'one-more-broken') {
      writeFileSync(path.join(dir, 'broken.md'), BROKEN); // 読める表はそのまま残し、壊れた 1 枚だけを足す
      return;
    }
    rmSync(dir, { recursive: true, force: true });
    if (placement === 'none') return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'broken.md'), BROKEN);
  };

/** 登録の `needsWhole` で分けた T 群の段(登録の順)。 */
const WHOLE_IDS = DATA_STEPS.filter((step) => step.needsWhole).map((step) => step.id);
const SELF_CONTAINED_IDS = DATA_STEPS.filter((step) => !step.needsWhole).map((step) => step.id);

const T_BLOCKED = 'T1〜T18: 阻害 — data_tables を採っているが検査へ渡せない(';
const T_OLD_SKIP = 'T 群(テーブル仕様): specs/backend/data/tables が無いためスキップしました。';

describe('項目 1 — テーブル仕様の選択と阻害が T 群へ伝わる', () => {
  it('読めているとき(土台のまま)は実行し、阻害の行は出ない', async () => {
    const result = await verifyTree(ALL);

    expect(result.lines.some((line) => line.startsWith('T 群(テーブル仕様): data_table 14 件に対し T1〜T18'))).toBe(true);
    expect(result.lines.some((line) => line.startsWith('T1〜T18: '))).toBe(false);
  });

  it('未選択(置き場も無い): 従来のスキップの行だけ。阻害の行は出さない(採っていないなら正しく飛んだ)', async () => {
    const result = await verifyTree(without('data_tables'), withTables('none'));

    expect(result.lines).toContain(T_OLD_SKIP);
    expect(result.lines.some((line) => line.startsWith('T1〜T18: '))).toBe(false);
    expect(findingsOf(result.findings, 'T0')).toEqual([]);
  });

  it('阻害(壊れた表 1 枚だけ・読める表が 0 枚): 表の全体を前提とする段は止めて 1 本ずつ名指し、自己完結の段は読めた 0 件で実行する。T0 の error は読み込みの件数と一致(二重に数えない)', async () => {
    const result = await verifyTree(ALL, withTables('broken'));

    const rows = rowsOf(result.lines, WHOLE_IDS);
    expect(rows.map((row) => row.slice(0, row.indexOf(':')))).toEqual(WHOLE_IDS);
    for (const row of rows) {
      expect(row).toContain(': 阻害 — data_tables を採っているが検査へ渡せない(読めなかった仕様があってモデルが欠けている、または欠けていないと言えない');
      expect(row).toContain('ため、表の全体を前提とする判定(欠けた表が偽の指摘を生む)は見ていません');
      expect(result.skipNotes).toContain(row);
    }
    expect(result.lines).toContain(`T 群(テーブル仕様): 読めた data_table 0 件(読めずに落ちた表 1 件: broken.md)に対し ${SELF_CONTAINED_IDS.join('・')} を実行しました。`);
    expect(rowsOf(result.lines, ['T1〜T18'])).toEqual([]);
    const loaded = loadDataTableSpecModel(path.join(result.specs, 'backend', 'data', 'tables'), { repoRoot: result.repo });
    expect(findingsOf(result.findings, 'T0')).toHaveLength(loaded.findings.length);
    // 表が 0 枚のモデルで閉世界の段を回すと、実在するエンティティ全部に「表が無い」と偽の error を出す。止めているので出ない。
    expect(findingsOf(result.findings, 'T1')).toEqual([]);
  });

  it('阻害(読める表 14 枚 + 壊れた 1 枚): 自己完結の段は読めた 14 枚で実行し、全体を前提とする段だけ止める(土台の T 群の判定は偽の指摘で増えない)', async () => {
    const baseline = await verifyTree(ALL);
    const result = await verifyTree(ALL, withTables('one-more-broken'));

    expect(result.lines).toContain(`T 群(テーブル仕様): 読めた data_table 14 件(読めずに落ちた表 1 件: broken.md)に対し ${SELF_CONTAINED_IDS.join('・')} を実行しました。`);
    expect(rowsOf(result.lines, WHOLE_IDS)).toHaveLength(WHOLE_IDS.length);
    const tFindings = (findings: readonly { verifier: string }[]): string[] => findings.filter((finding) => /^T([1-9]|1[0-8])$/.test(finding.verifier)).map((finding) => finding.verifier);
    expect(tFindings(result.findings).sort()).toEqual(tFindings(baseline.findings).filter((id) => SELF_CONTAINED_IDS.includes(id)).sort());
  });

  it('阻害(置き場なし・uses にだけある): P2 の error と、T 群は見ていないという行(スキップの文言ではなく阻害の語で)', async () => {
    const result = await verifyTree(ALL, withTables('none'));

    expect(findingsOf(result.findings, 'P2').map((finding) => finding.severity)).toEqual(['error']);
    expect(rowsOf(result.lines, ['T1〜T18'])).toEqual([expect.stringContaining(`${T_BLOCKED}置き場に仕様が無い`)]);
    expect(result.lines).not.toContain(T_OLD_SKIP);
  });
});

describe('項目 2 — 画面の到達の関門(auth_spec)の入力の状態', () => {
  const READERS = ['S13', 'S16', 'Y3', 'Y5'];

  it('読めているとき(土台のまま)は行が出ない', async () => {
    const result = await verifyTree(ALL);

    expect(rowsOf(result.lines, READERS)).toEqual([]);
  });

  it('未選択(採っていなければ関門は無い事実): 到達を読む 4 本は行を出さない', async () => {
    const result = await verifyTree(without('auth'), removeFile('backend', 'auth.md'));

    expect(rowsOf(result.lines, READERS)).toEqual([]);
    expect(result.lines.some((line) => line.includes('auth を採っているが検査へ渡せない'))).toBe(false);
  });

  it('阻害(認証フロー仕様が壊れている): 到達を読む 4 本が「auth を採っているが検査へ渡せない」と名指す(広く見積もって黙らない)', async () => {
    const result = await verifyTree(ALL, breakFile('backend', 'auth.md'));

    const rows = rowsOf(result.lines, READERS);
    expect(rows.map((row) => row.slice(0, row.indexOf(':')))).toEqual(['S13', 'S16', 'Y3', 'Y5']);
    for (const row of rows) {
      expect(row).toContain(': 阻害 — auth を採っているが検査へ渡せない(');
      expect(result.skipNotes).toContain(row);
    }
    // 到達に依る判定は出していない(関門が分からないまま届く / 届かないを決めない)。
    expect(result.findings.filter((finding) => ['S13', 'S16', 'Y3'].includes(finding.verifier))).toEqual([]);
  });

  it('阻害(置き場なし・uses にだけある): 同じ 4 本が置き場に仕様が無いこととして名指す', async () => {
    const result = await verifyTree(ALL, removeFile('backend', 'auth.md'));

    const rows = rowsOf(result.lines, READERS);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.includes('auth を採っているが検査へ渡せない(置き場に仕様が無い'))).toBe(true);
  });
});

describe('項目 3 — T 群が裏づけに読む種類(actions / surface)・X 群が読む外部連携', () => {
  it('actions が阻害(壊れた仕様): T6 と T11 が依る判定を出さず名指す。未選択なら行は出ない', async () => {
    const blocked = await verifyTree(ALL, breakFile('backend', 'actions', 'broken.md'));
    const unselected = await verifyTree(without('actions'));

    const rows = rowsOf(blocked.lines, ['T6', 'T11']);
    expect(rows.map((row) => row.slice(0, row.indexOf(':')))).toEqual(['T6', 'T11']);
    expect(rows.every((row) => row.includes(': 阻害 — actions を採っているが検査へ渡せない('))).toBe(true);
    expect(rows.every((row) => blocked.skipNotes.includes(row))).toBe(true);
    expect(rowsOf(unselected.lines, ['T6', 'T11'])).toEqual([]);
    expect(findingsOf(blocked.findings, 'T11')).toEqual([]);
  });

  it('surface が阻害(置き場なし・uses にだけある): T12 が名指し、「grants_migration の宣言が無い」と誤報しない。未選択は従来どおり事実として error', async () => {
    const blocked = await verifyTree(ALL, removeFile('backend', 'surface.md'));
    const unselected = await verifyTree(without('surface'), removeFile('backend', 'surface.md'));

    const grants = (findings: readonly { readonly verifier: string; readonly message: string }[]) =>
      findings.filter((finding) => finding.verifier === 'T12' && finding.message.includes('grants_migration'));
    expect(rowsOf(blocked.lines, ['T12'])).toEqual([expect.stringContaining('T12: 阻害 — surface を採っているが検査へ渡せない(置き場に仕様が無い')]);
    expect(grants(blocked.findings)).toEqual([]);
    expect(rowsOf(unselected.lines, ['T12'])).toEqual([]);
    expect(grants(unselected.findings)).toHaveLength(1);
  });

  it('external が阻害(壊れた仕様): X 群は宣言を読む検査を見ていないと名指し、台帳だけを見る X4 は実行する。未選択は従来のスキップの行', async () => {
    const blocked = await verifyTree(ALL, breakFile('backend', 'external.md'));
    const unselected = await verifyTree(without('external'), removeFile('backend', 'external.md'));

    const rows = rowsOf(blocked.lines, ['X1〜X8']);
    expect(rows).toEqual([expect.stringContaining('X1〜X8: 阻害 — external を採っているが検査へ渡せない(')]);
    expect(rows[0]).toContain('ため、外部連携の宣言を読む検査(X1・X2・X3・X5・X6・X7・X8)は見ていません(台帳だけを見る検査は実行済み)。');
    expect(blocked.lines).toContain('X 群(外部連携カタログ): 宣言を読めないため、台帳だけを見る検査を実行しました。');
    expect(blocked.skipNotes).toContain(rows[0]);
    expect(unselected.lines).toContain('X 群(外部連携カタログ): specs/backend/external.md が無いためスキップしました。');
    expect(rowsOf(unselected.lines, ['X1〜X8'])).toEqual([]);
  });

  it('external が阻害(置き場なし・uses にだけある): スキップの文言ではなく「X1〜X8: 阻害 — …(置き場に仕様が無い)」で名指す', async () => {
    const result = await verifyTree(ALL, removeFile('backend', 'external.md'));

    expect(rowsOf(result.lines, ['X1〜X8'])).toEqual([expect.stringContaining('X1〜X8: 阻害 — external を採っているが検査へ渡せない(置き場に仕様が無い')]);
    expect(result.lines).not.toContain('X 群(外部連携カタログ): specs/backend/external.md が無いためスキップしました。');
  });
});
