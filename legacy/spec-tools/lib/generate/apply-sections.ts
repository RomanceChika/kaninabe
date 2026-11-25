/**
 * 生成セクション(`GeneratedSection` をファイルごとにまとめたもの)を実ファイルへ適用する I/O 境界。
 *
 * `cli/generate-docs.ts` の書き込みループを切り出したものである。CLI に残したままだと
 * 「新規プロジェクト(空仕様)で generate が完走するか」をテストするために CLI プロセス全体を
 * 動かす必要が出るため、ここへ出して直接呼べる形にした(`lib/compose/verify-pipeline.ts` を
 * `cli/verify-docs.ts` から切り出したのと同じ理由)。
 *
 * 2 つのモードがある。
 *   - **ファイル全体モード**(`wholeFile: true`): 無ければ新規作成する(生成物そのものであり、
 *     手書きの周辺散文を前提にしないため)。
 *   - **マーカー差し込みモード**: 既存の手書き本文の中にマーカーを探して置き換えるだけであり、
 *     ファイルそのものは作れない。**対象ファイルが無ければ「何も書かない」に倒す**
 *     (新規プロジェクトでは一覧の置き場 `specs/{backend,frontend}/**\/README.md` 等をまだ
 *     手で作っていないことが普通にあるため。ENOENT で generate 全体を落とさない —
 *     BACKLOG「空仕様で generate が成立する」)。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { replaceSection } from './markers.js';
import { writeGuarded, writeRefusalsOf, type WriteRefusal } from './write-gate.js';
import { sanitizeBookMarkdown } from './book-sanitize.js';
import { childEnvOutsideRoot } from '../io/safe-path.js';
import { currentTrusted, type TrustedHtml } from '../kernel/trusted-html.js';

/** 1 ファイルぶんの生成セクション(複数の生成器が同じファイルへ書けるので配列)。 */
export interface FileSection {
  readonly marker?: string;
  readonly content: string;
  readonly wholeFile?: boolean;
  /** このセクションを出した生成器が登録した例外(省略は今の登録簿全体)。 */
  readonly trusted?: TrustedHtml;
}

/** 適用結果(CLI のサマリ表示・鮮度チェックの終了コード判定に使う)。 */
export interface ApplyResult {
  /** 実際に書いた(または `check` モードで書くはずだった)ファイル。 */
  readonly written: readonly string[];
  /** `check` モードで検出した「生成物が古い」ファイル。 */
  readonly stale: readonly string[];
  /** マーカー差し込み先のファイルが無く、書き込みを飛ばしたもの。 */
  readonly skipped: readonly string[];
  /**
   * 書き込みの関所(`write-gate.ts`)が拒否した書き先。**1 件でもあれば何も書いていない**(読んでもいない)。
   * 呼び手は名指して失敗にする。
   */
  readonly refused: readonly WriteRefusal[];
}

/**
 * 書き出す中身。Markdown は VitePress が Vue のテンプレートとして描くので、注入を無害化してから書く(`book-sanitize.ts`。正常な生成物は変わらない)。
 */
function contentOf(file: string, content: string, trusted: TrustedHtml): string {
  return file.endsWith('.md') ? sanitizeBookMarkdown(content, trusted) : content;
}

/**
 * ファイルごとの生成セクションを適用する。
 *
 * @param byFile ファイル(リポジトリルート相対)→ そのファイルへのセクション一覧
 * @param repoRoot リポジトリルートの絶対パス
 * @param options `check: true` なら書き込まず差分の有無だけを見る(`npm run generate:check`)。
 *   `trees` は書いてよい木(`writableTreesOf`)—— 書き先がこの外・途中にリンクがある・綴りが不正なら、**全ファイルについて何も読まず何も書かず**に `refused` で返す
 * @param log 1 行報告の受け口(`console.log` 相当。既定は何もしない)
 * @returns 書いた・古かった・飛ばしたファイルの一覧
 */
export function applyGeneratedSections(
  byFile: ReadonlyMap<string, readonly FileSection[]>,
  repoRoot: string,
  options: { readonly check: boolean; readonly trees: readonly string[]; readonly trusted?: TrustedHtml },
  log: (line: string) => void = () => undefined,
): ApplyResult {
  const written: string[] = [];
  const stale: string[] = [];
  const skipped: string[] = [];

  // 書く前に、全ファイルの書き先を関所で検査する(一部だけ書いて止まる状態を作らない。読む側も同じ: リンクの先を読まない)。
  const refused = writeRefusalsOf(repoRoot, byFile.keys(), options.trees);
  if (refused.length > 0) return { written, stale, skipped, refused };
  // 生成器の登録簿に食い違いがあれば、生成器の不具合なので何も書かない(名指して拒否する)。
  const trusted = options.trusted ?? currentTrusted();
  if (trusted.problems.length > 0) return { written, stale, skipped, refused: trusted.problems.map((reason) => ({ file: '(生成器の登録簿)', reason })) };

  for (const [file, sections] of byFile) {
    const absPath = path.join(repoRoot, file);
    const whole = sections.find((section) => section.wholeFile === true);
    let original: string | null;
    let updated: string;

    if (whole !== undefined) {
      original = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf-8') : null;
      updated = contentOf(file, whole.content, whole.trusted ?? trusted);
    } else if (!fs.existsSync(absPath)) {
      log(`警告: ${file} が無いためマーカーの差し込みをスキップしました`);
      skipped.push(file);
      continue;
    } else {
      original = fs.readFileSync(absPath, 'utf-8');
      updated = original;
      for (const section of sections) {
        if (section.marker === undefined) continue;
        const result = replaceSection(updated, section.marker, contentOf(file, section.content, section.trusted ?? trusted));
        if (!result.found) {
          log(`警告: ${file} にマーカー ${section.marker} がありません(スキップ)`);
          continue;
        }
        updated = result.source;
      }
    }

    if (updated === original) continue;
    if (options.check) {
      log(`鮮度エラー: ${file} の生成物が古くなっています(npm run generate を実行してください)`);
      stale.push(file);
      continue;
    }
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const failure = writeGuarded(absPath, updated);
    if (failure !== null) {
      // 検査のあとでリンクに差し替えられた等。以降は書かずに止める(書いた分は written に残る)。
      return { written, stale, skipped, refused: [{ file, reason: failure }] };
    }
    written.push(file);
    log(`生成: ${file}`);
  }

  return { written, stale, skipped, refused };
}

/** 生成物であることの目印(ファイル先頭の AUTO-GENERATED ヘッダ)。 */
const GENERATED_MARK = 'AUTO-GENERATED';

/** 目印を探す範囲(先頭の数行で足りる)。 */
const MARK_WINDOW = 400;

/**
 * **宣言から出ない生成ファイル**(余分)を探す。
 *
 * 生成物のファイル名を仕様に宣言させる方式(`functions[].migration` / `saves[].migration`)には、
 * 鮮度チェックが見ない穴がある —— **宣言を書き換えたときに、前の名前で書き出したファイルが
 * そのまま残る**(同じバッチ内で採番をやり直したときの取り残し)。生成器は「宣言された名前」
 * しか知らないので、余分は誰も落とさないまま歴史に入り、**どの仕様からも再生成できない
 * 生成物**になる(束 ⑳-2 の独立レビュー 2-A が実測した)。
 *
 * 対象を**git が追跡していないファイル**に限るのがこの検査の肝である。適用済みの生成
 * migration は追跡済みで、名前を新しくする規則(migrations.md §生成 migration)により
 * 宣言から外れたまま歴史として残るのが正しい —— それを余分と呼ぶと規則と衝突する。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param dir 走査するディレクトリ(リポジトリルート相対)
 * @param declared この実行で生成したファイル(リポジトリルート相対)
 * @param log 1 行報告の受け口(git が使えないときの警告)
 * @returns 余分なファイル(リポジトリルート相対。git が使えなければ空)
 */
export function findOrphanGenerated(
  repoRoot: string,
  dir: string,
  declared: ReadonlySet<string>,
  log: (line: string) => void = () => undefined,
): readonly string[] {
  const untracked = untrackedFiles(repoRoot, dir, log);
  return untracked
    .filter((file) => !declared.has(file))
    .filter((file) => {
      const absolute = path.join(repoRoot, file);
      if (!fs.existsSync(absolute)) return false;
      return fs.readFileSync(absolute, 'utf-8').slice(0, MARK_WINDOW).includes(GENERATED_MARK);
    })
    .sort();
}

/** git が追跡していないファイル(リポジトリルート相対)。git が使えなければ空。 */
function untrackedFiles(repoRoot: string, dir: string, log: (line: string) => void): readonly string[] {
  try {
    const output = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', dir], {
      cwd: repoRoot,
      // PATH から根の中と node_modules を落とす(依存の偽の git を拾わない。9 回目 C9-5)。
      env: childEnvOutsideRoot(process.env, repoRoot),
      encoding: 'utf-8',
      // git そのものが使えない置き場(リポジトリ外)では、その旨を 1 行で報告する ——
      // git の生のエラー出力は読み手の助けにならないので捨てる。
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.split('\n').filter((line) => line.trim() !== '');
  } catch {
    log(`警告: git が使えないため ${dir} の余分な生成ファイルの検出をスキップしました`);
    return [];
  }
}

/**
 * **その置き場ぜんたいが生成物**であるディレクトリの余分を探す(束 ⑳-5b-b)。
 *
 * `findOrphanGenerated` との違いは 2 つあり、どちらも「置き場の性質」から来る。
 *
 * - **追跡済みでも余分である。** migrations は追記専用の歴史なので、宣言から外れた追跡済みの
 *   ファイルが残るのが正しい。結果表の元データにはその事情が無く、置き場の中身は毎回まるごと
 *   書き直される —— 集約を 1 つリネームすると、**どの仕様からも出ない json** が歴史に入る。
 * - **目印を見ない。** JSON はコメントを書けないので `AUTO-GENERATED` の行を持てない。
 *   置き場ぜんたいが生成物である以上、「宣言集合に無いファイルは全部余分」で足りる。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param dir 走査するディレクトリ(リポジトリルート相対。中身は全部が生成物)
 * @param declared この実行で生成したファイル(リポジトリルート相対)
 * @returns 余分なファイル(リポジトリルート相対)
 */
export function findUndeclaredInGeneratedDir(
  repoRoot: string,
  dir: string,
  declared: ReadonlySet<string>,
): readonly string[] {
  const absolute = path.join(repoRoot, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${dir}/${entry.name}`)
    .filter((file) => !declared.has(file))
    .sort();
}

/** 本の根の下の、生成器が書かないファイル(二値は生成器が写せない。中身は G8 が実装の原本と突き合わせる)。本の根からの相対。 */
const BOOK_HAND_COPIES: readonly string[] = ['assets/brand-icon.png'];

/**
 * **本の根の下の、宣言の無いファイル**を探す(点検 13 回目 C13-7)。本の木は全部が生成物で、`book:open` がそのまま配る。迷い込んだ HTML を鮮度の検査が見ないと、
 * 検査の口を通っていないページが同じオリジンで配られる。プレビューの置き場(製品がコミットする入力。`book:open` は CSP の見出しを付けて配る)と `BOOK_HAND_COPIES` の行だけを外す。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param bookRoot 本の根(リポジトリルート相対)
 * @param declared この実行で生成したファイル(リポジトリルート相対)
 * @param previewsRoot プレビューの置き場(リポジトリルート相対。無い製品は null)
 * @returns 宣言の無いファイル(リポジトリルート相対。リンクも数える)
 */
export function findStrayInBook(repoRoot: string, bookRoot: string, declared: ReadonlySet<string>, previewsRoot: string | null): readonly string[] {
  const stray: string[] = [];
  const walk = (dir: string): void => {
    if (dir === previewsRoot) return;
    for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (!declared.has(file) && !BOOK_HAND_COPIES.some((copy) => file === `${bookRoot}/${copy}`)) stray.push(file);
    }
  };
  if (fs.existsSync(path.join(repoRoot, bookRoot))) walk(bookRoot);
  return stray.sort();
}
