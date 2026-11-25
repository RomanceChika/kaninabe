/**
 * 入力の状態の報告の残り(部品化 ②-j)を、**実ローダー・実パイプラインを通して**確かめる。
 *
 *   1. actions を採っていない製品で、置き場が無いと A0 の error が 1 件出ていた不具合(`uses` に無いのに読み込みを試みていた)
 *   2. `runTrace` の action_spec が未選択と阻害を区別しなかった(群ごと飛んだ行が、どちらも「specs/backend/actions が無いため」と言っていた)
 *   3. ユースケース群(Y8 / Y10 / Y12)・外部連携群(X5)がテーブル仕様を任意の欄 / 生のモデルで読んでいた
 *
 * 項目ごとに「未選択 / 阻害 / 読込済み 0 件」の 3 反例を見る。**未選択も阻害も、その検査は判定を出さず、見ていないことを行で言う**
 * (母集合が保存点・受信の連携で、テーブル仕様は裏づけを見る先なので、未選択も「見られない」)。読込済み 0 件は実行する。
 * 読めているときの判定が変わっていないことは、製品と 6 題材の verify の全文比較で見る(行は 1 本も出ない)。
 * 項目 4(usecases を採っていない製品に S16 / Y3 / Y5 の行を出さない)は `reachability-gaps-pipeline.test.ts` が持つ。
 */

import { TEST_VERIFY_INPUTS } from '../../helpers/platform.js';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { runAllVerifications } from '../../../lib/compose/verify-pipeline.js';
import { loadActionSpecModel } from '../../../lib/model/trace/loader.js';
import { loadDataTableSpecModel } from '../../../lib/model/data/loader.js';
import { TEST_ROOTS, writeProductDeclaration } from '../../helpers/product-roots.js';
import type { SpecKind } from '../../../lib/model/product/uses.js';

const SAMPLES = fileURLToPath(new URL('../../fixtures/samples/', import.meta.url));
const DUAL_ACTORS = path.join(SAMPLES, 'dual_actors', 'docs', 'specs');
const STORES = path.join(SAMPLES, 'stores', 'docs', 'specs');

/** 作った一時ツリー(後片付けのため)。 */
const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 壊れた仕様(フロントマターが無い)。 */
const BROKEN = '# フロントマターの無い仕様\n';

/** 仕様の木を一時ツリーへ写し、宣言を置き、実パイプラインを回す(`tree` で写した木を触れる)。 */
async function verifyTree(base: string, uses: readonly SpecKind[], tree: (specs: string) => void) {
  const repo = mkdtempSync(path.join(tmpdir(), 'optional-readers-'));
  created.push(repo);
  writeProductDeclaration(repo, uses);
  const specs = path.join(repo, TEST_ROOTS.specs);
  cpSync(base, specs, { recursive: true });
  tree(specs);
  const lines: string[] = [];
  const result = await runAllVerifications({ ...TEST_VERIFY_INPUTS, domainRoot: path.join(specs, 'domain'), log: (line) => lines.push(line) });
  return { ...result, lines, repo, specs };
}

/** 検査器 ID で始まる行(未実施 / 阻害)。 */
const rowsOf = (lines: readonly string[], ids: readonly string[]): string[] =>
  lines.filter((line) => ids.some((id) => line.startsWith(`${id}: `)) && /: (未実施|阻害) — /.test(line));

/** 行の検査器 ID。 */
const idOf = (row: string): string => row.slice(0, row.indexOf(':'));

/** 各検査器の Finding。 */
const findingsOf = <T extends { verifier: string }>(findings: readonly T[], id: string): T[] => findings.filter((finding) => finding.verifier === id);

describe('actions(項目 1・2)— 採っていない種類は読み込まない・群ごと飛んだ理由を言い分ける', () => {
  /** 土台(dual_actors)の action_spec の置き場を差し替える。 */
  const withActions =
    (placement: 'base' | 'none' | 'empty' | 'broken') =>
    (specs: string): void => {
      const dir = path.join(specs, 'backend', 'actions');
      if (placement === 'base') return;
      const readme = readFileSync(path.join(dir, 'README.md'));
      rmSync(dir, { recursive: true, force: true });
      if (placement === 'none') return;
      mkdirSync(dir, { recursive: true });
      if (placement === 'empty') writeFileSync(path.join(dir, 'README.md'), readme);
      if (placement === 'broken') writeFileSync(path.join(dir, 'broken.md'), BROKEN);
    };

  /** A 群の要約行(群ごと実行した / 飛んだ)。 */
  const groupLine = (lines: readonly string[]): string | undefined => lines.find((line) => line.startsWith('A 群(仕様⇔テストのトレース): '));

  it('(i) 未選択・置き場なし: A0 の error は出ない(採っていないなら無くて正しい)。A 群は「採っていない」ためとして飛ぶ', async () => {
    const result = await verifyTree(DUAL_ACTORS, [], withActions('none'));

    expect(findingsOf(result.findings, 'A0')).toEqual([]);
    expect(findingsOf(result.findings, 'P2')).toEqual([]);
    const line = groupLine(result.lines);
    expect(line).toContain('製品が actions を採っていない(product.md の uses に無い)ため、action_spec が前提の検査はスキップしました');
    expect(line).not.toContain('specs/backend/actions が無い');
    expect(result.skipNotes).toContain(line);
  });

  it('(i) 未選択・置き場にはある: 読み込まない(P2 が「あるのに採っていない」を 1 回言い、A 群は未選択として飛ぶ)', async () => {
    const result = await verifyTree(DUAL_ACTORS, [], withActions('base'));

    expect(findingsOf(result.findings, 'P2').map((finding) => finding.message)).toEqual([
      expect.stringContaining('actions の仕様が置き場'),
    ]);
    expect(groupLine(result.lines)).toContain('製品が actions を採っていない(product.md の uses に無い)ため');
    // 採っていなければ、action_spec が前提の検査(A1〜A8 ほか)は 1 本も走らない。
    expect(result.findings.filter((finding) => /^A([1-9]|1[0-2])$/.test(finding.verifier))).toEqual([]);
  });

  it('(ii) 阻害・置き場なし: P2 と A0 が従来どおり言い(読み込みの診断は 1 回)、A 群は「採っているが渡せない」ためとして飛ぶ', async () => {
    const result = await verifyTree(DUAL_ACTORS, ['actions'], withActions('none'));

    expect(findingsOf(result.findings, 'P2').map((finding) => finding.severity)).toEqual(['error']);
    expect(findingsOf(result.findings, 'A0')).toHaveLength(1);
    const line = groupLine(result.lines);
    expect(line).toContain('actions を採っているが検査へ渡せない(置き場に仕様が無い');
    expect(line).toContain('ため、action_spec が前提の検査はスキップしました');
  });

  it('(ii) 阻害・壊れた仕様: A0 は読み込みの件数と一致(二重に数えない)。A 群は「読めなかった仕様がありモデルが欠けている」ため飛ぶ', async () => {
    const result = await verifyTree(DUAL_ACTORS, ['actions'], withActions('broken'));

    const loaded = loadActionSpecModel(path.join(result.specs, 'backend', 'actions'), { repoRoot: result.repo });
    expect(loaded.findings.length).toBeGreaterThan(0);
    expect(findingsOf(result.findings, 'A0')).toHaveLength(loaded.findings.length);
    expect(groupLine(result.lines)).toContain('actions を採っているが検査へ渡せない(読めなかった仕様があってモデルが欠けている、または欠けていないと言えない');
    // 読めなかった仕様のイベントを「どの action_spec にも無い」と誤報しない(部分のモデルで A 群を回さない)。
    expect(findingsOf(result.findings, 'A4')).toEqual([]);
  });

  it('(iii) 読込済み 0 件: A 群は 0 件に対して実行される(飛んだと言わない)', async () => {
    const result = await verifyTree(DUAL_ACTORS, ['actions'], withActions('empty'));

    expect(findingsOf(result.findings, 'A0')).toEqual([]);
    const line = groupLine(result.lines);
    expect(line).toContain('action_spec 0 件に対し');
    expect(line).toContain('を実行しました');
    expect(line).not.toContain('スキップしました');
  });

  it('読み込めているとき(土台のまま)の A 群は従来どおり実行される', async () => {
    const result = await verifyTree(DUAL_ACTORS, ['actions'], withActions('base'));

    expect(groupLine(result.lines)).toContain('action_spec 2 件に対し');
    expect(findingsOf(result.findings, 'A0')).toEqual([]);
  });
});

describe('data_tables(項目 3)— ユースケース群(Y8 / Y10 / Y12)・外部連携群(X5)', () => {
  const READERS = ['Y8', 'Y10', 'Y12', 'X5'];
  /** 土台(stores)が採る種類。 */
  const ALL: readonly SpecKind[] = ['actions', 'queries', 'data_tables', 'notifications', 'jobs', 'config', 'auth', 'external', 'surface', 'screens', 'usecases'];
  const WITHOUT_TABLES = ALL.filter((kind) => kind !== 'data_tables');

  /** テーブル仕様の置き場を差し替える。 */
  const withTables =
    (placement: 'base' | 'none' | 'empty' | 'broken') =>
    (specs: string): void => {
      if (placement === 'base') return;
      const dir = path.join(specs, 'backend', 'data', 'tables');
      rmSync(dir, { recursive: true, force: true });
      if (placement === 'none') return;
      mkdirSync(dir, { recursive: true });
      if (placement === 'empty') writeFileSync(path.join(dir, 'README.md'), '# テーブル仕様(0 件)\n');
      if (placement === 'broken') writeFileSync(path.join(dir, 'broken.md'), BROKEN);
    };

  it('読めているとき(土台のまま)は 4 本とも実行され、行は出ない', async () => {
    const result = await verifyTree(STORES, ALL, withTables('base'));

    expect(rowsOf(result.lines, READERS)).toEqual([]);
    expect(result.lines.some((line) => line.startsWith('Y 群(ユースケース仕様): usecase_spec 2 件'))).toBe(true);
  });

  it('(i) 未選択: Y8 / Y10 / Y12 / X5 が未実施の行で出て、保存点・受信の連携を名指し、範囲が縮んだ報告として数えられる', async () => {
    const result = await verifyTree(STORES, WITHOUT_TABLES, withTables('none'));

    const rows = rowsOf(result.lines, READERS);
    expect(rows.map(idOf)).toEqual(['X5', 'Y8', 'Y10', 'Y12']);
    for (const row of rows) {
      expect(row).toContain(': 未実施 — 製品が data_tables を採っていない(product.md の uses に無い)ため、');
      expect(row).toMatch(/\(対象 \d+ 件: /);
      expect(result.skipNotes).toContain(row);
    }
    expect(rows[0]).toMatch(/\(対象 1 件: /);
    expect(rows[1]).toContain('order_intake.');
    // 読み込みの診断は出ない(置き場を消したので「採っていない」が事実)。**受信の連携があるのにテーブル仕様を採らない食い違い**は、
    // 宣言の段(P2)が 1 件だけ error にする(X5 の裏づけの接地先が「無い」と読まれて黙る形を、行の沈黙に任せない)。
    expect(result.findings.filter((finding) => finding.verifier === 'T0')).toEqual([]);
    expect(result.findings.filter((finding) => finding.verifier === 'P2').map((finding) => finding.counterexample)).toEqual([
      { kind: 'external', requires: 'data_tables' },
    ]);
    // 見ていない判定は出していない(「RPC が無い」を導かない)。
    expect(result.findings.filter((finding) => ['Y8', 'Y10', 'Y12', 'X5'].includes(finding.verifier))).toEqual([]);
  });

  it('(ii) 阻害(壊れた表 1 枚): 同じ 4 本が阻害の行で出て、T0 の error は読み込みの件数と一致(二重に数えない)', async () => {
    const result = await verifyTree(STORES, ALL, withTables('broken'));

    const rows = rowsOf(result.lines, READERS);
    expect(rows.map(idOf)).toEqual(['X5', 'Y8', 'Y10', 'Y12']);
    for (const row of rows) {
      expect(row).toContain(': 阻害 — data_tables を採っているが検査へ渡せない(読めなかった仕様があってモデルが欠けている、または欠けていないと言えない');
      expect(result.skipNotes).toContain(row);
    }
    const loaded = loadDataTableSpecModel(path.join(result.specs, 'backend', 'data', 'tables'), { repoRoot: result.repo });
    const t0 = findingsOf(result.findings, 'T0');
    expect(t0.length).toBeGreaterThan(0);
    expect(t0).toHaveLength(loaded.findings.length);
    expect(result.findings.filter((finding) => ['Y8', 'Y10', 'Y12', 'X5'].includes(finding.verifier))).toEqual([]);
  });

  it('(ii) 阻害(置き場なし・uses にだけある): P2 の error と阻害の行(置き場に仕様が無い)', async () => {
    const result = await verifyTree(STORES, ALL, withTables('none'));

    expect(findingsOf(result.findings, 'P2').map((finding) => finding.severity)).toEqual(['error']);
    expect(rowsOf(result.lines, ['Y8'])).toEqual([expect.stringContaining('Y8: 阻害 — data_tables を採っているが検査へ渡せない(置き場に仕様が無い')]);
  });

  it('(iii) 読込済み 0 件: 行は出ず、4 本は 0 件の表に対して判定する(0 件を検査したことは、検査しなかったことと違う)', async () => {
    const result = await verifyTree(STORES, ALL, withTables('empty'));

    expect(rowsOf(result.lines, READERS)).toEqual([]);
    // 表が 0 件なので、保存点の RPC は見つからないと判定される(判定を出す側に回っている)。
    expect(findingsOf(result.findings, 'Y8').length).toBeGreaterThan(0);
  });

  it('ユースケース仕様も外部連携も無い製品には行を出さない(母集合が無い)', async () => {
    const result = await verifyTree(DUAL_ACTORS, ['actions'], () => undefined);

    expect(rowsOf(result.lines, READERS)).toEqual([]);
  });
});
