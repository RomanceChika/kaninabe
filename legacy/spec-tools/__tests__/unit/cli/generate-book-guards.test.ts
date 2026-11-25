/**
 * ハンドブックだけを出す本物の CLI(`cli/generate-book.ts`)の、**未選択の種類の章を生成しないこと**と
 * **出力先の木の別名で本物のハンドブックを上書きしないこと**を別プロセスで見る
 * (P2-1 / P2-2 の確認)。
 *
 *   1. **P2-1(未選択)** — `uses` から jobs だけを外し、有効な jobs.md を置き場に残す。章は生成せず(材料にも混ぜず)、
 *      未選択と出る。出力先に前回の jobs の章が残っていれば名指し + 0 以外で終わる。対照は
 *      generate-book-inputs.test.ts の「選択済み + 読込済み 0 件(実行)/ 選択済み + ファイルが無い(阻害)」
 *   2. **P2-2(出力先の別名)** — 出力先の book の根・1 ファイル・assets 配下のディレクトリが製品の本物のハンドブックへの
 *      別名(シンボリックリンク)なら、書く前に全部検査して全体を拒否する(一部だけ書いた、を作らない)。
 *      本物のファイルの hash は不変・出力先にも何も書かれない。対照: 普通の独立した出力先は通る
 *   3. **大文字小文字だけ違う `--out`** — 大文字小文字を区別しないファイルシステム(macOS の既定)では、製品の根を小文字に綴った
 *      `--out` も同じ場所。綴りの違いで別の置き場と読まず、止まる(区別するファイルシステムでは前提が成り立たないので飛ばす)
 *
 * 使い捨ての製品の写しに対して実行する(題材の fixture は触らない)。起動は 7 回に絞る(1 回が数秒かかる)。
 */

import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRODUCT_DECL_FILE } from '../../../lib/io/paths.js';
import type { CliRun } from '../../helpers/run-tool-cli.js';
import { cleanupTemps, copiedSample, editFile, filesOf, fingerprintOf, read, runBook, SLOW, temp } from '../../helpers/book-entry-fixture.js';

afterAll(cleanupTemps);

const JOBS = 'docs/specs/backend/jobs.md';
const JOBS_CHAPTER = 'docs/book/jobs.html';
/** jobs 以外の、持ち主の章がある未選択の種類の例(題材は config を採っていない)。 */
const CONFIG_CHAPTER = 'docs/book/config.html';

/** 本物のハンドブックに見立てるファイルの本文(製品の book の根に置く)。 */
const REAL_README = '本物のハンドブックの README(別名越しに書き換えられてはならない)\n';
const REAL_RESULT = '{"real":"本物の結果表(別名越しに書き換えられてはならない)"}\n';

/** 標準エラーの「古い章が残っている」の行。 */
function staleLine(stderr: string): string {
  return stderr.split('\n').find((line) => line.startsWith('古い章が残っている')) ?? '';
}

/** 入力の状態の行(`種類: 未実施 / 阻害 — …`)を種類で引く。 */
function inputLine(stdout: string, kind: string): string | undefined {
  return stdout.split('\n').find((line) => line.startsWith(`  ${kind}: `));
}

interface Unselected {
  readonly root: string;
  readonly clean: CliRun;
  readonly cleanOut: string;
  /** 対照: jobs.md を置き場から消した写しの出力(未選択なら、jobs.md の有無で出力は 1 バイトも変わらない)。 */
  readonly withoutFileOut: string;
  readonly stale: CliRun;
  readonly staleOut: string;
}

/** jobs を `uses` から外し、有効な jobs.md は置き場に残した写し(P2-1 の反例)。 */
function runUnselected(): Unselected {
  const root = copiedSample('unselected-jobs');
  editFile(root, PRODUCT_DECL_FILE, (text) => text.replace('  - jobs\n', ''));
  const cleanOut = temp('unselected-clean-out');
  const clean = runBook(root, '--out', cleanOut);
  const withoutFileRoot = copiedSample('unselected-jobs-removed');
  editFile(withoutFileRoot, PRODUCT_DECL_FILE, (text) => text.replace('  - jobs\n', ''));
  rmSync(path.join(withoutFileRoot, JOBS));
  const withoutFileOut = temp('unselected-without-file-out');
  runBook(withoutFileRoot, '--out', withoutFileOut);
  const staleOut = temp('unselected-stale-out');
  mkdirSync(path.join(staleOut, 'docs/book'), { recursive: true });
  writeFileSync(path.join(staleOut, JOBS_CHAPTER), '前回の生成の jobs の章\n');
  writeFileSync(path.join(staleOut, CONFIG_CHAPTER), '前回の生成の config の章\n');
  const stale = runBook(root, '--out', staleOut);
  return { root, clean, cleanOut, withoutFileOut, stale, staleOut };
}

interface Aliased {
  readonly bookAlias: CliRun;
  readonly bookAliasOut: string;
  readonly childAlias: CliRun;
  readonly childAliasOut: string;
  readonly independent: CliRun;
  readonly realBefore: ReadonlyMap<string, string>;
  readonly realAfter: ReadonlyMap<string, string>;
  readonly root: string;
}

/** 製品に本物のハンドブックの見張りを置き、出力先の木の別名ごとに実行する(P2-2 の反例)。 */
function runAliased(): Aliased {
  const root = copiedSample('aliased');
  mkdirSync(path.join(root, 'docs/book/assets/results'), { recursive: true });
  writeFileSync(path.join(root, 'docs/book/index.html'), REAL_README);
  writeFileSync(path.join(root, 'docs/book/assets/results/item.json'), REAL_RESULT);
  const realBefore = fingerprintOf(root);

  // (a) 出力先の book ディレクトリそのものが、製品の book への別名。
  const bookAliasOut = temp('aliased-book-out');
  mkdirSync(path.join(bookAliasOut, 'docs'), { recursive: true });
  symlinkSync(path.join(root, 'docs/book'), path.join(bookAliasOut, 'docs/book'));
  const bookAlias = runBook(root, '--out', bookAliasOut);

  // (b) 出力先の 1 ファイルの別名 + (c) assets 配下のディレクトリの別名(1 回の実行で両方を言う = 全件を先に検査する)。
  const childAliasOut = temp('aliased-child-out');
  mkdirSync(path.join(childAliasOut, 'docs/book/assets'), { recursive: true });
  symlinkSync(path.join(root, 'docs/book/index.html'), path.join(childAliasOut, 'docs/book/index.html'));
  symlinkSync(path.join(root, 'docs/book/assets/results'), path.join(childAliasOut, 'docs/book/assets/results'));
  const childAlias = runBook(root, '--out', childAliasOut);

  // 対照: 普通の独立した出力先は通る。
  const independent = runBook(root, '--out', temp('aliased-independent-out'));
  return { bookAlias, bookAliasOut, childAlias, childAliasOut, independent, realBefore, realAfter: fingerprintOf(root), root };
}

interface CaseVariant {
  readonly run: CliRun;
  readonly before: ReadonlyMap<string, string>;
  readonly after: ReadonlyMap<string, string>;
}

/** 綴りを変えたパスが実在するか(大文字小文字を区別しないファイルシステムか)。 */
const insensitive = import.meta.filename.toUpperCase() !== import.meta.filename && existsSync(import.meta.filename.toUpperCase());

/** `--out` に、製品の根を小文字にした綴りを渡す(大文字小文字を区別しないファイルシステムでは同じ場所)。 */
function runCaseVariant(): CaseVariant {
  const root = copiedSample('CaseRoot');
  const lower = root.toLowerCase();
  const before = fingerprintOf(root);
  const run: CliRun = insensitive ? runBook(root, '--out', lower) : { status: null, stdout: '', stderr: '' };
  return { run, before, after: fingerprintOf(root) };
}

let unselected: Unselected;
let aliased: Aliased;
let caseVariant: CaseVariant;

beforeAll(() => {
  unselected = runUnselected();
  aliased = runAliased();
  caseVariant = runCaseVariant();
}, SLOW);

describe('P2-1: 未選択の種類の章を生成しない(有効な仕様ファイルが置き場に残っていても)', () => {
  it('反例(jobs を uses から外し、有効な jobs.md を残す): 章は生成せず、未実施と出る。終了コードは 0', () => {
    const { clean, cleanOut, root } = unselected;
    expect(read(root, JOBS)).toContain('job_spec');
    expect(clean.status).toBe(0);
    expect(existsSync(path.join(cleanOut, JOBS_CHAPTER))).toBe(false);
    expect(inputLine(clean.stdout, 'jobs')).toContain(`jobs: 未実施 — 製品が jobs を採っていない(product.md の uses に無い)ので、章 ${JOBS_CHAPTER} は出さない`);
    // 生成していない章を「何も出さなかった生成器」に混ぜない(回していない)。
    expect(clean.stdout).not.toContain('book-jobs');
  });

  it('材料にも混ぜない: 置き場に残した jobs.md の有無で、出力は全ファイルが 1 バイトも変わらない(標識の集計も含む)', () => {
    const { cleanOut, withoutFileOut } = unselected;
    const kept = filesOf(cleanOut);
    expect(kept.length).toBeGreaterThan(0);
    expect(filesOf(withoutFileOut)).toEqual(kept);
    const differing = kept.filter((file) => read(cleanOut, file) !== read(withoutFileOut, file));
    expect(differing).toEqual([]);
    // 宣言そのものも章に出ない。
    const mixed = kept.filter((file) => file.endsWith('.html') && read(cleanOut, file).includes('job-catalog'));
    expect(mixed).toEqual([]);
  });

  it('阻害は混ざらない(採っていない種類は阻害の行を出さない)・標識の置き場の問題で止まらない', () => {
    const { clean } = unselected;
    expect(clean.stdout).not.toContain('jobs: 阻害');
    expect(clean.stderr).not.toContain('標識の置き場エラー');
  });

  it('出力先に前回の未選択の種類の章(jobs・config)が残っていれば、名指しして終了コードは 0 でない(自動では消さない)', () => {
    const { stale, staleOut } = unselected;
    expect(stale.status).toBe(1);
    expect(staleLine(stale.stderr)).toBe(`古い章が残っている(この実行では生成していない): ${CONFIG_CHAPTER} / ${JOBS_CHAPTER}`);
    expect(stale.stdout).toContain('jobs: 未実施 — ');
    expect(stale.stdout).toContain('config: 未実施 — ');
    expect(read(staleOut, JOBS_CHAPTER)).toBe('前回の生成の jobs の章\n');
    expect(read(staleOut, CONFIG_CHAPTER)).toBe('前回の生成の config の章\n');
  });
});

describe('P2-2: 出力先の木の別名で、製品の本物のハンドブックを上書きしない', () => {
  it('(a) 出力先の book ディレクトリ自体が製品の book への別名なら止まる。何も書かれず、本物のファイルの hash は不変', () => {
    const { bookAlias, bookAliasOut, realAfter, realBefore } = aliased;
    expect(bookAlias.status).toBe(1);
    expect(realAfter).toEqual(realBefore);
    expect(readdirSync(path.join(bookAliasOut, 'docs'))).toEqual(['book']);
    expect(existsSync(path.join(bookAliasOut, 'docs/book/actions.html'))).toBe(false);
    expect(bookAlias.stdout).not.toContain('生成:');
  });

  it('(b) 出力先の 1 ファイルが製品のファイルへの別名・(c) assets 配下のディレクトリが別名でも止まる。全件を先に検査するので両方を名指す', () => {
    const { childAlias, childAliasOut, realAfter, realBefore, root } = aliased;
    expect(childAlias.status).toBe(1);
    expect(childAlias.stderr).toContain('docs/book/index.html');
    expect(childAlias.stderr).toContain('docs/book/assets/results');
    expect(childAlias.stderr).toContain('シンボリックリンク');
    expect(realAfter).toEqual(realBefore);
    expect(read(root, 'docs/book/index.html')).toBe(REAL_README);
    expect(read(root, 'docs/book/assets/results/item.json')).toBe(REAL_RESULT);
    // 別名の外に書くはずだった章も 1 本も書かれない(途中で見つけて一部だけ書く、を作らない)。
    expect(existsSync(path.join(childAliasOut, 'docs/book/actions.html'))).toBe(false);
    expect(childAlias.stdout).not.toContain('生成:');
  });

  it('対照: 普通の独立した出力先は通り、製品の本物のハンドブックは前後で同じ', () => {
    const { independent, realAfter, realBefore } = aliased;
    expect(independent.status).toBe(0);
    expect(independent.stdout).toContain('✓ 生成 ');
    expect(realAfter).toEqual(realBefore);
  });
});

describe('P2-2: 大文字小文字だけ違う --out で、製品の本物のハンドブックを上書きしない', () => {
  // 大文字小文字を区別するファイルシステムでは、小文字の綴りは別の場所なので前提が成り立たない(実在するかで判定した結果)。
  it.skipIf(!insensitive)('製品の根を小文字に綴った --out は製品の根と同じ場所として止まる。何も書かれない', () => {
    const { after, before, run } = caseVariant;
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('製品の根と同じ場所');
    expect(after).toEqual(before);
    expect(run.stdout).not.toContain('生成:');
  });
});
