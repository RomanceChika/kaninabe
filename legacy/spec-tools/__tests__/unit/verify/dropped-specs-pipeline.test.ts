/**
 * 「読み込みの error が 1 件でもあれば阻害」をやめ、**仕様をモデルから落としたときだけ阻害**にしたこと(部品化 ②-k)を、
 * 実ローダー・実パイプラインを通して確かめる。
 *
 * 阻害の意味は「モデルが欠けているので、無いことを主張する検査が誤報しうる」であって、「どこかに error がある」ではない。
 * id の不一致のように、仕様は読めていて違反だけがある形(A0 / S0 / T0 の error は読み込んだ側が従来どおり出す)では、
 * 読込済みとして検査を回し、**ほかの仕様の本物の違反を出す**。壊れて読めない 1 枚(フロントマターが無い等)は従来どおり阻害のまま
 * —— ②-j の A4 の誤報(「どのイベントも action_spec に無い」)が戻らないことを、同じ形で見る。
 *
 * 反例(いずれも題材 stores を一時ツリーへ写して 1 箇所ずつ壊す):
 *   e1: action_spec の id を 1 つずらし(A0 が 1 件)、別の action_spec を消す(A4 の本物の違反)
 *   e3: 画面の id を 1 つずらす(S0 が 1 件)→ 画面を使う検査(S13 / S16 / Y3 / Y5)の行が出ない
 *   e8: data_table の id を 1 つずらす(T0 が 1 件)→ テーブル仕様を使う 9 検査が阻害にならない
 */

import { TEST_VERIFY_INPUTS } from '../../helpers/platform.js';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runAllVerifications } from '../../../lib/compose/verify-pipeline.js';
import { TEST_ROOTS, writeProductDeclaration } from '../../helpers/product-roots.js';
import type { SpecKind } from '../../../lib/model/product/uses.js';

const STORES = path.join(fileURLToPath(new URL('../../fixtures/samples/', import.meta.url)), 'stores', 'docs', 'specs');
/** 題材 stores が採る種類(その `product.md` と同じ)。 */
const STORES_USES: readonly SpecKind[] = [
  'actions', 'queries', 'data_tables', 'notifications', 'jobs', 'config', 'auth', 'external', 'surface', 'screens', 'usecases',
];

const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 仕様の木を一時ツリーへ写し、宣言を置き、`tree` で壊してから実パイプラインを回す。 */
async function verifyTree(tree: (specs: string) => void) {
  const repo = mkdtempSync(path.join(tmpdir(), 'dropped-specs-'));
  created.push(repo);
  writeProductDeclaration(repo, STORES_USES);
  const specs = path.join(repo, TEST_ROOTS.specs);
  cpSync(STORES, specs, { recursive: true });
  tree(specs);
  const lines: string[] = [];
  const result = await runAllVerifications({ ...TEST_VERIFY_INPUTS, domainRoot: path.join(specs, 'domain'), log: (line) => lines.push(line) });
  return { ...result, lines, specs };
}

/** 1 つのファイルの 1 箇所を書き換える(書き換え前の文字列が無ければ落とす = 反例が反例でなくなるのを防ぐ)。 */
function rewrite(file: string, from: string, to: string): void {
  const source = readFileSync(file, 'utf8');
  if (!source.includes(from)) throw new Error(`${file} に ${from} が無い`);
  writeFileSync(file, source.replace(from, to));
}

const findingsOf = <T extends { verifier: string }>(findings: readonly T[], id: string): T[] => findings.filter((finding) => finding.verifier === id);

/** 検査器 ID の阻害・未実施の行(`ID: 阻害 — …` / `ID: 未実施 — …`)。 */
const gapRows = (lines: readonly string[]): string[] => lines.filter((line) => /^[A-Z]+\d+: (未実施|阻害) — /.test(line));

describe('読み込みの error があっても、仕様を落としていなければ検査を回す', () => {
  it('e1: action_spec の id の不一致(A0 が 1 件)があっても、A 群は走り、別の仕様の本物の違反(A4)を出す', async () => {
    const result = await verifyTree((specs) => {
      rewrite(path.join(specs, 'backend', 'actions', 'sales_order', 'pay.md'), 'id: sales_order-pay-action', 'id: sales_order-pay-action-x');
      rmSync(path.join(specs, 'backend', 'actions', 'sales_order', 'cancel.md'));
    });

    expect(findingsOf(result.findings, 'A0')).toHaveLength(1);
    const line = result.lines.find((entry) => entry.startsWith('A 群(仕様⇔テストのトレース): '));
    expect(line).toContain('を実行しました');
    expect(line).not.toContain('スキップしました');
    expect(findingsOf(result.findings, 'A4').some((finding) => finding.message.includes('sales_order.cancel'))).toBe(true);
    expect(gapRows(result.lines).filter((row) => /^(A\d+|V1[678]): 阻害/.test(row))).toEqual([]);
  });

  it('e3: 画面の id の不一致(S0 が 1 件)があっても、S13 / S16 / Y3 / Y5 の阻害の行は出ない(画面は読めている)', async () => {
    const result = await verifyTree((specs) => {
      rewrite(path.join(specs, 'frontend', 'screens', 'store', 'store_list.md'), 'id: screen-store-list', 'id: screen-store-list-x');
    });

    expect(findingsOf(result.findings, 'S0')).toHaveLength(1);
    expect(gapRows(result.lines).filter((row) => /^(S13|S16|Y3|Y5): /.test(row))).toEqual([]);
  });

  it('e8: data_table の id の不一致(T0 が 1 件)があっても、テーブル仕様を使う検査は阻害にならない', async () => {
    const result = await verifyTree((specs) => {
      rewrite(path.join(specs, 'backend', 'data', 'tables', 'stores.md'), 'id: table-stores', 'id: table-stores-x');
    });

    expect(findingsOf(result.findings, 'T0')).toHaveLength(1);
    expect(gapRows(result.lines).filter((row) => /^(V17|V19|A15|A18|A19|X1|Y8|Y10|Y12|X5): /.test(row))).toEqual([]);
  });
});

describe('仕様を落としたとき(読めずに捨てた 1 枚)は従来どおり阻害のまま(誤報を出さない)', () => {
  it('壊れて読めない action_spec が 1 枚あれば、A 群は飛び、A4 は「どのイベントも action_spec に無い」と誤報しない', async () => {
    const result = await verifyTree((specs) => {
      writeFileSync(path.join(specs, 'backend', 'actions', 'sales_order', 'broken.md'), '# フロントマターの無い仕様\n');
    });

    const line = result.lines.find((entry) => entry.startsWith('A 群(仕様⇔テストのトレース): '));
    expect(line).toContain('action_spec が前提の検査はスキップしました');
    expect(findingsOf(result.findings, 'A4')).toEqual([]);
  });

  it('壊れて読めない画面が 1 枚あれば、S13 は阻害の行で言う(判定は出さない)', async () => {
    const result = await verifyTree((specs) => {
      writeFileSync(path.join(specs, 'frontend', 'screens', 'store', 'broken.md'), '# フロントマターの無い仕様\n');
    });

    expect(gapRows(result.lines).some((row) => row.startsWith('S13: 阻害 — screens'))).toBe(true);
  });

  it('壊れて読めない data_table が 1 枚あれば、テーブル仕様を使う検査は阻害の行で言う', async () => {
    const result = await verifyTree((specs) => {
      writeFileSync(path.join(specs, 'backend', 'data', 'tables', 'broken.md'), '# フロントマターの無い仕様\n');
    });

    expect(gapRows(result.lines).some((row) => row.startsWith('Y8: 阻害 — data_tables'))).toBe(true);
  });

  it('表の中で行を落とした data_table は、確認の要否の導出を読む S19 / U1 / Y5 が「落とした表は見ていません」と表の名前つきで言い、T 群の要約行も落ちた表を名指す', async () => {
    const result = await verifyTree((specs) => {
      const file = path.join(specs, 'backend', 'data', 'tables', 'stores.md');
      rewrite(file, '  - column: manager_id\n    references: staff_members\n', '  - column: manager_id\n');
    });

    const rows = gapRows(result.lines).filter((row) => /^(S19|U1|Y5): 阻害 — data_tables/.test(row));
    expect(rows.map((row) => row.slice(0, 3))).toEqual(['S19', 'U1:', 'Y5:']);
    for (const row of rows) expect(row).toContain('(対象 1 件: stores)');
    expect(result.lines.some((line) => line.startsWith('T 群(テーブル仕様): 読めた data_table ') && line.includes('読めずに落ちた表 1 件: stores.md'))).toBe(true);
  });
});
