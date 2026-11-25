/**
 * 題材が生成したものが題材の上で回ることの照らし(pre-commit で回る分。fix27 A2。表は同じ置き場の sample-coverage.ts)。
 *
 * - 6 題材の全部で、生成の後の木で回し直した検査(段の宣言 onGeneratedTree から導いた J2 と X8)の回数と指摘・回し直す前の verify の行・
 *   試験を生成した生成器の一覧・n/a の条件・ESLint の行が、表と食い違わない(正例)
 * - Cron の起動口の試験は時刻起点のジョブがある題材にだけ生成する(見るものの無い試験を出さない)
 * - 題材の木に宣言の無い口を植えると、回し直しの J2 が赤にする(題材の上で検査が実際に効く。負例)
 * - 回し直しの回数(見た相手の数)は検査と同じ判定で数える: 検査が走査しない木では、入口・有料の連携があっても 0(差分点検 S27-2。負例)
 * - 表の題材は fixture の題材の全部
 *
 * 試験を実行して照らす分(配線の試験・実 DB の試験の it の数と拒否の観測)は samples:db が回す(重いので取り込みの台本と夜間)。
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSampleSystem } from './harness.js';
import { SAMPLE_COVERAGE } from './sample-coverage.js';
import { subjectCounts } from './generated-tree.js';
import { TEST_ROOTS } from '../helpers/product-roots.js';
import { naFactsOf, preCommitProblems } from '../../lib/targets/supabase/samples/sample-coverage-check.js';

/** fixture の題材の置き場。 */
const SAMPLES_ROOT = fileURLToPath(new URL('../fixtures/samples/', import.meta.url));

/** fixture の題材の全部。 */
const SAMPLES = readdirSync(SAMPLES_ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

describe('題材の表(生成の後の木の回し直し・生成物の一覧)', () => {
  it('表の題材は fixture の題材の全部', () => {
    expect(Object.keys(SAMPLE_COVERAGE).sort()).toEqual(SAMPLES);
  });

  it.each(SAMPLES)('%s: 表と食い違わない', async (name) => {
    const run = await runSampleSystem(name);
    const testKinds = [...new Set([...run.generatedBy].filter(([file]) => /\.test\.tsx?$/.test(file)).map(([, kind]) => kind))].sort();
    const problems = preCommitProblems(name, {
      checks: run.generatedTree.subjects,
      checkErrors: run.generatedTree.findings.filter((finding) => finding.severity === 'error').map((finding) => `[${finding.verifier}] ${finding.message}`),
      testKinds,
      ...naFactsOf(path.join(SAMPLES_ROOT, name), run.roots),
    }, SAMPLE_COVERAGE);
    expect(problems).toEqual([]);
  });

  it('場面も性質も導けない操作(単体の場面を手書きが受け持つ stores の product.create)には、空の生成テストを出さない(題材の木で実行して見つかった空の describe)', async () => {
    const run = await runSampleSystem('stores');
    expect([...run.generatedBy.keys()]).not.toContain('app/src/operation/__tests__/generated/product/create.test.ts');
    expect([...run.generatedBy.keys()]).toContain('app/src/operation/__tests__/generated/product/update.test.ts');
  });

  // 生成器は見るものの無い試験を出さない(fix27 A2。表の `na.ungenerated` の行と、題材の実物の時刻起点のジョブの数が、同じ向きで閉じる)。
  it.each(SAMPLES)('%s: Cron の起動口の試験は、時刻起点のジョブがある題材にだけ生成する(無い題材には生成しない)', async (name) => {
    const run = await runSampleSystem(name);
    const generated = [...run.generatedBy.values()].includes('code-cron-route-tests');
    const { scheduled } = naFactsOf(path.join(SAMPLES_ROOT, name), run.roots);
    expect(generated, `時刻起点のジョブ ${scheduled} 件`).toBe(scheduled > 0);
  });

  // 手書きの RPC の数は題材の data_table の宣言から数える(字面の grep ではない)。6 題材は全部 0 件で、表の掴む順の行は条件つきの n/a。
  it.each(SAMPLES)('%s: 掴む順の逆順の実 DB の試験の行は、手書きの RPC が無い題材の条件つきの n/a', async (name) => {
    const run = await runSampleSystem(name);
    const { handwritten } = naFactsOf(path.join(SAMPLES_ROOT, name), run.roots);
    expect(handwritten).toBe(0);
    expect(SAMPLE_COVERAGE[name]?.['突合:rollback-retry-parity.test.ts']?.na?.when).toBe('no-handwritten-rpc');
  });

  it('負例: 題材の data_table に手書きの RPC を 1 本足すと、掴む順の行の n/a の条件が崩れて赤になる(条件が実際に効く)', async () => {
    const run = await runSampleSystem('rooms');
    const base = path.join(SAMPLES_ROOT, 'rooms');
    const mutated = mkdtempSync(path.join(tmpdir(), 'cov-hw-'));
    try {
      cpSync(base, mutated, { recursive: true });
      const file = path.join(mutated, run.roots.specs, 'backend/data/tables/rooms.md');
      const text = readFileSync(file, 'utf8');
      const planted = text.replace(/^functions:\n/m, `functions:\n  - name: st_planted_handwritten\n    args: [uuid]\n    params: [p_id]\n    kind: rpc\n    shape: composite\n    returns: scalar\n    also_writes: {}\n    self_writes: []\n    handwritten: 掴む順の負例のために植えた手書きの RPC\n`);
      expect(planted).not.toBe(text);
      writeFileSync(file, planted);
      const facts = naFactsOf(mutated, run.roots);
      expect(facts.handwritten).toBe(1);
      const problems = preCommitProblems('rooms', { checks: run.generatedTree.subjects, checkErrors: [], testKinds: [...new Set([...run.generatedBy].filter(([f]) => /\.test\.tsx?$/.test(f)).map(([, kind]) => kind))].sort(), ...facts }, SAMPLE_COVERAGE);
      expect(problems.some((problem) => problem.startsWith('[n/a の条件が崩れた] rooms × 突合:rollback-retry-parity.test.ts')), problems.join('\n')).toBe(true);
    } finally {
      rmSync(mutated, { recursive: true, force: true });
    }
  });

  it('負例: 題材の木に宣言の無い口を植えると、生成の後の木の J2 が名指して赤にする', async () => {
    const rogue = 'app/src/app/api/rogue/route.ts';
    const run = await runSampleSystem('rooms', { plantAfterGenerate: { [rogue]: "export async function GET(): Promise<Response> {\n  return new Response('x');\n}\n" } });
    const errors = run.generatedTree.findings.filter((finding) => finding.severity === 'error' && finding.verifier === 'J2');
    expect(errors.some((finding) => finding.message.includes('rogue') || finding.location.file.includes('rogue'))).toBe(true);
    expect(run.generatedTree.subjects['J2']).toBe((SAMPLE_COVERAGE['rooms']?.['check:J2']?.runs ?? 0) + 1);
  });
});

/** 作り物の有料の連携のアダプタの置き場(実装の木の根から)。 */
const ADAPTER_ROOT = path.join(TEST_ROOTS.app ?? 'app', 'src', 'infrastructure', 'anthropic');

/** 有料の連携 1 本だけのカタログ(読み取りの形は parse-external-paid.test.ts の健全な行)。 */
const PAID_CATALOG = [
  '---',
  'doc_type: external_spec',
  'scope: backend',
  'id: external-catalog',
  'vocabulary:',
  '  service:',
  '    - id: anthropic',
  `      adapter_root: ${ADAPTER_ROOT}`,
  'integrations:',
  '  - id: chat',
  '    service: anthropic',
  '    direction: outbound',
  '    effect: read',
  '    port: ChatPort',
  `    adapter: ${ADAPTER_ROOT}/chat.ts`,
  '    config: [ANTHROPIC_API_KEY]',
  '    degrade: not_configured',
  '    degrade_summary: 画面に出さない',
  '    timeout_ms: 60000',
  '    retry: none',
  '    sends: { text: 質問文, neutralize: [control_chars] }',
  '    summary: AI チャット',
  "    endpoints: ['/api/ai/tutorial']",
  '    spend: paid',
  "    abuse: { max_body_bytes: { '/api/ai/tutorial': 262144 }, quota: { source: AI_LIMIT, per: 1 day, key: actor } }",
  'test_cases: []',
  '---',
  '',
].join('\n');

describe('回し直しの回数は、検査が実際に回る判定で数える(差分点検 S27-2)', () => {
  let root = '';
  const put = (file: string, text: string): void => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };

  it('実装の木があれば、J2 は入口を・X8 は有料の連携を数える(正例: 数え方が空振りでない)', () => {
    root = mkdtempSync(path.join(tmpdir(), 'cov-subjects-'));
    try {
      put(`${TEST_ROOTS.specs}/backend/external.md`, PAID_CATALOG);
      put(`${TEST_ROOTS.app ?? 'app'}/src/app/api/ai/tutorial/route.ts`, 'export async function POST(): Promise<Response> {\n  return new Response();\n}\n');
      expect(subjectCounts(root, TEST_ROOTS, ['J2', 'X8'])).toEqual({ J2: 1, X8: 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('負例: 実装の木の根を宣言から外す(検査は no_tree で回らない)と、入口と有料の連携が置かれていても回数は 0', () => {
    root = mkdtempSync(path.join(tmpdir(), 'cov-subjects-'));
    try {
      put(`${TEST_ROOTS.specs}/backend/external.md`, PAID_CATALOG);
      put(`${TEST_ROOTS.app ?? 'app'}/src/app/api/ai/tutorial/route.ts`, 'export async function POST(): Promise<Response> {\n  return new Response();\n}\n');
      expect(subjectCounts(root, { ...TEST_ROOTS, app: 'elsewhere' }, ['J2', 'X8'])).toEqual({ J2: 0, X8: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
