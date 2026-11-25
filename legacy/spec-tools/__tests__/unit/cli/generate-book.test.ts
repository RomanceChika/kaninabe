/**
 * **ハンドブックだけを生成する本物の CLI**(`cli/generate-book.ts`。DB なしの入口)を、別プロセスで実行して見る。
 *
 * 外部レビュー の Q4(2026-10-07):「静的な分離だけでは部分利用の完成ではない。CLI は実の変異の起動を渡すので、DB なしの
 * ハンドブックの実 CLI を限定題材で確かめ、実行 / 未実施 / 阻害の出力と生成先を検証する」。見るのは 4 つ。
 *
 *   1. **生成先** — 書くのは書き込み先の `book` の根の下だけ(migration・実装の部品・テストを 1 本も書かない)。
 *      題材の写しの側(製品の木)は 1 バイトも変わらない(前後の全ファイルの指紋)
 *   2. **出力が範囲の縮みを名指す** — 実行した章と部品・何も出さなかった生成器・入力の状態・未実施(変異の目録)・
 *      未検査(検証の警告・DB への接地)
 *   3. **読み込まないことの実行時の証明** — 子プロセスの読み込みの記録に `lib/sql/**` と `lib/mutation/**` が 1 本も無い。
 *      **対照**として、同じ記録を全部入りの `generate` から取ると両方が現れる(記録が壊れて常に空、を緑にしない)。
 *      **この記録は「この Node の版・この題材・この経路」の観測であり、worker・フック登録前の読み込み・VM などは対象外**
 *      (一般的な隔離の証明ではない。静的な閉包 `CLOSURE_BANS` と併用する)
 *   4. **全部入りの `generate` との比較** — ファイルの集合が同じ。DB に依らない章は 1 バイトも違わず、違う章は
 *      **検証・変異に依る部分を切り出して除けば 1 バイトも違わない**(`book-verification-cut.ts`。許す差の範囲を固定する。
 *      「未集計」の 1 文があれば他の差も許す形にしない)
 *
 * 題材は 2 つ: **DB の宣言を持たない題材**(`library` から data_table と surface の宣言を外した一時の製品)と、
 * **DB の宣言を持つ題材**(`library` そのまま)。どちらも**使い捨てのディレクトリに写して**実行する(題材の fixture は触らない)。
 * 入力の状態・書き先・古い章・件数は `generate-book-inputs.test.ts`。
 * 静的な閉包の見張り(C28)は `lib-layering.test.ts`、同じ文脈での生成器の一覧の一致は `book-generators.test.ts`。
 */

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toRelative } from '../../../lib/io/paths.js';
import { MUTATION_TITLE } from '../../../lib/generate/render/book/mutation-section.js';
import { TOOL_TREE } from '../../helpers/run-tool-cli.js';
import type { RecordedCliRun } from '../../helpers/run-tool-cli.js';
import { cleanupTemps, copiedSample, filesOf, fingerprintOf, read, runBookRecorded, runFullRecorded, SLOW, temp } from '../../helpers/book-entry-fixture.js';
import { pageText } from '../../helpers/book-html.js';
import { cutVerification } from '../../helpers/book-verification-cut.js';

/** 章自身が「検証を回していない」と言う文言(検証を載せない文脈の章が出す。全部入りの章には出ない。手引きは「未集計」とだけ言う箇所もある)。 */
const UNAGGREGATED = /検証の結果が渡されていない|まだ通していない 未集計/;

/** 1 つの題材の実行結果(入口と全部入りを別々の写しで実行したもの)。 */
interface Pair {
  /** 入口を実行した題材の写し(**書き込み先ではない**。実装の木を宣言する製品なので、入口は `--out` の置き場に書く)。 */
  readonly entryRoot: string;
  /** 入口の書き込み先(製品の木と同じ相対の並びで書く置き場)。 */
  readonly out: string;
  readonly fullRoot: string;
  readonly entryBefore: ReadonlyMap<string, string>;
  readonly entry: RecordedCliRun;
  readonly full: RecordedCliRun;
}

/** 入口と全部入りの `generate` を、同じ題材の別々の写しで実行する(入口は読み込みの記録つき)。 */
function runPair(label: string, withoutDb: boolean): Pair {
  const entryRoot = copiedSample(`${label}-book`, withoutDb);
  const fullRoot = copiedSample(`${label}-full`, withoutDb);
  const out = temp(`${label}-out`);
  const logs = temp(`${label}-logs`);
  mkdirSync(logs, { recursive: true });
  const entryBefore = fingerprintOf(entryRoot);
  const entry = runBookRecorded(entryRoot, path.join(logs, 'entry.log'), '--out', out);
  const full = runFullRecorded(fullRoot, path.join(logs, 'full.log'));
  return { entryRoot, out, fullRoot, entryBefore, entry, full };
}

/** 記録の中で、道具の木の相対パスが正規表現に当たるもの。 */
function loadedMatching(run: RecordedCliRun, pattern: RegExp): readonly string[] {
  return [...new Set(run.loaded.map((file) => toRelative(TOOL_TREE, file)).filter((file) => pattern.test(file)))].sort();
}

/** 標準出力の「実行した章と部品」の列(ファイルの行)。 */
function reportedFiles(stdout: string): readonly string[] {
  const lines = stdout.split('\n');
  const start = lines.findIndex((line) => line.startsWith('実行した章と部品: '));
  const count = Number(/(\d+) ファイル/.exec(lines[start] ?? '')?.[1]);
  return lines
    .slice(start + 1, start + 1 + count)
    .map((line) => line.trim())
    .sort();
}

/** 範囲が縮んだものの行(未実施 / 未検査。入力の状態の行は含めない)の頭(`名前: 状態`)。 */
function shrunkHeads(stdout: string): readonly string[] {
  return stdout
    .split('\n')
    .filter((line) => /^ {2}(変異の目録|検証の警告|DB への接地): (未実施|未検査) — /.test(line))
    .map((line) => line.trim().split(' — ')[0] ?? '');
}

/** 入口の出力の「入力の状態」の行(`種類: 未実施 / 阻害 — …`)の頭。 */
function inputHeads(stdout: string): readonly string[] {
  return stdout
    .split('\n')
    .filter((line) => /^ {2}[a-z_]+: (未実施|阻害) — /.test(line) && !/^ {2}(変異の目録|検証の警告|DB への接地)/.test(line))
    .map((line) => line.trim().split(' — ')[0] ?? '');
}

afterAll(cleanupTemps);

describe('DB の宣言を持たない題材(data_table も surface も無い)', () => {
  let run: Pair;
  beforeAll(() => {
    run = runPair('nodb', true);
  }, SLOW);

  it('成功し、標準エラーは「別物なのでコミットしない」の 1 行だけである', () => {
    expect(run.entry.status).toBe(0);
    expect(run.entry.stderr.trim()).toBe('警告: この入口の出力は generate のハンドブックと別物なのでコミットしない(本物は npm run generate が出す)。全群の検証は回さない(V 群の error だけで止める)ので、仕様の誤りは npm run verify で見る');
  });

  it('生成先: 書くのは書き込み先の book の根の下だけで、migration・実装の部品・テストは 1 本も書かない。題材の写しは 1 バイトも変わらない', () => {
    const written = filesOf(run.out);
    expect(written.length).toBeGreaterThan(10);
    expect(written.filter((file) => !file.startsWith('docs/book/'))).toEqual([]);
    expect(written).toContain('docs/book/index.html');
    expect(written).toContain('docs/book/usecases.html');
    expect(existsSync(path.join(run.out, 'supabase'))).toBe(false);
    expect(existsSync(path.join(run.out, 'app'))).toBe(false);
    expect(fingerprintOf(run.entryRoot), '製品の木は前後で同じ(追加も書き換えも削除も無い)').toEqual(run.entryBefore);
  });

  it('出力: 実行した章と部品が名指しで出て、書いたファイルの全部と一致する。件数は「生成・実際に書いた・変わらなかった」に分かれる', () => {
    const written = filesOf(run.out);
    expect(reportedFiles(run.entry.stdout)).toEqual(written);
    expect(run.entry.stdout).toContain(`✓ 生成 ${written.length} ファイル(実際に書いた ${written.length}・変わらなかった 0)`);
  });

  it('出力: 何も出さなかった生成器を名指しする(採っていない種類の章は入力の状態の行が言うので、ここには無い)', () => {
    const line = run.entry.stdout.split('\n').find((text) => text.startsWith('何も出さなかった生成器'));
    expect(line).toContain('book-results-data');
    expect(line).not.toContain('book-data');
    expect(line).not.toContain('book-config');
    expect(existsSync(path.join(run.out, 'docs/book/data.html'))).toBe(false);
  });

  it('出力: 入力の状態は、採っていない種類を未実施と言い、阻害は 1 件も出さない(採った種類はすべて読めている)', () => {
    expect(inputHeads(run.entry.stdout)).toEqual(['data_tables: 未実施', 'config: 未実施', 'external: 未実施', 'ux_principles: 未実施']);
    expect(run.entry.stdout).not.toContain(': 阻害 — ');
  });

  it('出力: 未実施(変異の目録)と未検査(検証の警告)を名指しする。DB を採っていないので DB への接地の行は出さない', () => {
    expect(shrunkHeads(run.entry.stdout)).toEqual(['変異の目録: 未実施', '検証の警告: 未検査']);
    expect(run.entry.stdout).toContain(MUTATION_TITLE);
    expect(run.entry.stdout).toContain('この入口で範囲が縮んだもの: 2 件');
    expect(run.entry.stdout).not.toContain('DB への接地');
  });

  it('出力: 検証の警告の未検査は、実行した範囲(生成を止める error の判定)と実行していない範囲を分けて言い、完走していない V 群を名指す', () => {
    const note = run.entry.stdout.split('\n').find((line) => line.trim().startsWith('検証の警告: '));
    expect(note).toContain('生成を止める error の判定');
    expect(note).toContain('V16・V17・V18・V19 の判定は完走していない');
    for (const word of ['読み込みの診断', '他の種類の検査', '種類どうしの関係', '実装の木との接地']) expect(note).toContain(word);
  });

  it('保証の章: 入口は変異を回していないので「未実施」と言い、全部入りは回せなかった理由(テーブル仕様が無い)を言う。どちらも「0 行」とは言わない', () => {
    const entry = read(run.out, 'docs/book/guarantees.html');
    const full = read(run.fullRoot, 'docs/book/guarantees.html');
    expect(pageText(entry)).toContain('変異の目録は未実施(この生成の入口は変異を回していない');
    expect(pageText(full)).toContain('変異の目録は、テーブル仕様が読めていないので出さない');
    expect(pageText(entry)).not.toContain('ので出さない');
    for (const text of [entry, full]) expect(pageText(text)).not.toContain('変異の目録 0 行');
  });

  it('実行時の証明(この Node の版・この題材・この経路の観測): 子プロセスは lib/sql/** も lib/mutation/** も lib/compose/verify-pipeline も 1 本も読み込まない', () => {
    expect(loadedMatching(run.entry, /^lib\/(sql|mutation)\//)).toEqual([]);
    expect(loadedMatching(run.entry, /^lib\/compose\/verify-pipeline/), '全検査を束ねる側は SQL の層を読む').toEqual([]);
    // 記録が壊れて空、を緑にしない: 入口と本の生成器は確かに読み込まれている
    expect(loadedMatching(run.entry, /^lib\/generate\/render\/book\//).length).toBeGreaterThan(50);
    expect(loadedMatching(run.entry, /^cli\/generate-book\.ts$/)).toEqual(['cli/generate-book.ts']);
    expect(loadedMatching(run.entry, /^lib\//).length).toBeGreaterThan(200);
  });

  it('対照: 同じ記録を全部入りの generate から取ると、SQL の層も変異の層も読み込まれている(記録が空のまま緑にならない)', () => {
    expect(run.full.status).toBe(0);
    expect(loadedMatching(run.full, /^lib\/sql\//).length).toBeGreaterThan(20);
    expect(loadedMatching(run.full, /^lib\/mutation\//).length).toBeGreaterThan(3);
    expect(loadedMatching(run.full, /^lib\/compose\/verify-pipeline\.ts$/)).toEqual(['lib/compose/verify-pipeline.ts']);
  });

  it('全部入りとの比較: ファイルの集合が同じで、違う章は検証・変異に依る部分を除けば 1 バイトも違わない(許す差の範囲を固定)', () => {
    const entryBook = filesOf(run.out).filter((file) => file.startsWith('docs/book/'));
    const fullBook = filesOf(run.fullRoot).filter((file) => file.startsWith('docs/book/'));
    expect(entryBook).toEqual(fullBook);
    const differing = entryBook.filter((file) => read(run.out, file) !== read(run.fullRoot, file));
    expect(differing.length, '検証を載せない分だけ違う章がある').toBeGreaterThan(5);
    for (const file of differing) {
      expect(cutVerification(read(run.out, file)).lines, `${file}: 検証・変異に依る部分以外は同じ`).toEqual(cutVerification(read(run.fullRoot, file)).lines);
      expect(pageText(read(run.out, file)), `${file}: 入口の章は検証を回していないと自分で言う`).toMatch(UNAGGREGATED);
      expect(pageText(read(run.fullRoot, file)), `${file}: 全部入りの章はそう言わない`).not.toMatch(UNAGGREGATED);
    }
  });

  it('全部入りとの比較: DB にも検証にも依らない章と部品は 1 バイトも違わない', () => {
    for (const file of ['docs/book/index.html', 'docs/book/design.html', 'docs/book/sweep.html', 'docs/book/assets/tokens.css', 'docs/book/assets/summaries.json']) {
      expect(read(run.out, file), file).toBe(read(run.fullRoot, file));
    }
  });
});

describe('DB の宣言を持つ題材(library そのまま)', () => {
  let run: Pair;
  beforeAll(() => {
    run = runPair('db', false);
  }, SLOW);

  it('成功し、DB の宣言があっても SQL の層も変異の層も読み込まない。製品の木は 1 バイトも変わらない', () => {
    expect(run.entry.status).toBe(0);
    expect(loadedMatching(run.entry, /^lib\/(sql|mutation)\//)).toEqual([]);
    expect(fingerprintOf(run.entryRoot)).toEqual(run.entryBefore);
  });

  it('宣言から導く DB の章(データの章・結果表の元データ)は出て、全部入りと 1 バイトも違わない', () => {
    const results = filesOf(run.out).filter((file) => file.startsWith('docs/book/assets/results/'));
    expect(results.length).toBeGreaterThan(3);
    for (const file of ['docs/book/data.html', ...results]) expect(read(run.out, file), file).toBe(read(run.fullRoot, file));
  });

  it('変異の目録は全部入りの保証の章にだけある(入口は節を出さず、章と出力の両方が未実施と言う)', () => {
    const entry = read(run.out, 'docs/book/guarantees.html');
    expect(pageText(read(run.fullRoot, 'docs/book/guarantees.html'))).toContain(MUTATION_TITLE);
    expect(pageText(entry)).not.toContain(MUTATION_TITLE);
    expect(pageText(entry)).toContain('変異の目録は未実施(この生成の入口は変異を回していない');
    expect(pageText(entry)).not.toContain('変異の目録 0 行');
    expect(run.entry.stdout).toContain('変異の目録: 未実施 — ');
  });

  it('DB を採っているので、出力は DB への接地の未検査も名指しする(3 件)', () => {
    expect(shrunkHeads(run.entry.stdout)).toEqual(['変異の目録: 未実施', '検証の警告: 未検査', 'DB への接地: 未検査']);
  });

  it('ファイルの集合は全部入りのハンドブックと同じで、違う章は検証・変異に依る部分を除けば同じ', () => {
    const book = (root: string): readonly string[] => filesOf(root).filter((file) => file.startsWith('docs/book/'));
    expect(book(run.out)).toEqual(book(run.fullRoot));
    for (const file of book(run.out)) {
      expect(cutVerification(read(run.out, file)).lines, file).toEqual(cutVerification(read(run.fullRoot, file)).lines);
    }
  });
});
