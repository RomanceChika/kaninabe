/**
 * **後段を選ばない構成**で全検査を通したとき、後段が受け持つ検査(J2 の Cron の登録の突合・J3・J4)が**未実施**と報告され、
 * 他の検査は変わらず動くこと(部品化 ③-b)を、実ローダー・実パイプラインを通して確かめる(題材 stores を一時ツリーへ写して壊す)。
 *
 * 基準は入力の状態の未選択と同じ: 黙って緑にしない(実行ログと範囲サマリが名指す)・赤にもしない(違反としては数えない)。
 *   - 全部入り(Supabase + Vercel): 口は全部埋まり、未実施の行は出ない。後段の検査の違反(J4)も出る
 *   - 後段なし(プラットフォームの設定だけを持つ後段): J2 / J4 は「ホストの後段がこの構成に無い」・J3 は「プラットフォームの後段 <名前> がこの検査を登録していない」
 *     (プラットフォームの後段は選んでいるので、「この構成に無い」とは言わない)と未実施になる。J4 の違反は出ない。
 *     コアの J2(接地)・ほかの群の違反は全部出る。後段の検査以外の違反は、全部入りと 1 件も違わない
 *   - ホストの後段が J4 を理由つきで対象外と宣言: J4 は「対象外」の 1 行で、未実施の行・範囲サマリの件数には入らない。J4 の違反は出ない
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAllVerifications } from '../../../lib/compose/verify-pipeline.js';
import { verifyInputsOf } from '../../../lib/target-api/contract.js';
import type { Target } from '../../../lib/target-api/contract.js';
import { NEXTJS_TARGET } from '../../../lib/targets/nextjs/target.js';
import { SUPABASE_TARGET } from '../../../lib/targets/supabase/target.js';
import { VERCEL_TARGET } from '../../../lib/targets/vercel/target.js';
import type { Finding } from '../../../lib/kernel/finding.js';
import type { SpecKind } from '../../../lib/model/product/uses.js';
import { barePlatformTarget, selectionOf, TEST_VERIFY_INPUTS } from '../../helpers/platform.js';
import { TEST_ROOTS, writeProductDeclaration } from '../../helpers/product-roots.js';

const STORES = path.join(fileURLToPath(new URL('../../fixtures/samples/', import.meta.url)), 'stores', 'docs', 'specs');
/** 題材 stores が採る種類(その `product.md` と同じ)。 */
const STORES_USES: readonly SpecKind[] = ['actions', 'queries', 'data_tables', 'notifications', 'jobs', 'config', 'auth', 'external', 'surface', 'screens', 'usecases'];

/** 1 つのファイルの 1 箇所を書き換える(書き換え前の文字列が無ければ落とす = 反例が反例でなくなるのを防ぐ)。 */
function rewrite(file: string, from: string, to: string): void {
  const source = readFileSync(file, 'utf8');
  if (!source.includes(from)) throw new Error(`${file} に ${from} が無い`);
  writeFileSync(file, source.replace(from, to));
}

/** 違反を (検査器, 文面) の組にする。 */
const keyOf = (finding: Finding): string => `${finding.verifier}: ${finding.message}`;

/** 後段が受け持つ検査の ID(口の表と同じ)。 */
const TARGET_IDS = new Set(['J2', 'J3', 'J4']);

let repo: string;
let full: Awaited<ReturnType<typeof runAllVerifications>>;
let bare: Awaited<ReturnType<typeof runAllVerifications>>;
let quiet: Awaited<ReturnType<typeof runAllVerifications>>;
let fullLines: string[];
let bareLines: string[];
let quietLines: string[];

beforeAll(async () => {
  repo = mkdtempSync(path.join(tmpdir(), 'target-absence-'));
  writeProductDeclaration(repo, STORES_USES);
  const specs = path.join(repo, TEST_ROOTS.specs);
  cpSync(STORES, specs, { recursive: true });
  const jobs = path.join(specs, 'backend', 'jobs.md');
  // 後段の検査(J4)が落とす: 1 日に複数回の scheduler: host。コアの検査(J2 の接地)が落とす: ドメインに無い発火イベント。
  rewrite(jobs, 'schedule: "0 21 * * *"', 'schedule: "*/5 * * * *"');
  rewrite(jobs, '    scheduler: host\n', '    scheduler: host\n    fires: sales_order.teleport\n');
  const domainRoot = path.join(specs, 'domain');
  fullLines = [];
  bareLines = [];
  quietLines = [];
  full = await runAllVerifications({ ...TEST_VERIFY_INPUTS, domainRoot, log: (line) => fullLines.push(line) });
  bare = await runAllVerifications({ ...verifyInputsOf(selectionOf([barePlatformTarget(), NEXTJS_TARGET])), domainRoot, log: (line) => bareLines.push(line) });
  // J4 を理由つきで対象外と宣言するホスト(J2 は登録する)。
  const quietHost: Target = { ...VERCEL_TARGET, id: 'quiet-host', verifiers: VERCEL_TARGET.verifiers.filter((verifier) => verifier.id === 'J2'), notApplicable: { J4: '頻度の制約を持たないホスト' } };
  quiet = await runAllVerifications({ ...verifyInputsOf(selectionOf([SUPABASE_TARGET, quietHost, NEXTJS_TARGET])), domainRoot, log: (line) => quietLines.push(line) });
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** 後段の検査の口が埋まっていないことの行(`J2: 未実施 — …` の形)。 */
const targetRows = (lines: readonly string[]): string[] => lines.filter((line) => /^J[234]: 未実施 — /.test(line));

describe('後段ありの全部入り', () => {
  it('後段の検査の未実施の行は出ない。後段の検査(J4)もコアの検査(J2 の接地)も違反を出す', () => {
    expect(targetRows(fullLines)).toEqual([]);
    expect(full.skipNotes.filter((line) => /^J[234]: /.test(line))).toEqual([]);
    const verifiers = new Set(full.findings.map((finding) => finding.verifier));
    expect(verifiers.has('J4')).toBe(true);
    expect(full.findings.some((finding) => finding.verifier === 'J2' && finding.message.includes('sales_order.teleport'))).toBe(true);
  });
});

describe('後段なし(後段が検査も生成器も登録しない構成)', () => {
  it('J2 / J3 / J4 が事実どおりの理由で名指しで未実施になり(ホストの後段は選ばれていない = 「この構成に無い」・プラットフォームの後段は選ばれているが J3 を登録していない = 「登録していない」)、範囲サマリ(skipNotes)にも載る', () => {
    expect(targetRows(bareLines).map((line) => line.split(' — ')[0])).toEqual(['J2: 未実施', 'J3: 未実施', 'J4: 未実施']);
    expect(targetRows(bareLines)[0]).toContain('ホストの後段がこの構成に無い');
    expect(targetRows(bareLines)[1]).toContain('プラットフォームの後段 bare-platform がこの検査を登録していない');
    expect(targetRows(bareLines)[1]).not.toContain('この構成に無い');
    expect(targetRows(bareLines)[2]).toContain('ホストの後段がこの構成に無い');
    expect(targetRows(bare.skipNotes)).toEqual(targetRows(bareLines));
  });

  it('後段の検査の違反(J4)は出ない(赤にもしない)。コアの J2(接地)の違反は出る(後段が無くても動く部分は動く)', () => {
    expect(bare.findings.some((finding) => finding.verifier === 'J4')).toBe(false);
    expect(bare.findings.some((finding) => finding.verifier === 'J2' && finding.message.includes('sales_order.teleport'))).toBe(true);
  });

  it('後段が受け持つ検査以外の違反は、全部入りと 1 件も違わない(欠けるのは J4 の違反だけ)', () => {
    const rest = (findings: readonly Finding[]): string[] => findings.filter((finding) => !TARGET_IDS.has(finding.verifier)).map(keyOf);
    expect(rest(bare.findings)).toEqual(rest(full.findings));
    const onlyInFull = full.findings.map(keyOf).filter((key) => !bare.findings.map(keyOf).includes(key));
    expect(onlyInFull.every((key) => key.startsWith('J4: '))).toBe(true);
    expect(onlyInFull.length).toBeGreaterThan(0);
  });

  it('J 群の「実行しました」の行は両方に出る(J1〜J7 のうち口の埋まっていない分だけが未実施の行で縮む)', () => {
    for (const lines of [fullLines, bareLines]) expect(lines.some((line) => line.startsWith('J 群(ジョブ仕様)') && line.includes('実行しました'))).toBe(true);
  });

  it('J 群の見出しは、口が埋まっていない分を除いた範囲を言う(全部入りの見出しは但し書きなし)', () => {
    const head = (lines: readonly string[]): string => lines.find((line) => line.startsWith('J 群(ジョブ仕様)')) ?? '';
    expect(head(bareLines)).toContain('を実行しました(J2 は接地と入口の衝突・閉世界のみ。J3 / J4 は下の未実施)');
    expect(head(fullLines)).toContain('を実行しました。');
  });
});

describe('ホストの後段が J4 を対象外と宣言する構成', () => {
  it('J4 は「対象外」の 1 行。未実施の行は出ず、範囲サマリ(skipNotes)にも載らない。J4 の違反は出ない', () => {
    expect(targetRows(quietLines)).toEqual([]);
    expect(quietLines.filter((line) => line.startsWith('J4: ')).map((line) => line.split(' — ')[0])).toEqual(['J4: 対象外']);
    expect(quietLines.find((line) => line.startsWith('J4: 対象外'))).toContain('頻度の制約を持たないホスト');
    expect(quiet.skipNotes.filter((line) => /^J[234]: /.test(line))).toEqual([]);
    expect(quiet.findings.some((finding) => finding.verifier === 'J4')).toBe(false);
    expect(quietLines.find((line) => line.startsWith('J 群(ジョブ仕様)'))).toContain('(J4 は下の対象外)');
  });

  it('他の違反は全部入りと同じ(欠けるのは J4 の違反だけ)', () => {
    const rest = (findings: readonly Finding[]): string[] => findings.filter((finding) => finding.verifier !== 'J4').map(keyOf);
    expect(rest(quiet.findings)).toEqual(rest(full.findings));
  });
});
