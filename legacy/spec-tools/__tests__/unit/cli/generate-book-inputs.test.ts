/**
 * ハンドブックだけを出す本物の CLI(`cli/generate-book.ts`)の、**入力の状態・書き先・古い章・件数**を別プロセスで見る
 * (追加の確認事項を含む)。
 *
 *   1. **入力の状態**(P2) — 採ったのに無い / 壊れている / 仕様を落とした種類は**阻害**(理由つき)で、その種類が持ち主の章は
 *      生成しない。**「材料の種類が無い」と言わない**。採っていない種類は未実施・読めて 0 件の種類は実行(行を出さない)。
 *      無関係な章は止めない。反例: jobs を採ったまま jobs.md を消す
 *   2. **古い章が残る経路** — 止めた章のファイルが書き込み先に前回の生成で残っていれば、名指しして終了コードを 0 にしない
 *      (自動では消さない)
 *   3. **本物のハンドブックを上書きしない** — 実装の木(`app`)を宣言する製品は `--out` が無ければ書かずに止まる。
 *      実装の木の無い製品は従来どおり `book` の根に書き、book の外の既存ファイル(実装・migration・仕様の見張り)は 1 バイトも変えず、消さない
 *   4. **件数** — 「生成した N・実際に書いた M・変わらなかった K」
 *
 * 使い捨ての製品の写しに対して実行する(題材の fixture は触らない)。**実行 1 回が数秒かかり、負荷の高い日は pre-commit の
 * 時間切れを誘う**ので、起動は 8 回に絞る(前は 18 回)。絞り方は 2 つ:
 *   - 独立した「欠け方」(jobs の欠落・仕様を 1 枚落とした query・0 件の usecases)は、**互いの出力を濁らせない別の種類**なので
 *     1 つの写しに重ね、1 回の出力から全部読む(阻害の行は**ちょうど 2 本**と言う形で、どれか 1 つが他へ漏れれば赤になる)。
 *     重ねた写しの上で、件数の 3 回・古い章の 1 回・書き先の止まり方 3 回も続けて回す
 *   - 引数の綴りの解釈(`--out` の値・製品の根との同一判定の純関数)は `book-entry-plan.test.ts` が見ている。
 *     実の入口では、**配線**(シンボリックリンクの別名を畳む `realpathLoose`・値の無い `--out` が引数から落ちないこと)だけを残す
 */

import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRODUCT_DECL_FILE } from '../../../lib/io/paths.js';
import { pageText } from '../../helpers/book-html.js';
import type { CliRun } from '../../helpers/run-tool-cli.js';
import {
  cleanupTemps,
  copiedSample,
  editFile,
  filesOf,
  fingerprintOf,
  plantSentinels,
  read,
  runBook,
  SLOW,
  temp,
} from '../../helpers/book-entry-fixture.js';

afterAll(cleanupTemps);

const JOBS = 'docs/specs/backend/jobs.md';
const JOBS_CHAPTER = 'docs/book/jobs.html';
/** library が採っていない種類(`uses` に無く、置き場にも無い)の章。 */
const CONFIG_CHAPTER = 'docs/book/config.html';
const QUERY_DROPPED = 'docs/specs/backend/queries/item/item_list.md';
const ONE_LINE_WARNING = '警告: この入口の出力は generate のハンドブックと別物なのでコミットしない(本物は npm run generate が出す)。全群の検証は回さない(V 群の error だけで止める)ので、仕様の誤りは npm run verify で見る';

/** 入力の状態の行(`種類: 未実施 / 阻害 — …`)を種類で引く。 */
function inputLine(stdout: string, kind: string): string | undefined {
  return stdout.split('\n').find((line) => line.startsWith(`  ${kind}: `));
}

/** 何も出さなかった生成器の行。 */
function emptyLine(stdout: string): string {
  return stdout.split('\n').find((line) => line.startsWith('何も出さなかった生成器')) ?? '';
}

/** 阻害の行の頭(`種類: 阻害`)を昇順に。 */
function blockedHeads(stdout: string): readonly string[] {
  return stdout
    .split('\n')
    .filter((line) => line.includes(': 阻害 — '))
    .map((line) => line.trim().split(' — ')[0] ?? '')
    .sort();
}

/** 標準エラーの「古い章が残っている」の行。 */
function staleLine(stderr: string): string {
  return stderr.split('\n').find((line) => line.startsWith('古い章が残っている')) ?? '';
}

/** 重ねた写し 1 つの上で回した実行の結果(`beforeAll` が 1 回だけ作る)。 */
interface Overlaid {
  readonly root: string;
  readonly out: string;
  readonly rootBefore: ReadonlyMap<string, string>;
  readonly rootAfter: ReadonlyMap<string, string>;
  readonly sentinels: readonly string[];
  readonly files: readonly string[];
  readonly first: CliRun;
  readonly second: CliRun;
  readonly third: CliRun;
  readonly total: number;
  readonly stale: CliRun;
  readonly staleOut: string;
  readonly refused: CliRun;
  readonly aliased: CliRun;
  readonly noValue: CliRun;
}

/**
 * 重ねた写し: jobs を採ったまま jobs.md を消す(阻害・置き場に無い)+ query_spec を 1 枚読めなくする(阻害・仕様を落とした)+
 * usecases の仕様を 0 枚にする(読めて 0 件 = 実行)。library は config を採っていない(未実施)。実装・migration・仕様・book の外の見張りも置く。
 */
function runOverlaid(): Overlaid {
  const root = copiedSample('overlaid');
  const sentinels = plantSentinels(root);
  rmSync(path.join(root, JOBS));
  writeFileSync(path.join(root, QUERY_DROPPED), 'frontmatter が無い\n');
  rmSync(path.join(root, 'docs/specs/frontend/usecases/borrow_self.md'));
  rmSync(path.join(root, 'docs/specs/frontend/usecases/hold_and_collect.md'));
  const rootBefore = fingerprintOf(root);

  // 件数の 3 回(同じ書き込み先に続けて書く)。1 回目の出力が P2 と書き先の主張の材料にもなる。
  const out = temp('overlaid-out');
  const first = runBook(root, '--out', out);
  const files = filesOf(out);
  const second = runBook(root, '--out', out);
  rmSync(path.join(out, 'docs/book/design.html'), { force: true });
  const third = runBook(root, '--out', out);

  // 古い章: 止めた章(jobs。阻害)と、採っていない種類の章(config)が、書き込み先に前回の生成で残っている。
  const staleOut = temp('overlaid-stale-out');
  mkdirSync(path.join(staleOut, 'docs/book'), { recursive: true });
  writeFileSync(path.join(staleOut, JOBS_CHAPTER), '前回の生成の jobs の章\n');
  writeFileSync(path.join(staleOut, CONFIG_CHAPTER), '前回の生成の config の章\n');
  const stale = runBook(root, '--out', staleOut);

  // 書き先の止まり方(どれも読み込みの前に止まるので、製品の木も書き込み先も変わらない)。
  const refused = runBook(root);
  const link = path.join(temp('overlaid-link'), 'alias');
  symlinkSync(root, link);
  const aliased = runBook(root, '--out', link);
  const noValue = runBook(root, '--out');

  return { root, out, rootBefore, rootAfter: fingerprintOf(root), sentinels, files, first, second, third, total: files.length, stale, staleOut, refused, aliased, noValue };
}

let overlaid: Overlaid;

beforeAll(() => {
  overlaid = runOverlaid();
}, SLOW);

describe('入力の状態(P2): 採ったのに使えない種類を「材料の種類が無い」に変えない', () => {
  it('反例(jobs を採ったまま jobs.md を消す): 阻害の行が出て、jobs の章は生成しない。「材料の種類が無い」とは言わない', () => {
    const { first, out } = overlaid;
    expect(first.status).toBe(0);
    const line = inputLine(first.stdout, 'jobs');
    expect(line).toContain('jobs: 阻害 — jobs を採っているが章の材料へ渡せない(置き場に仕様が無い');
    expect(line).toContain(`この種類を材料にする章は生成していない: ${JOBS_CHAPTER}`);
    expect(existsSync(path.join(out, JOBS_CHAPTER))).toBe(false);
    expect(emptyLine(first.stdout), '阻害は「何も出さなかった生成器」に混ざらない').not.toContain('book-jobs');
    expect(first.stdout).not.toContain('材料の種類が無い');
  });

  it('無関係な章は止めない(ジョブに依らない章は出ている)。止めた章は 1 本だけで、阻害の行は欠けた種類の 2 本(jobs・queries)だけ', () => {
    const { first, out } = overlaid;
    for (const file of ['index.html', 'auth.html', 'notifications.html', 'actions.html', 'review-guide.html']) {
      expect(existsSync(path.join(out, 'docs/book', file)), file).toBe(true);
    }
    expect(blockedHeads(first.stdout), '採っていない config・読めて 0 件の usecases は阻害にならない').toEqual(['jobs: 阻害', 'queries: 阻害']);
    expect(first.stdout.split('この種類を材料にする章は生成していない').length - 1, '章を止めたのは jobs の 1 本だけ').toBe(1);
    expect(first.stdout).toContain('止めていない章がこの種類を読む箇所は、読めた分だけ(読めなければ無い前提)で出ている');
  });

  it('採っていない種類(config。uses に無く、仕様も無い)は阻害ではなく未実施で、章は出ない', () => {
    const { first, out } = overlaid;
    expect(inputLine(first.stdout, 'config')).toContain('config: 未実施 — 製品が config を採っていない(product.md の uses に無い)');
    expect(existsSync(path.join(out, CONFIG_CHAPTER))).toBe(false);
  });

  it('読めて 0 件の種類(採っているが仕様が 1 枚も無い usecases)は実行であり、入力の状態の行を出さない', () => {
    const { first, out } = overlaid;
    expect(inputLine(first.stdout, 'usecases')).toBeUndefined();
    expect(existsSync(path.join(out, 'docs/book/index.html'))).toBe(true);
  });

  it('仕様を 1 枚落とした種類(query_spec が 1 枚読めない)は阻害(読めなかった仕様があってモデルが欠けている)。持ち主の章が無い種類は章を止めない', () => {
    const { first, out } = overlaid;
    const line = inputLine(first.stdout, 'queries');
    expect(line).toContain('queries: 阻害 — queries を採っているが章の材料へ渡せない(読めなかった仕様があってモデルが欠けている');
    expect(line).toContain('この種類だけを材料にする章は無い');
    expect(first.stdout).toContain(QUERY_DROPPED);
    expect(existsSync(path.join(out, 'docs/book/visibility.html')), '可視性の章は複数の種類を読むので止めない').toBe(true);
  });

  it('止めた章のファイルが書き込み先に無ければ、古い章の警告は出ない(標準エラーは別物の警告 1 行だけ)', () => {
    expect(overlaid.first.stderr.trim()).toBe(ONE_LINE_WARNING);
  });

  it('阻害した種類を読んでいる章(止めなかった章)は、冒頭(最初の見出しの直下)に、どの種類が読めず、どの節が読めた分だけかを名指す。読まない章には足さない', () => {
    const { out, first } = overlaid;
    const readme = read(out, 'docs/book/index.html');
    // 注記は題字(`<h1>`)の直後の引用枠に、種類ごとの項目として並ぶ(出力の口 `markup.ts` が作る HTML)。
    const notice = /<\/h1><blockquote class="bf-notice" data-entry-notice="blocked"><ul>(.*?)<\/ul><\/blockquote>/s.exec(readme)?.[1] ?? '';
    const items = (notice.match(/<li>.*?<\/li>/gs) ?? []).map((item) => pageText(item));
    expect(items[0], '最初の項目').toContain('queries が読めない(阻害)入口の出力です');
    expect(items[1]).toContain('jobs が読めない(阻害)入口の出力です');
    expect(items[1]).toContain('jobs を採っているが章の材料へ渡せない(置き場に仕様が無い)');
    expect(items[1]).toContain('この章の「章立て」のうち jobs に依る部分は、読めた分だけ(読めなければ無い前提)で出しています');
    expect(read(out, 'docs/book/sweep.html')).toContain('「ジョブ」');
    expect(read(out, 'docs/book/domain/item.html')).toContain('jobs が読めない(阻害)入口の出力です');
    // jobs も queries も読まない章には足さない(認証の章)。
    expect(read(out, 'docs/book/auth.html')).not.toContain('入口の出力です');
    // 実行報告は、何章の冒頭に名指したかを種類ごとに言う。
    expect(inputLine(first.stdout, 'jobs')).toMatch(/この種類を読む章の冒頭に、どの節が読めた分だけかを名指した\(\d+ 章: /);
    expect(inputLine(first.stdout, 'queries')).toMatch(/この種類を読む章の冒頭に、どの節が読めた分だけかを名指した\(\d+ 章: /);
  });
});

describe('入力の状態(P2): 壊れた(読めない)jobs.md と、実装の木を持たない製品の書き先', () => {
  let root: string;
  let run: CliRun;
  let before: ReadonlyMap<string, string>;
  let sentinels: readonly string[];

  beforeAll(() => {
    // 実装の木の無い製品(仕様だけ)で、jobs.md が壊れている(読めない)。書き先は製品の book の根。
    root = copiedSample('noapp-broken');
    editFile(root, PRODUCT_DECL_FILE, (text) => text.replace(/^ {2}app: app\n/m, ''));
    sentinels = plantSentinels(root);
    writeFileSync(path.join(root, 'docs/book-keep.md'), '見張り: book の根の隣のファイル\n');
    writeFileSync(path.join(root, JOBS), 'frontmatter が無い\n');
    before = fingerprintOf(root);
    run = runBook(root);
  }, SLOW);

  it('壊れた(読めない)jobs.md も阻害で、理由が違う。置き場に無い場合と同じ章を止める', () => {
    expect(run.status).toBe(0);
    expect(inputLine(run.stdout, 'jobs')).toContain('jobs: 阻害 — jobs を採っているが章の材料へ渡せない(読めない・壊れている');
    expect(existsSync(path.join(root, JOBS_CHAPTER))).toBe(false);
    // 止めた章に出るはずだった標識は、生成を止めるエラーにせず「章に出ていない」と名指す(阻害の結果であって別の誤りではない)。
    expect(run.stdout).toContain(`標識が章に出ていない仕様ファイル(阻害した種類のもの。章を止めたか、モデルに入っていないので引用できない): ${JOBS}`);
  });

  it('実装の木を持たない製品(仕様だけ)は従来どおり製品の book の根に書く。book の外の既存ファイルは 1 バイトも変えず、消さない', () => {
    expect(run.stdout).toContain(`書き込み先: ${path.join(root, 'docs/book')}`);
    expect(run.stdout).not.toContain('(--out で指定)');
    const after = fingerprintOf(root);
    const added = [...after.keys()].filter((file) => !before.has(file));
    expect(added.length).toBeGreaterThan(10);
    expect(added.filter((file) => !file.startsWith('docs/book/'))).toEqual([]);
    for (const [file, hash] of before) expect(after.get(file), `${file} は前後で同じ(削除も書き換えも無い)`).toBe(hash);
    for (const sentinel of [...sentinels, 'docs/book-keep.md']) expect(after.has(sentinel), sentinel).toBe(true);
  });
});

describe('古い章が残る経路: 止めた章・採っていない種類の章のファイルが書き込み先に前回の生成で残っている', () => {
  it('阻害した種類(jobs)の章が残っていれば、標準エラーで名指しし、終了コードは 0 でない', () => {
    const { stale } = overlaid;
    expect(stale.status).toBe(1);
    expect(staleLine(stale.stderr)).toContain(JOBS_CHAPTER);
    expect(stale.stdout).toContain('jobs: 阻害 — ');
  });

  it('採っていない種類(config)の章も、前回のものが残っていれば同じに名指す', () => {
    const { stale } = overlaid;
    expect(staleLine(stale.stderr)).toBe(`古い章が残っている(この実行では生成していない): ${CONFIG_CHAPTER} / ${JOBS_CHAPTER}`);
    expect(stale.stdout).toContain('config: 未実施 — ');
  });

  it('自動では消さない(前回の章は 1 バイトも変わらず残り、新しく書き直されもしない)', () => {
    const { staleOut } = overlaid;
    expect(read(staleOut, JOBS_CHAPTER)).toBe('前回の生成の jobs の章\n');
    expect(read(staleOut, CONFIG_CHAPTER)).toBe('前回の生成の config の章\n');
  });
});

describe('書き先: 本物のハンドブックを上書きしない', () => {
  it('実装の木(app)を宣言する製品は --out が無ければ書かずに止まり、製品の木は 1 バイトも変わらない', () => {
    const { refused, rootAfter, rootBefore } = overlaid;
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('この製品は実装の木(app)を持つので、本物のハンドブック(docs/book)は全部入りの generate の生成物です');
    expect(refused.stderr).toContain('--out <dir>');
    expect(refused.stdout).not.toContain('生成:');
    expect(rootAfter).toEqual(rootBefore);
  });

  it('--out が製品の根の別名(シンボリックリンク)を指すと、本物の book の根に書いてしまうので止まる。値の無い --out も止まる', () => {
    const { aliased, noValue, rootAfter, rootBefore } = overlaid;
    expect(aliased.status).toBe(1);
    expect(aliased.stderr).toContain('製品の根と同じ場所');
    expect(noValue.status).toBe(1);
    expect(noValue.stderr).toContain('--out には値(書き込み先の置き場)が要ります');
    expect(rootAfter).toEqual(rootBefore);
  });

  it('--out の置き場には製品と同じ相対の並びで書き、製品の木(実装・migration・仕様・book の外のファイルの見張りを含む)は前後で 1 バイトも変わらない', () => {
    const { first, out, rootAfter, rootBefore, sentinels, files } = overlaid;
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(`書き込み先: ${path.join(out, 'docs/book')}(--out で指定)`);
    expect(rootAfter, '追加も書き換えも削除も無い(件数の 3 回・古い章・書き先の止まり方を回したあとも)').toEqual(rootBefore);
    expect(files.filter((file) => !file.startsWith('docs/book/'))).toEqual([]);
    for (const sentinel of sentinels) expect(existsSync(path.join(out, sentinel)), sentinel).toBe(false);
  });
});

describe('件数: 生成した数と実際に書いた数と変わらなかった数を分ける', () => {
  it('同じ入力の 2 回目は実際に書いた数が 0 になる。1 ファイルだけ消すと 1 になる', () => {
    const { first, second, third, total } = overlaid;
    expect(first.stdout).toContain(`✓ 生成 ${total} ファイル(実際に書いた ${total}・変わらなかった 0)`);
    expect(second.stdout).toContain(`✓ 生成 ${total} ファイル(実際に書いた 0・変わらなかった ${total})`);
    expect(second.stdout).not.toContain('生成: docs/book');
    expect(third.stdout).toContain(`✓ 生成 ${total} ファイル(実際に書いた 1・変わらなかった ${total - 1})`);
  });
});
