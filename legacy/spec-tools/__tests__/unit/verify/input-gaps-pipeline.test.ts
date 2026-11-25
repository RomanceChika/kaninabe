/**
 * 残りの任意の入力 3 つ(テーブル仕様・外部連携・action_spec)の「未選択 / 阻害 / 読込済み 0 件」を、
 * **実ローダー・実パイプラインを通して**確かめる(部品化 ②-i)。
 *
 * 土台は action_spec とドメインだけを持つ製品の仕様の木(`samples/dual_actors`)で、`uses` と各種類の置き場だけを変えて
 * `runAllVerifications` を回し、実行ログの行と全体の Finding を見る。入力ごとに 3 反例:
 *
 *   | 入力 | (i) 未選択 | (ii) 阻害(採ったのに壊れている / 無い) | (iii) 読込済み 0 件 |
 *   |---|---|---|---|
 *   | data_tables | A15 / A18 / V17 / V19 が未実施の行(見ていない) | 同じ検査が阻害の行・T0 の error は 1 回だけ | 行は出ない |
 *   | external | **行を出さない**(第 3 の発火元は無い = 事実)。A10 は 2 本の母集合で判定する | 判定(走査の宣言が無いイベント)を出さず阻害の行・X0 の error は 1 回だけ | 行は出ない・A10 は判定する |
 *   | actions | **行を出さない**(入力に現れる欄も計算値も無い = 事実) | V16 / V17 / V18 が阻害の行・A0 の error は 1 回だけ | 行は出ない |
 *
 * 「未選択 = 事実として無い」と「阻害 = 分からない」の区別が、このテストの要である(間違えると、受信を採っていない製品に
 * 未実施の行が出るか、読めていない受信のせいで走査の宣言が無いと誤報が出る)。
 */

import { TEST_VERIFY_INPUTS } from '../../helpers/platform.js';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runAllVerifications } from '../../../lib/compose/verify-pipeline.js';
import { loadExternalSpecModel } from '../../../lib/model/external/loader.js';
import { loadDataTableSpecModel } from '../../../lib/model/data/loader.js';
import { loadActionSpecModel } from '../../../lib/model/trace/loader.js';
import { TEST_ROOTS, writeProductDeclaration } from '../../helpers/product-roots.js';
import type { SpecKind } from '../../../lib/model/product/uses.js';

const BASE = fileURLToPath(new URL('../../fixtures/samples/dual_actors/docs/specs', import.meta.url));

/** 作った一時ツリー(後片付けのため)。 */
const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 置き場の中身(種類によらず共通)。 */
type Placement = 'none' | 'empty' | 'broken';

/** 壊れた仕様(フロントマターが無い)。 */
const BROKEN = '# フロントマターの無い仕様\n';

/** 外部連携が 0 件の、スキーマに適合する最小のカタログ。 */
const EMPTY_EXTERNAL = [
  '---',
  'doc_type: external_spec',
  'scope: backend',
  'id: external-catalog',
  '',
  'vocabulary:',
  '  service:',
  '    - id: sample_service',
  '      label: 試験用の相手',
  '      adapter_root: app/src/infrastructure/sample_service',
  '',
  'integrations: []',
  '',
  'test_cases: []',
  '---',
  '',
  '# 空の外部連携カタログ',
  '',
].join('\n');

/** 土台の顧客の状態機械に system が起こすイベント(`expire`)を足す(A10 の判定の材料)。 */
function addSystemEvent(statesMd: string): string {
  return statesMd.replace(
    '    otherwise_forbidden: 停止できるのは本登録の顧客だけ\n',
    [
      '    otherwise_forbidden: 停止できるのは本登録の顧客だけ',
      '  - id: expire',
      '    label: 期限切れにする',
      '    from: [provisional]',
      '    to: suspended',
      '    by: [system]',
      '    otherwise_forbidden: 期限切れにできるのは仮登録の顧客だけ',
      '',
    ].join('\n'),
  );
}

/** 一時ツリーの作り方。 */
interface Scenario {
  readonly uses: readonly SpecKind[];
  /** action_spec の置き場(`base` = 土台のまま)。 */
  readonly actions?: 'base' | Placement;
  readonly dataTables?: Placement;
  readonly external?: Placement;
  /** 顧客に system が起こすイベントを足す(A10 が判定する材料)。 */
  readonly systemEvent?: boolean;
}

/** 土台の仕様の木を一時ツリーへ写し、`uses` と各置き場を差して実パイプラインを回す。 */
async function verifyWith(scenario: Scenario) {
  const repo = mkdtempSync(path.join(tmpdir(), 'input-gaps-'));
  created.push(repo);
  writeProductDeclaration(repo, scenario.uses);
  const specs = path.join(repo, TEST_ROOTS.specs);
  cpSync(BASE, specs, { recursive: true });
  const backend = path.join(specs, 'backend');

  const actionsPlacement = scenario.actions ?? 'base';
  const actionsDir = path.join(backend, 'actions');
  if (actionsPlacement !== 'base') rmSync(actionsDir, { recursive: true, force: true });
  if (actionsPlacement === 'empty') {
    mkdirSync(actionsDir, { recursive: true });
    writeFileSync(path.join(actionsDir, 'README.md'), readFileSync(path.join(BASE, 'backend', 'actions', 'README.md')));
  }
  if (actionsPlacement === 'broken') {
    mkdirSync(actionsDir, { recursive: true });
    writeFileSync(path.join(actionsDir, 'broken.md'), BROKEN);
  }

  const tablesDir = path.join(backend, 'data', 'tables');
  if (scenario.dataTables === 'empty') {
    mkdirSync(tablesDir, { recursive: true });
    writeFileSync(path.join(tablesDir, 'README.md'), '# テーブル仕様(0 件)\n');
  }
  if (scenario.dataTables === 'broken') {
    mkdirSync(tablesDir, { recursive: true });
    writeFileSync(path.join(tablesDir, 'broken.md'), BROKEN);
  }

  if (scenario.external === 'empty') writeFileSync(path.join(backend, 'external.md'), EMPTY_EXTERNAL);
  if (scenario.external === 'broken') writeFileSync(path.join(backend, 'external.md'), BROKEN);

  if (scenario.systemEvent === true) {
    const statesFile = path.join(specs, 'domain', 'customer', 'states.md');
    writeFileSync(statesFile, addSystemEvent(readFileSync(statesFile, 'utf8')));
  }

  const lines: string[] = [];
  const result = await runAllVerifications({ ...TEST_VERIFY_INPUTS, domainRoot: path.join(specs, 'domain'), log: (line) => lines.push(line) });
  return {
    ...result,
    lines,
    loadedTables: loadDataTableSpecModel(tablesDir, { repoRoot: repo }),
    loadedExternal: loadExternalSpecModel(path.join(backend, 'external.md'), { repoRoot: repo }),
    loadedActions: loadActionSpecModel(actionsDir, { repoRoot: repo }),
  };
}

/** 検査器 ID で始まる行(未実施 / 阻害)。 */
const rowsOf = (lines: readonly string[], ids: readonly string[]): string[] =>
  lines.filter((line) => ids.some((id) => line.startsWith(`${id}: `)) && /: (未実施|阻害) — /.test(line));

/** 各検査器の Finding。 */
const findingsOf = <T extends { verifier: string }>(findings: readonly T[], id: string): T[] => findings.filter((finding) => finding.verifier === id);

/** 入力の名前(`actions` / `data_tables` / `external`)を言っている行だけ(同じ検査が 2 つの入力に依ることがある。V17)。 */
const aboutInput = (rows: readonly string[], input: string): string[] => rows.filter((row) => row.includes(`${input} を採って`));

const TABLE_DEPENDENTS = ['A15', 'A18', 'A19', 'V17', 'V19'];

describe('data_tables — テーブル仕様(A15 / A18 / A19 / V17 / V19)', () => {
  it('(i) 未選択: 見ていない検査が未実施の行で出て、範囲が縮んだ報告として数えられる(T0 も P2 も出ない)', async () => {
    const result = await verifyWith({ uses: ['actions'] });

    const rows = rowsOf(result.lines, TABLE_DEPENDENTS);
    expect(rows.map((row) => row.slice(0, row.indexOf(':')))).toEqual(['V17', 'V19', 'A15', 'A18']);
    for (const row of rows) {
      expect(row).toContain(': 未実施 — 製品が data_tables を採っていない(product.md の uses に無い)ため、');
      expect(result.skipNotes).toContain(row);
    }
    expect(result.findings.filter((finding) => ['T0', 'P2'].includes(finding.verifier))).toEqual([]);
  });

  it('(ii) 阻害: 同じ検査が阻害の行で出て、T0 の error は従来どおり 1 回だけ数える(二重に数えない)', async () => {
    const result = await verifyWith({ uses: ['actions', 'data_tables'], dataTables: 'broken' });

    const rows = rowsOf(result.lines, TABLE_DEPENDENTS);
    expect(rows.map((row) => row.slice(0, row.indexOf(':')))).toEqual(['V17', 'V19', 'A15', 'A18']);
    for (const row of rows) {
      expect(row).toContain(': 阻害 — data_tables を採っているが検査へ渡せない(読めなかった仕様があってモデルが欠けている、または欠けていないと言えない');
      expect(result.skipNotes).toContain(row);
    }
    const t0 = findingsOf(result.findings, 'T0');
    expect(t0.length).toBeGreaterThan(0);
    expect(t0).toHaveLength(result.loadedTables.findings.length);
  });

  it('(ii) 阻害(置き場なし): uses にあるのに無ければ P2 の error と阻害の行(置き場に仕様が無い)', async () => {
    const result = await verifyWith({ uses: ['actions', 'data_tables'] });

    expect(rowsOf(result.lines, ['A15'])).toEqual([expect.stringContaining('A15: 阻害 — data_tables を採っているが検査へ渡せない(置き場に仕様が無い')]);
    expect(findingsOf(result.findings, 'P2').map((finding) => finding.severity)).toEqual(['error']);
  });

  it('(iii) 読込済み 0 件: 行は出ない(0 件を検査したことは、検査しなかったことと違う)', async () => {
    const result = await verifyWith({ uses: ['actions', 'data_tables'], dataTables: 'empty' });

    expect(result.loadedTables.findings).toEqual([]);
    expect(result.loadedTables.model.available).toBe(true);
    expect(rowsOf(result.lines, TABLE_DEPENDENTS)).toEqual([]);
  });
});

describe('external — 外部連携(A10 の第 3 の発火元)', () => {
  const A10_EVENT = /expire/;

  it('(i) 未選択: 行を出さない(第 3 の発火元は無い = 事実)。A10 は 2 本の母集合で判定し、走査の宣言が無いイベントを報告する', async () => {
    const result = await verifyWith({ uses: ['actions'], systemEvent: true });

    expect(rowsOf(result.lines, ['A10'])).toEqual([]);
    expect(result.skipNotes.some((note) => note.startsWith('A10:'))).toBe(false);
    const a10 = findingsOf(result.findings, 'A10');
    expect(a10).toHaveLength(1);
    expect(a10[0]?.message).toMatch(A10_EVENT);
    expect(a10[0]?.message).toContain('走査の実装宣言(scans)がありません');
  });

  it('(ii) 阻害: 走査の宣言が無いイベントの判定だけを出さず、阻害の行が対象を名指す。X0 の error は 1 回だけ数える', async () => {
    const result = await verifyWith({ uses: ['actions', 'external'], external: 'broken', systemEvent: true });

    // 誤報(「起こす口が無い」)を出さない —— 受信がそのイベントを起こしているかもしれない。
    expect(findingsOf(result.findings, 'A10')).toEqual([]);
    const rows = rowsOf(result.lines, ['A10']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('A10: 阻害 — external を採っているが検査へ渡せない(読めない・壊れている');
    expect(rows[0]).toContain('第 3 の発火元');
    expect(rows[0]).toMatch(/対象 1 件: .*expire/);
    expect(result.skipNotes).toContain(rows[0]);

    const x0 = findingsOf(result.findings, 'X0');
    expect(x0.length).toBeGreaterThan(0);
    expect(x0).toHaveLength(result.loadedExternal.findings.length);
  });

  it('(ii) 阻害でも、走査の宣言が全部あれば出さなかった判定は無いので行は出ない(対象が 1 件も無い)', async () => {
    const result = await verifyWith({ uses: ['actions', 'external'], external: 'broken' });

    expect(rowsOf(result.lines, ['A10'])).toEqual([]);
  });

  it('(iii) 読込済み 0 件: 行は出ず、A10 は判定する(受信が 0 件なので第 3 の発火元は無い)', async () => {
    const result = await verifyWith({ uses: ['actions', 'external'], external: 'empty', systemEvent: true });

    expect(result.loadedExternal.findings).toEqual([]);
    expect(rowsOf(result.lines, ['A10'])).toEqual([]);
    expect(findingsOf(result.findings, 'A10').map((finding) => finding.message)).toEqual([
      expect.stringContaining('走査の実装宣言(scans)がありません'),
    ]);
  });
});

describe('actions — action_spec(V16 / V17 / V18)', () => {
  const ACTION_DEPENDENTS = ['V16', 'V17', 'V18'];

  it('(i) 未選択: V 群の行を出さない(入力に現れる欄も計算値も無い = 事実。空の母集合で判定する)', async () => {
    const result = await verifyWith({ uses: [], actions: 'none' });

    expect(aboutInput(rowsOf(result.lines, ACTION_DEPENDENTS), 'actions')).toEqual([]);
    expect(result.lines.some((line) => line.startsWith('V 群'))).toBe(true);
  });

  it('(ii) 阻害: V16 / V17 / V18 が阻害の行で出て、A0 の error は従来どおり 1 回だけ数える', async () => {
    const result = await verifyWith({ uses: ['actions'], actions: 'broken' });

    const rows = aboutInput(rowsOf(result.lines, ACTION_DEPENDENTS), 'actions');
    expect(rows.map((row) => row.slice(0, row.indexOf(':')))).toEqual(['V16', 'V17', 'V18']);
    for (const row of rows) {
      expect(row).toContain(': 阻害 — actions を採っているが検査へ渡せない(読めなかった仕様があってモデルが欠けている、または欠けていないと言えない');
      expect(result.skipNotes).toContain(row);
    }
    const a0 = findingsOf(result.findings, 'A0');
    expect(a0.length).toBeGreaterThan(0);
    expect(a0).toHaveLength(result.loadedActions.findings.length);
  });

  it('(ii) 阻害(置き場なし): uses にあるのに無ければ P2 の error と阻害の行(置き場に仕様が無い)', async () => {
    const result = await verifyWith({ uses: ['actions'], actions: 'none' });

    expect(rowsOf(result.lines, ['V16'])).toEqual([expect.stringContaining('V16: 阻害 — actions を採っているが検査へ渡せない(置き場に仕様が無い')]);
    expect(findingsOf(result.findings, 'P2').map((finding) => finding.severity)).toEqual(['error']);
  });

  it('(iii) 読込済み 0 件: 行は出ない', async () => {
    const result = await verifyWith({ uses: ['actions'], actions: 'empty' });

    expect(result.loadedActions.findings).toEqual([]);
    expect(aboutInput(rowsOf(result.lines, ACTION_DEPENDENTS), 'actions')).toEqual([]);
  });
});
