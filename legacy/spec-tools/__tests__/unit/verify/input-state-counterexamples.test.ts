/**
 * 入力の状態の 3 反例を、**実ローダー・実パイプラインを通して**確かめる(部品化 ②-b の最初の 1 本 = jobs → A13)。
 *
 * 同じ土台(action_spec とドメインだけを持つ製品の仕様の木。`samples/dual_actors`)に、`uses` と `jobs.md` だけを
 * 変えて `runAllVerifications` を回し、実行ログ(進捗行)と全体の Finding を見る。
 *   (i)   `uses` に jobs が無い                       → A13 は未実施(行が出る)。J0 も P2 も出ない
 *   (ii)  `uses` に jobs があり jobs.md が壊れている   → A13 は阻害(行が出る)。J0 の error は従来どおり 1 回だけ
 *   (iii) `uses` に jobs があり空のカタログ            → 行は出ない(実行・0 件)。違反も出ない
 * 加えて、置き場に jobs.md があるのに採っていない形(P2 の error と A13 の未実施が両方出る)。
 *
 * 下の「actions を採らない製品」は同じ 3 反例を、**action_spec の置き場が無い製品(`uses: [jobs]`)**で通す(外部レビュー のレビュー
 * の 3 反例。前の版は A 群全体が actions の有無で飛び、
 * A13 の阻害の行も・空の実行も・違反も消えた)。A13 の前提はジョブカタログで、action_spec ではない。
 *
 * 土台の仕様(dual_actors)はドメインに意図的な V 群の違反を持つが、ここで見るのは入力の状態の行と A13 / J0 / P2 だけである。
 */

import { TEST_VERIFY_INPUTS } from '../../helpers/platform.js';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runAllVerifications } from '../../../lib/compose/verify-pipeline.js';
import { loadJobSpecModel } from '../../../lib/model/job/loader.js';
import { TEST_ROOTS, writeProductDeclaration } from '../../helpers/product-roots.js';
import type { SpecKind } from '../../../lib/model/product/uses.js';

const BASE = fileURLToPath(new URL('../../fixtures/samples/dual_actors/docs/specs', import.meta.url));

/** 作った一時ツリー(後片付けのため)。 */
const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 壊れたカタログ(フロントマターが無い)。 */
const BROKEN_JOBS = '# フロントマターの無いカタログ\n';

/** ジョブが 0 件の、スキーマに適合する最小のカタログ(語彙とテストケースの宣言はスキーマが 1 件以上を要る)。 */
const EMPTY_JOBS = [
  '---',
  'doc_type: job_spec',
  'scope: backend',
  'id: job-catalog',
  '',
  'vocabulary:',
  '  kind:',
  '    - id: scan',
  '  on_failure:',
  '    - id: skip_and_next_run',
  '      means: next_run',
  '',
  'jobs: []',
  '',
  'test_cases:',
  '  - id: TC-JOB-CATALOG-001',
  '    type: unit',
  '    covers: [success]',
  '    spec_ids: [job-catalog]',
  '    implementation: app/src/operation/__tests__/jobs/job-catalog.test.ts::突合',
  '---',
  '',
  '# 空のジョブカタログ',
  '',
].join('\n');

/** 土台の仕様の木を一時ツリーへ写し、`uses` と jobs.md を差して実パイプラインを回す。 */
async function verifyWith(uses: readonly SpecKind[], jobsMd: string | null, withoutActions = false) {
  const repo = mkdtempSync(path.join(tmpdir(), 'input-state-'));
  created.push(repo);
  writeProductDeclaration(repo, uses);
  const specs = path.join(repo, TEST_ROOTS.specs);
  cpSync(BASE, specs, { recursive: true });
  // action_spec の置き場を消す = actions を採らない製品(ジョブだけを採る)。
  if (withoutActions) rmSync(path.join(specs, 'backend', 'actions'), { recursive: true, force: true });
  if (jobsMd !== null) {
    mkdirSync(path.join(specs, 'backend'), { recursive: true });
    writeFileSync(path.join(specs, 'backend', 'jobs.md'), jobsMd);
  }
  const lines: string[] = [];
  const result = await runAllVerifications({ ...TEST_VERIFY_INPUTS, domainRoot: path.join(specs, 'domain'), log: (line) => lines.push(line) });
  const loadedJobs = jobsMd === null ? null : loadJobSpecModel(path.join(specs, 'backend', 'jobs.md'), { repoRoot: repo });
  return { ...result, lines, loadedJobs };
}

/** A13 の行(未実施 / 阻害)。 */
const a13Lines = (lines: readonly string[]): string[] => lines.filter((line) => line.startsWith('A13: '));

describe('(i) uses に jobs が無い — 未実施', () => {
  it('A13 の未実施が理由つきで出て、範囲が縮んだ報告として数えられる(J0 も P2 も出ない)', async () => {
    const result = await verifyWith(['actions'], null);

    expect(a13Lines(result.lines)).toEqual(['A13: 未実施 — 製品が jobs を採っていない(product.md の uses に無い)。']);
    expect(result.skipNotes.some((note) => note.startsWith('A13: 未実施'))).toBe(true);
    expect(result.findings.filter((finding) => ['A13', 'J0', 'P2'].includes(finding.verifier))).toEqual([]);
  });

  it('置き場に jobs.md があるのに採っていなければ、P2 が error・A13 は未実施(書いた仕様が黙って外れない)', async () => {
    const result = await verifyWith(['actions'], EMPTY_JOBS);

    expect(a13Lines(result.lines)[0]).toContain('A13: 未実施 — 製品が jobs を採っていない');
    expect(result.findings.filter((finding) => finding.verifier === 'P2').map((finding) => finding.severity)).toEqual(['error']);
    expect(result.findings.filter((finding) => finding.verifier === 'P2')[0]?.message).toContain('jobs の仕様が置き場');
  });
});

describe('(ii) uses に jobs があり jobs.md が壊れている — 阻害', () => {
  it('A13 の阻害が出て、J0 の error は従来どおり 1 回だけ数える(二重に数えない)', async () => {
    const result = await verifyWith(['actions', 'jobs'], BROKEN_JOBS);

    expect(a13Lines(result.lines)).toHaveLength(1);
    expect(a13Lines(result.lines)[0]).toContain('A13: 阻害 — jobs を採っているが検査へ渡せない(読めない・壊れている');
    expect(result.skipNotes.some((note) => note.startsWith('A13: 阻害'))).toBe(true);

    const j0 = result.findings.filter((finding) => finding.verifier === 'J0');
    expect(j0.length).toBeGreaterThan(0);
    expect(j0).toHaveLength(result.loadedJobs?.findings.length ?? -1);
    expect(j0.every((finding) => finding.severity === 'error')).toBe(true);
    expect(result.findings.filter((finding) => finding.verifier === 'A13')).toEqual([]);
  });
});

describe('(iii) uses に jobs があり空のカタログ — 実行・0 件', () => {
  it('未実施 / 阻害の行は出ず、A13 の違反も出ない(実行された)', async () => {
    const result = await verifyWith(['actions', 'jobs'], EMPTY_JOBS);

    expect(result.loadedJobs?.findings).toEqual([]);
    expect(a13Lines(result.lines)).toEqual([]);
    expect(result.findings.filter((finding) => ['A13', 'J0', 'P2'].includes(finding.verifier))).toEqual([]);
  });
});

describe('採ったのに置き場が無い — P2 が error・A13 は阻害', () => {
  it('uses に jobs があるのに jobs.md が無ければ、P2 の error と A13 の阻害(置き場に仕様が無い)が出る', async () => {
    const result = await verifyWith(['actions', 'jobs'], null);

    expect(result.findings.filter((finding) => finding.verifier === 'P2').map((finding) => finding.message)).toEqual([
      expect.stringContaining('uses に jobs を宣言していますが'),
    ]);
    expect(a13Lines(result.lines)[0]).toContain('A13: 阻害 — jobs を採っているが検査へ渡せない(置き場に仕様が無い');
  });
});

/** 手動ジョブ 1 本(`spec_ids` に自身の ID を持つ test_cases が無い)を足したカタログ。 */
const UNTAGGED_MANUAL_JOBS = EMPTY_JOBS.replace(
  'jobs: []',
  ['jobs:', '  - id: maintenance', '    source: manual', '    kind: scan', '    on_failure: skip_and_next_run', '    summary: maintenance'].join('\n'),
);

/** A 群が action_spec を前提とする検査を飛ばしたと言う行(実行したものの一覧つき)。 */
const skippedGroupLine = (lines: readonly string[]): string | undefined => lines.find((line) => line.startsWith('A 群'));

describe('actions を採らない製品(uses: [jobs]・action_spec の置き場なし)— A13 は actions と独立に起動する', () => {
  it('(i) 壊れた jobs: A13 は阻害の行を出す・J0 の error は 1 回だけ・A13 の Finding は無い', async () => {
    const result = await verifyWith(['jobs'], BROKEN_JOBS, true);

    expect(result.modelBuilt).toBe(true);
    expect(a13Lines(result.lines)).toHaveLength(1);
    expect(a13Lines(result.lines)[0]).toContain('A13: 阻害 — jobs を採っているが検査へ渡せない(読めない・壊れている');
    expect(result.skipNotes.some((note) => note.startsWith('A13: 阻害'))).toBe(true);
    const j0 = result.findings.filter((finding) => finding.verifier === 'J0');
    expect(j0.length).toBeGreaterThan(0);
    expect(j0).toHaveLength(result.loadedJobs?.findings.length ?? -1);
    expect(result.findings.filter((finding) => finding.verifier === 'A13')).toEqual([]);
  });

  it('(ii) 空のカタログ: A13 は実行される(0 件)。群の行が「実行したもの: A13」と言い、未実施とは区別される', async () => {
    const result = await verifyWith(['jobs'], EMPTY_JOBS, true);

    expect(result.loadedJobs?.findings).toEqual([]);
    expect(a13Lines(result.lines)).toEqual([]);
    expect(skippedGroupLine(result.lines)).toContain('action_spec が前提の検査はスキップしました');
    expect(skippedGroupLine(result.lines)).toContain('実行したもの: A13');
    expect(result.findings.filter((finding) => ['A13', 'J0', 'P2'].includes(finding.verifier))).toEqual([]);
  });

  it('(iii) 注釈の無い手動ジョブ 1 本: A13 の違反が全体のパイプラインでも 1 件出る', async () => {
    const result = await verifyWith(['jobs'], UNTAGGED_MANUAL_JOBS, true);

    expect(result.loadedJobs?.findings).toEqual([]);
    const a13 = result.findings.filter((finding) => finding.verifier === 'A13');
    expect(a13).toHaveLength(1);
    expect(a13[0]?.message).toContain('maintenance');
    expect(skippedGroupLine(result.lines)).toContain('実行したもの: A13');
  });

  it('uses が空の製品: A13 は未実施(理由つき)・実行したものは「なし」', async () => {
    const result = await verifyWith([], null, true);

    expect(a13Lines(result.lines)).toEqual(['A13: 未実施 — 製品が jobs を採っていない(product.md の uses に無い)。']);
    expect(skippedGroupLine(result.lines)).toContain('実行したもの: なし');
    expect(result.findings.filter((finding) => ['A13', 'J0', 'P2'].includes(finding.verifier))).toEqual([]);
  });

  it('actions を採る製品でも、同じ手動ジョブの違反は同じ 1 件(actions の有無で A13 の結果は変わらない)', async () => {
    const withActions = await verifyWith(['actions', 'jobs'], UNTAGGED_MANUAL_JOBS);
    const withoutActions = await verifyWith(['jobs'], UNTAGGED_MANUAL_JOBS, true);

    const messages = (findings: readonly { verifier: string; message: string }[]) =>
      findings.filter((finding) => finding.verifier === 'A13').map((finding) => finding.message);
    expect(messages(withoutActions.findings)).toEqual(messages(withActions.findings));
    expect(messages(withActions.findings)).toHaveLength(1);
  });
});
