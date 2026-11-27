/**
 * 実装の範囲の宣言(`product.md` の `implemented`)を、題材 `rooms` の生成の後の木に通す通し実行(重い組)。
 *
 * 生成の直後の木は、実装の木が生成物だけで、手で書くテストが 1 本も無い。検査はそこで「名指しされたテストが無い」を大量に言う ——
 * 範囲の宣言はまさにこの形を扱うために入る。ここでは `product.md` を書き換えながら、**同じ木で何度も全部の検査を回し**、次を見る。
 *   - キーが無ければ、報告も無く、指摘は何も外れない(印のついた error も残る)
 *   - `[]` なら、印のついた指摘は 1 件も残らず、残りは「キー無しの結果から印のついたものを除いたもの」と**まったく同じ**である。
 *     仕様の中の指摘・食い違い・ホストの設定の不在・どの仕様にも無い `@tc`(孤児)は、範囲で消えない
 *   - `[room-create-action]` なら、戻るのはその操作の不在の error だけで、ほかには何も戻らない
 *   - 全部の持ち主を列挙すれば、キー無しと同じ指摘に戻る(列挙した id がどれも印に当たる = 持ち主の一覧と印が同じ出どころ)
 *   - 印の持ち主は、全部 `scopeOwners` の一覧の中に居る
 *   - 公開の log に載りうる 1 行は、種類と件数だけで、範囲の外の id を含まない(`--list-out-of-scope` のときだけ名指す)
 *   - **範囲で消してはいけない指摘**(負例): 宣言の無い実ルート(S7)・宣言の無い連携の置き場(X1)・ホストの設定の許可表の外(J2)・
 *     テストはあるが名前が違う(Z1)は、`[]` でも残る。rooms にはジョブ・連携・保証が無いので、負例の後ろ 3 つは `library` / `stores` で見る
 *
 * 題材は仕組みと同じ配布物の中の中立な題材(rooms)で、書き換えるのは一時ツリーの写しだけ。
 * **重い組**(別プロセスの CLI を起こし、全検査を何度も回す)なので `vitest.heavy.config.ts` に載せる。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAllVerifications, type PipelineResult } from '../../lib/compose/verify-pipeline.js';
import type { Finding } from '../../lib/kernel/finding.js';
import { PRODUCT_DECL_FILE } from '../../lib/io/paths.js';
import { formatScopeSummary } from '../../lib/scope/summary.js';
import { matchesAbsenceTemplate } from '../helpers/absence-templates.js';
import { cliPath, SLOW } from '../helpers/book-entry-fixture.js';
import { TEST_VERIFY_INPUTS } from '../helpers/platform.js';
import { runToolCli, TOOL_TREE } from '../helpers/run-tool-cli.js';
import { runSampleSystem, type SampleRun } from './harness.js';

/** 範囲の外のはずの操作(名前は公開の log に出てはならない側の例)と、範囲に入れる操作。 */
const OUT_OF_SCOPE = 'booking-create-action';
const IN_SCOPE = 'room-create-action';

/** 通し実行を 1 回通した一時ツリー(宣言を書き換えながら、同じ木で全部の検査を回す)。 */
interface Tree {
  readonly run: SampleRun;
  readonly root: string;
  readonly original: string;
}

/** 題材を通して、一時ツリーを残す。 */
async function openTree(name: string): Promise<Tree> {
  const run = await runSampleSystem(name, { keepRoot: true });
  const root = run.root ?? '';
  const original = readFileSync(path.join(root, PRODUCT_DECL_FILE), 'utf-8');
  return { run, root, original };
}

/**
 * `product.md` の `implemented` を書き換える(`null` ならキーを書かない)。`uses` の最後の行の後ろに足す。
 *
 * @param tree 一時ツリー
 * @param lines キーの行(例: `['implemented: []']`)
 */
function declare(tree: Tree, lines: readonly string[] | null): void {
  const end = /(\n {2}- [a-z_]+)\n---/u.exec(tree.original);
  if (end === null) throw new Error('product.md の uses の最後の行を見つけられません');
  const tail = lines === null ? '' : `\n${lines.join('\n')}`;
  writeFileSync(path.join(tree.root, PRODUCT_DECL_FILE), tree.original.replace(end[0], `${end[1]}${tail}\n---`));
}

/** 生成の後の木で、全部の検査を回す。 */
async function verifyAll(tree: Tree, implementedBase?: string): Promise<{ readonly result: PipelineResult; readonly log: readonly string[] }> {
  const log: string[] = [];
  const result = await runAllVerifications({
    ...TEST_VERIFY_INPUTS,
    domainRoot: path.join(tree.root, tree.run.roots.specs, 'domain'),
    ...(implementedBase === undefined ? {} : { implementedBase }),
    log: (line) => log.push(line),
  });
  return { result, log };
}

/** 木へファイルを置く(途中のディレクトリも作る)。 */
function plant(tree: Tree, relative: string, text: string): void {
  const file = path.join(tree.root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** 指摘の同一性(順序・内容)。 */
const keyOf = (finding: Finding): string => [finding.verifier, finding.severity, finding.message, finding.location.file, finding.location.pointer ?? ''].join('|');

/** 印のついた指摘。 */
const taggedOf = (findings: readonly Finding[]): readonly Finding[] => findings.filter((finding) => finding.absentFor !== undefined);

/** error だけ。 */
const errorsOf = (findings: readonly Finding[]): readonly Finding[] => findings.filter((finding) => finding.severity === 'error');

/** 印のついた指摘のうち、その検査の許す文面(`absence-templates.ts`)に当たらないもの(あれば、付けてはいけない枝に印が付いている)。 */
const offTemplate = (findings: readonly Finding[]): readonly string[] =>
  taggedOf(findings)
    .filter((finding) => !matchesAbsenceTemplate(finding.verifier, finding.message))
    .map((finding) => `${finding.verifier}: ${finding.message}`);

/** ファイルを書き換え、元に戻す関数を返す。 */
function edit(tree: Tree, relative: string, change: (text: string) => string): () => void {
  const file = path.join(tree.root, relative);
  const before = readFileSync(file, 'utf-8');
  const after = change(before);
  if (after === before) throw new Error(`${relative} の書き換えが空振りしました`);
  writeFileSync(file, after);
  return () => writeFileSync(file, before);
}

const trees: Tree[] = [];

/** base の product.md を置いた一時ディレクトリ(後片付けのため)。 */
const baseDirs: string[] = [];

afterAll(() => {
  for (const tree of trees.splice(0)) rmSync(tree.root, { recursive: true, force: true });
  for (const dir of baseDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('実装の範囲の宣言を rooms の生成の後の木に通す', () => {
  let tree: Tree;
  let baseline: PipelineResult;

  beforeAll(async () => {
    tree = await openTree('rooms');
    trees.push(tree);
    declare(tree, null);
    baseline = (await verifyAll(tree)).result;
  }, SLOW);

  it('キーが無い: 報告は無く、何も外れず、印のついた error も残る(実測の前提)', () => {
    expect(baseline.scopeReport).toBeNull();
    expect(baseline.relieved).toEqual([]);
    const tagged = taggedOf(baseline.findings);
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged.every((finding) => finding.severity === 'error')).toBe(true);
    expect(tagged.some((finding) => finding.verifier === 'A6' && finding.absentFor?.id === IN_SCOPE)).toBe(true);
    expect(tagged.some((finding) => finding.verifier === 'A6' && finding.absentFor?.id === OUT_OF_SCOPE)).toBe(true);
    // 印は、その検査の許す文面(閉じた表)の指摘にだけ付いている。
    expect(offTemplate(baseline.findings)).toEqual([]);
  }, SLOW);

  it('印の持ち主は全部、持ち主の一覧(scopeOwners)の中に居る', () => {
    const known = new Set(baseline.scopeOwners.map((owner) => `${owner.kind}:${owner.id}`));

    expect(known.size).toBeGreaterThan(0);
    expect(taggedOf(baseline.findings).filter((finding) => !known.has(`${finding.absentFor?.kind}:${finding.absentFor?.id}`)).map(keyOf)).toEqual([]);
    expect(baseline.scopeOwners).toContainEqual({ kind: 'action', id: IN_SCOPE });
    expect(baseline.scopeOwners).toContainEqual({ kind: 'action', id: OUT_OF_SCOPE });
  });

  it('`implemented: []`: 印のついた指摘は 1 件も残らず、残りはキー無しの結果から印のついたものを除いたものと同じ', async () => {
    declare(tree, ['implemented: []']);

    const { result } = await verifyAll(tree);

    expect(taggedOf(result.findings)).toEqual([]);
    expect(result.findings.map(keyOf)).toEqual(baseline.findings.filter((finding) => finding.absentFor === undefined).map(keyOf));
    expect(result.relieved.map(keyOf)).toEqual(taggedOf(baseline.findings).map(keyOf));
    expect(result.relieved.every((finding) => finding.severity === 'error')).toBe(true);
    expect(result.findings.some((finding) => finding.verifier === 'P13' || finding.verifier === 'P14')).toBe(false);
  }, SLOW);

  it('`implemented: []` でも消えない本物の指摘: どの仕様にも無い @tc(A6 の孤児)と、テストはあるが中身が空(A16)', async () => {
    declare(tree, ['implemented: []']);

    const { result } = await verifyAll(tree);
    const errors = errorsOf(result.findings);

    expect(errors.some((finding) => finding.verifier === 'A6' && finding.message.includes('の test_cases にもありません'))).toBe(true);
    expect(errors.some((finding) => finding.verifier === 'A16')).toBe(true);
    // 残る error は印の外の指摘だけ(範囲が外すのは印のついた不在だけ)。
    expect(errors.every((finding) => finding.absentFor === undefined)).toBe(true);
  }, SLOW);

  it('`implemented: []` の報告: 範囲の外の仕様の数を種類ごとに持ち、外した指摘の件数と一致する', async () => {
    declare(tree, ['implemented: []']);

    const { result } = await verifyAll(tree);
    const report = result.scopeReport;

    expect(report?.declared).toBe(0);
    expect(report?.relieved).toBe(result.relieved.length);
    expect(report?.kinds['action']).toBeGreaterThan(0);
    expect(report?.owners).toContainEqual({ kind: 'action', id: OUT_OF_SCOPE });
  }, SLOW);

  it('`implemented: [room-create-action]`: 戻るのはその操作の不在の error だけ。ほかは何も戻らない', async () => {
    declare(tree, ['implemented:', `  - ${IN_SCOPE}`]);
    const emptyKeys = new Set(baseline.findings.filter((finding) => finding.absentFor === undefined).map(keyOf));

    const { result } = await verifyAll(tree);
    const back = result.findings.filter((finding) => !emptyKeys.has(keyOf(finding)));

    // `[]` の結果を全部含む(何も新しく消えていない)。
    expect([...emptyKeys].filter((key) => !result.findings.map(keyOf).includes(key))).toEqual([]);
    expect(back.length).toBeGreaterThan(0);
    expect(back.every((finding) => finding.absentFor?.id === IN_SCOPE && finding.severity === 'error')).toBe(true);
    // 戻るのは操作の実装・テストの不在(A2 / A6)だけ。rooms の生成の後の木では、A6 の「テストファイルが無い」が 3 件(TC-ROOM-CREATE-001〜003)。
    expect(back.every((finding) => ['A2', 'A6'].includes(finding.verifier))).toBe(true);
    expect(back.filter((finding) => finding.verifier === 'A6' && finding.message.includes('TC-ROOM-CREATE-001')).length).toBe(1);
    // ほかの操作の不在は引き続き範囲の外。
    expect(result.relieved.some((finding) => finding.absentFor?.id === IN_SCOPE)).toBe(false);
    expect(result.relieved.some((finding) => finding.absentFor?.id === OUT_OF_SCOPE)).toBe(true);
    expect(result.scopeReport?.declared).toBe(1);
  }, SLOW);

  it('範囲の外の仕様を全部列挙すれば、キー無しと同じ指摘に戻る(列挙した id がどれも印に当たる)', async () => {
    const ids = [...new Set(taggedOf(baseline.findings).map((finding) => finding.absentFor?.id ?? ''))];
    declare(tree, ['implemented:', ...ids.map((id) => `  - ${id}`)]);

    const { result } = await verifyAll(tree);

    expect(result.findings.map(keyOf)).toEqual(baseline.findings.map(keyOf));
    expect(result.relieved).toEqual([]);
  }, SLOW);

  it('宣言に書いた id が持ち主の一覧に無ければ P13(書いた id だけが赤になる)', async () => {
    declare(tree, ['implemented:', '  - room-typo-action']);

    const { result } = await verifyAll(tree);

    expect(result.findings.filter((finding) => finding.verifier === 'P13').map((finding) => finding.message)).toEqual([
      'implemented の room-typo-action は実装の範囲に入れられる仕様の id ではありません',
    ]);
  }, SLOW);

  it('公開しうる 1 行は種類と件数だけで、範囲の外の id を含まない。名指すのは listNames のときだけ', async () => {
    declare(tree, ['implemented: []']);

    const { result, log } = await verifyAll(tree);
    const report = result.scopeReport;
    if (report === null) throw new Error('宣言があるのに報告が無い');

    const line = formatScopeSummary(report, { listNames: false });
    expect(line).toContain('実装の範囲: 宣言 0 件');
    expect(line).toContain(`action ${report.kinds['action']}`);
    expect(line).not.toContain(OUT_OF_SCOPE);
    expect(line).not.toContain(IN_SCOPE);
    expect(formatScopeSummary(report, { listNames: true })).toContain(OUT_OF_SCOPE);
    // 検証の途中の進捗行にも、範囲の外の id は出ない。
    expect(log.filter((entry) => entry.includes(OUT_OF_SCOPE) || entry.includes(IN_SCOPE))).toEqual([]);
  }, SLOW);

  it('CLI(verify): 要約の行は既定では id を出さず、`--list-out-of-scope` で名指す。キーが無ければ行も出ない', () => {
    const verify = (args: readonly string[]) => runToolCli(cliPath('verify-docs.ts'), TOOL_TREE, ['--root', tree.root, ...args]);

    declare(tree, null);
    const none = verify([]);
    declare(tree, ['implemented: []']);
    const quiet = verify([]);
    const named = verify(['--list-out-of-scope']);

    expect(none.stdout).not.toContain('実装の範囲:');
    expect(quiet.stdout).toContain('実装の範囲: 宣言 0 件');
    expect(quiet.stdout).not.toContain(OUT_OF_SCOPE);
    expect(quiet.stderr).not.toContain(OUT_OF_SCOPE);
    expect(named.stdout).toContain('実装の範囲: 宣言 0 件');
    expect(named.stdout).toContain(OUT_OF_SCOPE);
    // 残る error(A6 の孤児・A16)があるので、範囲を宣言しても終了コードは 1 のまま。
    expect(quiet.status).toBe(1);
  }, SLOW);

  it('`implemented:`(値が無い)は P0 の error で、何も外れない(範囲は「全部」。壊れた宣言が「何も入れない」に化けない)', async () => {
    declare(tree, ['implemented:']);

    const { result } = await verifyAll(tree);

    expect(result.findings.some((finding) => finding.verifier === 'P0' && finding.severity === 'error' && finding.message.includes('implemented'))).toBe(true);
    expect(result.relieved).toEqual([]);
    expect(result.scopeReport).toBeNull();
    expect(taggedOf(result.findings).length).toBe(taggedOf(baseline.findings).length);
  }, SLOW);

  it('負例(Q6): 読み取りに integration のテストケースが無い(checkIntegration)は `[]` でも残る(あるべき種類のテストが宣言に無いのは、テストが無いこととは別)', async () => {
    declare(tree, ['implemented: []']);
    const restore = edit(tree, 'docs/specs/backend/queries/room/room_list.md', (text) => text.replaceAll('type: integration', 'type: unit'));
    try {
      const { result } = await verifyAll(tree);

      expect(errorsOf(result.findings).some((finding) => finding.verifier === 'Q6' && finding.message === 'room_list に type: integration のテストケースがありません')).toBe(true);
      expect(result.relieved.some((finding) => finding.message.includes('type: integration'))).toBe(false);
    } finally {
      restore();
    }
  }, SLOW);

  it('負例(S7): 画面の route が置き場の配置から辿れない(unreachableRoutes)は `[]` でも残る(「実ルートが無い」とは別の指摘)', async () => {
    declare(tree, ['implemented: []']);
    const restore = edit(tree, 'docs/specs/frontend/screens/booking/booking_list.md', (text) => text.replace('route: /bookings\n', 'route: /_hidden/bookings\n'));
    try {
      const { result } = await verifyAll(tree);

      expect(errorsOf(result.findings).some((finding) => finding.verifier === 'S7' && finding.message.includes('逆引きでは同じキーに戻りません'))).toBe(true);
      expect(result.relieved.some((finding) => finding.message.includes('逆引き'))).toBe(false);
      // 同じ画面の「実ルートが無い」は、不在なので範囲の外へ移る。
      expect(result.relieved.some((finding) => finding.verifier === 'S7' && finding.message.includes('/_hidden/bookings に対応する実ルートが'))).toBe(true);
    } finally {
      restore();
    }
  }, SLOW);

  it('負例(S7): 宣言の無い実ルートは `[]` でも残る(範囲が外すのは「無い」ことだけで、「余計にある」ことは外さない)', async () => {
    plant(tree, 'app/src/app/secret/page.tsx', 'export default function Page() {\n  return null;\n}\n');
    declare(tree, ['implemented: []']);

    const { result } = await verifyAll(tree);

    expect(errorsOf(result.findings).some((finding) => finding.verifier === 'S7' && finding.message.includes('/secret を宣言している screen_spec がありません'))).toBe(true);
    expect(result.relieved.some((finding) => finding.message.includes('/secret'))).toBe(false);
  }, SLOW);
});

describe('負例(題材 library): ホストの設定・テスト名の食い違い・宣言の無い口・proxy の被覆は、範囲で消えない', () => {
  let tree: Tree;
  let baseline: PipelineResult;

  beforeAll(async () => {
    tree = await openTree('library');
    trees.push(tree);
    declare(tree, null);
    baseline = (await verifyAll(tree)).result;
  }, SLOW);

  it('キーが無い: 印のついた指摘は全部、許す文面の表に当たる(J2 のホストの設定の不在・H6 などは印の外)', () => {
    expect(taggedOf(baseline.findings).length).toBeGreaterThan(0);
    expect(offTemplate(baseline.findings)).toEqual([]);
    expect(errorsOf(baseline.findings).some((finding) => finding.verifier === 'J2' && finding.message.startsWith('app/vercel.json がありません'))).toBe(true);
    expect(errorsOf(baseline.findings).some((finding) => finding.verifier === 'H6')).toBe(true);
  });

  it('`implemented: []`: ホストの設定の不在(J2)・H6 は残り、印のついた不在(Z1 / H2 / H3 / G7 / G8 / S7 …)は移る', async () => {
    declare(tree, ['implemented: []']);

    const { result } = await verifyAll(tree);
    const errors = errorsOf(result.findings);

    expect(errors.some((finding) => finding.verifier === 'J2' && finding.message.startsWith('app/vercel.json がありません'))).toBe(true);
    expect(errors.some((finding) => finding.verifier === 'H6')).toBe(true);
    for (const verifier of ['Z1', 'H2', 'H3', 'S7']) expect(result.relieved.some((finding) => finding.verifier === verifier)).toBe(true);
    expect(errors.every((finding) => finding.absentFor === undefined)).toBe(true);
  }, SLOW);

  it('負例(J2 / Z1): 許可表の外の欄・テスト名の食い違いは、`[]` でも残る', async () => {
    plant(tree, 'app/vercel.json', '{"git":{"deploymentEnabled":{"**":false}},"headers":[]}\n');
    // 保証 TC-GUAR-LOANS-001 の見張りテストを、テスト名だけ違う形で置く(他の 2 件は不在のまま)。
    plant(tree, 'app/src/infrastructure/__tests__/guarantees/loans-rls.test.ts', "// @spec guarantee-catalog @tc TC-GUAR-LOANS-001\nit('別の名前', () => {\n  expect(1).toBe(1);\n});\n");
    declare(tree, ['implemented: []']);

    const { result } = await verifyAll(tree);
    const errors = errorsOf(result.findings);

    expect(errors.some((finding) => finding.verifier === 'J2' && finding.message.includes('ホストの設定の許可表の外'))).toBe(true);
    expect(errors.some((finding) => finding.verifier === 'Z1' && finding.message.includes('TC-GUAR-LOANS-001 のテスト名が implementation と一致しません'))).toBe(true);
    // 不在の側(TC-GUAR-CEILING-001 など)は保証台帳の持ち主で範囲の外へ。
    expect(result.relieved.some((finding) => finding.verifier === 'Z1' && finding.absentFor?.id === 'guarantee-catalog')).toBe(true);
    expect(errors.some((finding) => finding.verifier === 'Z1' && finding.message.includes('テストファイルがありません'))).toBe(false);
  }, SLOW);

  it('負例(J2 の入口の閉世界 / S7 の被覆): 宣言の無い HTTP の入口・proxy の matcher に覆われない認証の画面は、`[]` でも残る', async () => {
    plant(tree, 'app/src/app/api/stray/route.ts', 'export async function POST() {\n  return new Response();\n}\n');
    plant(tree, 'app/src/proxy.ts', "export const config = { matcher: ['/nothing'] };\nexport async function proxy() {}\n");
    declare(tree, ['implemented: []']);

    const { result } = await verifyAll(tree);
    const errors = errorsOf(result.findings);

    expect(errors.some((finding) => finding.verifier === 'J2' && finding.message.includes('どの宣言にも当たりません'))).toBe(true);
    expect(errors.some((finding) => finding.verifier === 'S7' && finding.message.includes('proxy の matcher に覆われていません'))).toBe(true);
    expect(result.relieved.some((finding) => finding.message.includes('matcher') || finding.message.includes('どの宣言にも'))).toBe(false);
  }, SLOW);

  it('J2(宣言した認証の口に Route Handler が無い): `[]` なら認証フロー仕様の不在として移り、持ち主を範囲に入れれば error のまま残る', async () => {
    const entries = 'callback:\n  endpoint: /api/auth/callback\n  summary: 帰り道\nstart:\n  endpoint: /api/auth/start\n  summary: 開始\nlogout:\n  endpoint: /api/auth/logout\n  summary: ログアウト\n';
    const restore = edit(tree, 'docs/specs/backend/auth.md', (text) => text.replace('providers: [email]', `${entries}providers: [email]`));
    const isEntryMissing = (finding: Finding): boolean => finding.verifier === 'J2' && /^認証 (?:callback|start|logout) の endpoint \S+ に対応する Route Handler がありません$/u.test(finding.message);
    try {
      declare(tree, ['implemented: []']);
      const relievedRun = (await verifyAll(tree)).result;
      declare(tree, ['implemented: [auth-flow]']);
      const inScopeRun = (await verifyAll(tree)).result;

      expect(relievedRun.relieved.filter(isEntryMissing).map((finding) => finding.absentFor?.id)).toEqual(['auth-flow', 'auth-flow', 'auth-flow']);
      expect(errorsOf(relievedRun.findings).some(isEntryMissing)).toBe(false);
      expect(errorsOf(inScopeRun.findings).filter(isEntryMissing)).toHaveLength(3);
      expect(inScopeRun.relieved.some(isEntryMissing)).toBe(false);
    } finally {
      restore();
      declare(tree, null);
    }
  }, SLOW);

  it('配線: 種類の読み込みが失敗したとき、その種類の base の id は「仕様から消えた」と数えず P14 の error になる(読み込みの失敗の種類ごと: queries・auth・design_tokens)', async () => {
    const queryId = 'query-item-list';
    const queryFile = path.join(tree.run.roots.specs, 'backend', 'queries', 'item', 'item_list.md');
    // [壊す種類, base に書く id, 壊す file, 壊し方]
    const cases: readonly (readonly [string, string, string, (text: string) => string])[] = [
      ['queries', queryId, queryFile, (text) => text.replace('\nid:', '\nbroken: [unclosed\nid:')],
      ['auth', 'auth-flow', 'docs/specs/backend/auth.md', (text) => text.replace('providers: [email]', 'providers: [unclosed')],
      ['design_tokens', 'design-tokens', 'docs/specs/frontend/design/tokens.md', (text) => text.replace('brand:\n', 'brand: [unclosed\n')],
    ];
    declare(tree, ['implemented: []']);

    for (const [kind, id, file, breakIt] of cases) {
      const base = writeBase([id]);
      const clean = (await verifyAll(tree, base)).result;
      const restore = edit(tree, file, breakIt);
      try {
        const broken = (await verifyAll(tree, base)).result;
        const p14 = (result: PipelineResult): readonly Finding[] => result.findings.filter((finding) => finding.verifier === 'P14' && finding.severity === 'error');

        // 対照: 読めているとき、その id は持ち主に居るので、消えたことを名指す P14(error)が 1 件。
        expect(p14(clean).map((finding) => finding.message), kind).toEqual([`base の実装の範囲にあった ${id} が範囲から消えています(仕様を廃止するときだけ消せます)`]);
        // 読めないとき: 持ち主から消えるが「仕様ごと廃止された」とは数えない(id の件数の行にも載らない)。種類を名指す集約の error が付く。
        expect(p14(broken).some((finding) => finding.message.includes(kind)), kind).toBe(true);
        expect(p14(broken).some((finding) => finding.message.includes(`${id} が範囲から消えています`)), kind).toBe(true);
      } finally {
        restore();
      }
    }
  }, SLOW);

  it('G8: アイコンのファイルの不在は error のとき(placeholder 無し)だけ印が付く。`brand.placeholder` があれば warning で、印も throw も無い', async () => {
    declare(tree, ['implemented: []']);
    const withoutPlaceholder = (await verifyAll(tree)).result;
    const restore = edit(tree, 'docs/specs/frontend/design/tokens.md', (text) => text.replace('brand:\n  icon:', 'brand:\n  placeholder:\n    reason: 実物のロゴができるまでの仮のアイコン\n  icon:'));
    try {
      const { result } = await verifyAll(tree);

      expect(withoutPlaceholder.relieved.some((finding) => finding.verifier === 'G8' && finding.severity === 'error' && finding.absentFor?.id === 'design-tokens')).toBe(true);
      // 書き方が正しい(マッピング + reason)ので、デザイントークンの読み込みは何も言わない(読み損ねると G8 は error のままになる)。
      expect(result.findings.filter((finding) => finding.message.includes('brand.placeholder') || finding.message.includes('brand の'))).toEqual([]);
      const g8 = result.findings.filter((finding) => finding.verifier === 'G8' && finding.message.includes('が指すファイル'));
      expect(g8.map((finding) => finding.severity)).toEqual(['warning']);
      expect(g8[0]?.absentFor).toBeUndefined();
      expect(result.relieved.some((finding) => finding.verifier === 'G8' && finding.message.includes('が指すファイル'))).toBe(false);
    } finally {
      restore();
    }
  }, SLOW);
});

describe('負例(題材 stores): 宣言の無い連携の置き場・設定の読み・登録の食い違いは、範囲で消えない', () => {
  let tree: Tree;

  beforeAll(async () => {
    tree = await openTree('stores');
    trees.push(tree);
  }, SLOW);

  it('キーが無い: 印のついた指摘は全部、許す文面の表に当たる', async () => {
    declare(tree, null);

    const { result } = await verifyAll(tree);

    expect(taggedOf(result.findings).length).toBeGreaterThan(0);
    expect(offTemplate(result.findings)).toEqual([]);
  }, SLOW);

  it('`implemented: []`: 宣言していない設定の読み(K1)・口の登録の食い違い(J2)・ホストの設定の不在(J2)は残る', async () => {
    declare(tree, ['implemented: []']);

    const { result } = await verifyAll(tree);
    const errors = errorsOf(result.findings);

    expect(errors.some((finding) => finding.verifier === 'K1' && finding.message.includes('が設定カタログにありません'))).toBe(true);
    expect(errors.some((finding) => finding.verifier === 'J2' && finding.message.includes('に登録されていません'))).toBe(true);
    expect(errors.some((finding) => finding.verifier === 'J2' && finding.message.startsWith('app/vercel.json がありません'))).toBe(true);
    // ジョブの実装と endpoint の Route Handler の不在は不在なので範囲の外へ移る。
    expect(result.relieved.some((finding) => finding.verifier === 'J2' && finding.absentFor?.id === 'job-catalog')).toBe(true);
  }, SLOW);

  it('負例(X1 / J3): どの分類にも当たらないディレクトリ・宣言に無い pg_cron の登録は、`[]` でも残る', async () => {
    plant(tree, 'app/src/infrastructure/external/stray.ts', 'export const stray = 1;\n');
    plant(tree, 'supabase/migrations/20990101000000_stray_cron.sql', "select cron.schedule('stray_job', '0 * * * *', $$select 1$$);\n");
    declare(tree, ['implemented: []']);

    const { result } = await verifyAll(tree);
    const errors = errorsOf(result.findings);

    expect(errors.some((finding) => finding.verifier === 'X1' && finding.message.includes('どの分類'))).toBe(true);
    expect(errors.some((finding) => finding.verifier === 'J3' && finding.message.includes('scheduler: database として宣言されていません'))).toBe(true);
    expect(result.relieved.some((finding) => finding.message.includes('infrastructure/external') || finding.message.includes('pg_cron'))).toBe(false);
  }, SLOW);
});

/** base の product.md(`implemented` の id を並べる)を木の外に書く。 */
function writeBase(ids: readonly string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'implemented-scope-base-'));
  baseDirs.push(dir);
  const file = path.join(dir, 'product.md');
  const lines = ids.length === 0 ? 'implemented: []' : `implemented:\n${ids.map((id) => `  - ${id}`).join('\n')}`;
  writeFileSync(file, `---\ndoc_type: product_roots\nscope: common\nid: product-roots\nname: sample\nroots:\n  specs: spec\n  book: read\n  generated: impl/src/generated\n  migrations: db/migrations\nuses:\n  - actions\n${lines}\n---\n`);
  return file;
}

describe('題材 expenses: 応用の参照の呼び出しの不在と、不変条件の読み込みの失敗', () => {
  let tree: Tree;
  beforeAll(async () => {
    tree = await openTree('expenses');
    trees.push(tree);
  }, SLOW);

  it('V10: ref は export されているが呼ばれていない指摘は「あるが配線が無い」ので、`[]` でも外れない', async () => {
    plant(tree, 'app/src/domain/claim-rules.ts', 'export function assertClaimHasLines(): void {}\nexport function claimTotalAmount(): number {\n  return 0;\n}\n');
    declare(tree, ['implemented: []']);

    const { result } = await verifyAll(tree);
    const notCalled = (finding: Finding): boolean => finding.verifier === 'V10' && finding.message.includes('のどこからも呼ばれていません');

    expect(errorsOf(result.findings).some(notCalled)).toBe(true);
    expect(result.relieved.some(notCalled)).toBe(false);
    expect(taggedOf(result.findings).some(notCalled)).toBe(false);
  }, SLOW);

  it('P14: 不変条件の読み込みに error があるとき、base の不変条件の id は「仕様から消えた」と数えず P14 の error になる', async () => {
    const invariants = path.join(tree.run.roots.specs, 'domain', 'claim', 'invariants.md');
    const base = writeBase(['INV-CLAIM-001']);
    declare(tree, ['implemented: []']);
    const clean = (await verifyAll(tree, base)).result;
    const restore = edit(tree, invariants, (text) => text.replace('\nid:', '\nbroken: [unclosed\nid:'));
    try {
      const broken = (await verifyAll(tree, base)).result;

      // 読めているのに id が無い(`[]` は base の id を消した)→ 仕様はまだあるので P14 の error(対照)。
      expect(clean.findings.filter((finding) => finding.verifier === 'P14').length).toBe(1);
      // 読めなかったとき: 消えたのか読めないだけなのか分からないので、同じく P14 の error。
      expect(broken.findings.filter((finding) => finding.verifier === 'P14' && finding.severity === 'error').length).toBeGreaterThanOrEqual(1);
    } finally {
      restore();
    }
  }, SLOW);
});
