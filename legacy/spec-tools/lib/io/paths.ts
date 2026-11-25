/**
 * ローダー層(lib/trace の loader / scan、lib/docs の loader / template)が共有する
 * ファイルシステムの小道具。
 *
 * `node:fs` に触れてよいのは io 層と層の表(`lib-layers.ts`)で宣言された入口だけで、検証器は
 * `node:fs` を直接 import せず、この小道具(と中身を読む `read-text.ts`)を通す
 * (規約: scripts-code-quality.md「I/O と純粋ロジックの分離」。構造テストが見る)。
 */

import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { ROOT_MESSAGES } from './messages.js';

/** ディレクトリなら true。存在しない・読めない場合は false。 */
export function isDirectory(target: string): boolean {
  return statSync(target, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/** 通常ファイルなら true。存在しない・読めない場合は false。 */
export function isFile(target: string): boolean {
  return statSync(target, { throwIfNoEntry: false })?.isFile() ?? false;
}

/** 既存のものの種類(別名を辿らずに見る)。 */
export type EntryKind = 'absent' | 'symlink' | 'other';

/**
 * パスそのものが何かを、別名(シンボリックリンク)を辿らずに見る。
 * 辿った先が無い宙ぶらりんの別名も `symlink` である(書き込みはその先を作ってしまう)。
 *
 * @param target 見るパス
 */
export function entryKindOf(target: string): EntryKind {
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (stat === undefined) return 'absent';
  return stat.isSymbolicLink() ? 'symlink' : 'other';
}

/**
 * 実在しない場所も含めて、パスの別名を畳む(いちばん近い実在の祖先を実パスにして、残りを足す)。
 * 書き込み先が別の場所と同じ実体かの判定に使う。
 *
 * **OS が持つ綴りで返す**(`realpathSync.native`)。大文字小文字を区別しないファイルシステム(macOS の既定)で、綴りの大文字小文字だけが
 * 違う 2 つのパスが同じ実体なのに別の場所と読まれる(JS の実装はディスク上の綴りに直さない)のを防ぐ。
 *
 * @param file 畳むパス
 */
export function realpathLoose(file: string): string {
  const resolved = resolve(file);
  try {
    return realpathSync.native(resolved);
  } catch {
    const parent = dirname(resolved);
    return parent === resolved ? resolved : join(realpathLoose(parent), basename(resolved));
  }
}

/** ディレクトリ直下の項目を名前順で返す。ドット始まりは除外し、読めない場合は空配列。 */
export function listEntries(dir: string): readonly string[] {
  try {
    return readdirSync(dir)
      .filter((entry) => !entry.startsWith('.'))
      .sort();
  } catch {
    return [];
  }
}

/**
 * 製品の根の宣言ファイルの名前。
 *
 * **仕組みの側が持ってよいパスの綴りはこれ 1 つだけ**である(W3 が値域として執行する)。
 * 実装の木・仕様の木・migration の置き場はすべてこのファイルの中で製品が宣言し、検査器・
 * 生成器・通し実行はその宣言だけを読む。リポジトリ直下に置く理由は `product.md` の本文に書いた
 * (宣言を仕様の木の中に置くと、その木の住所を知るための綴りが別に要って循環する)。
 */
export const PRODUCT_DECL_FILE = 'product.md';

/**
 * **仕組み自身の住所**(リポジトリルート相対)。製品の宣言からは来ない。
 *
 * 製品の根(`product.md` の `roots`)と対になる概念である —— こちらは「検査器・生成器・規約・
 * 約束事のモデルがどこに住んでいるか」で、**どの製品を相手にしても同じ**である。だから綴りを
 * 持ってよく、W3 の相手でもない(W3 が禁じるのは製品の根の綴りである)。
 *
 * ここに 1 か所で置くのは、**製品の根から導いてはならない**からである。規約の木を
 * 「仕様の木の親の `rules`」として導くと、仕様の木を `spec/` に置いた製品で規約が
 * `{repo}/rules` になり、**M 群が黙って消える**(独立レビューの指摘)。分離の手順 ② で
 * 仕組みの住所が変わったら、ここだけが動く。
 */
export const FRAMEWORK_DOCS_DIR = 'docs';

/** 規約文書の木(仕組み自身の住所)。 */
export const FRAMEWORK_RULES_DIR = `${FRAMEWORK_DOCS_DIR}/rules`;

/**
 * 検証器・生成器・CLI・そのテストのパッケージ `@kaninabe/spec-tools` の置き場(仕組み自身の住所)。
 *
 * 束 ②-b でここへ出た(以前は `docs/scripts`)。`lib` / `cli` / `__tests__` はパッケージの直下に
 * 平らに居る。ワークスペースには入れない(ADR-0013。検査器のツールチェーンを製品のビルドに混ぜない)。
 */
export const FRAMEWORK_SPEC_TOOLS_DIR = 'legacy/spec-tools';

/** 仕組みのスクリプト一式の置き場(検証器・生成器・CLI・そのテスト。仕組み自身の住所)。 */
export const FRAMEWORK_SCRIPTS_DIR = FRAMEWORK_SPEC_TOOLS_DIR;

/** 検証器・生成器の置き場(仕組み自身の住所)。 */
export const FRAMEWORK_LIB_DIR = `${FRAMEWORK_SPEC_TOOLS_DIR}/lib`;

/** CLI の置き場(仕組み自身の住所)。 */
export const FRAMEWORK_CLI_DIR = `${FRAMEWORK_SPEC_TOOLS_DIR}/cli`;

/**
 * VitePress のテーマ(ハンドブックの表示の部品と見た目)の置き場(仕組み自身の住所)。
 *
 * 道具(`legacy/spec-tools`)ではなく `docs/` の中に残る。部品の構造テストと見た目の検査は
 * ここを名前で読む(相対パスで道具の木から掘らない)。
 */
export const FRAMEWORK_THEME_DIR = `${FRAMEWORK_DOCS_DIR}/.vitepress/theme`;

/**
 * ハンドブックの人向けの表示の見た目(部品 5 枚の CSS)の置き場(仕組み自身の住所)。
 *
 * ここの CSS は実装の CSS と同じ規約で検査される(G1 生値 / G2 実在 / G7 死語彙)。
 * 製品のトークンを引く CSS であり、トークンを足したら使う側もここに置く。
 */
export const FRAMEWORK_BOOK_FACE_DIR = `${FRAMEWORK_THEME_DIR}/book-face`;

/** 約束事のモデルの置き場(仕組み自身の住所。製品は 1 行も書かない)。 */
export const FRAMEWORK_FORMAL_DIR = 'formal';

/** 仕組み側パッケージ(`@kaninabe/runtime` と `@kaninabe/lint-config`)をまとめて置く木(仕組み自身の住所)。 */
export const FRAMEWORK_PACKAGES_DIR = 'framework';

/** スキル(ルーティング表の実行版)の置き場。中身は手順の索引であり、正典ではない。 */
export const FRAMEWORK_SKILLS_DIR = '.claude/skills';

/**
 * 実行時パッケージ `@kaninabe/runtime` の置き場(仕組み自身の住所)。
 *
 * 束 ①-b でここへ出たもの —— 状態機械・権限・ガードの評価器と実行計画の型(ADR-0013)。
 * 製品はこれを**依存として** import するので、パッケージの中のファイルを読む必要があるのは
 * 「仕組みが自分のソースを走査する」検査(W1 / W2)だけである。
 *
 * 製品の根ではないので W3 の相手ではないが、綴りはここ 1 か所に置く —— 第 2 段で
 * パッケージを別リポジトリへ出す日に動くのはこの 1 行だけになる。
 *
 * **配布物(`dist`)は走査に入らない。** 走査の口はすべて `runtimeSrcPath()`(= `src` 固定)を
 * 通るので、除外リストではなく**構造として**外にある(ADR-0013 の配り方 A の条件 2。ほかの
 * 3 つの宣言は `.gitignore` / framework lint の `ignores` / ルート `vitest.config.mts` の
 * `coverage.exclude`)。
 */
export const FRAMEWORK_RUNTIME_DIR = 'framework/runtime';

/**
 * 境界の規則と自作 ESLint 規則のパッケージ(`@kaninabe/lint-config`)。
 *
 * ここも**仕組み側のコード**であり、層の綴り(`runtime-domain` 等)の唯一の正が住んでいる。
 * 語彙漏れの走査に載せないと、規則の側がアプリの語を持っても誰も落とさない(束 ①-c-b)。
 */
export const FRAMEWORK_LINT_CONFIG_DIR = 'framework/lint-config';

/**
 * 仕組み側のコードとして走査する拡張子(**列挙しない形の値域**)。
 *
 * ここを 1 か所にするのは、走査の母集合が「根 × 拡張子」の掛け算であり、**拡張子の側を各所で
 * 列挙すると `.tsx` や `.cts` が生えた日に黙って外に出る**からである(束 ①-c-b。根の側は
 * `FRAMEWORK_*_DIR` が持つ)。
 */
export const FRAMEWORK_CODE_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'];

/**
 * 実行時パッケージのソースの中のパス。
 *
 * **製品の根を取らない** —— どの製品を相手にしても同じ住所だからである(置き場の配置の `source-root` と対になる
 * 概念で、あちらは宣言と配置から、こちらは仕組み自身の住所から組む)。
 *
 * @param segments パッケージの `src/` からの相対パス
 * @returns リポジトリルート相対のパス
 */
export function runtimeSrcPath(...segments: readonly string[]): string {
  return [FRAMEWORK_RUNTIME_DIR, 'src', ...segments].join('/');
}

/**
 * アプリ実装の木があるか = **仕様と実装の突合が成立する環境か**。
 *
 * 仕様だけを持つリポジトリ(サンプル・規約や実装をまだ書いていない新規プロジェクト)は
 * 正当な形なので、実装を見る項は「無い」ではなく**飛ばす**のが正しい(X1・J2・G8・S7・
 * A11 が同じ判定を共有する)。判定が 2 段になっているのは意図である ——
 * **宣言していない**(別スタック・仕様だけの製品)と**宣言したがまだ無い**(生成前・
 * fixture の実行の途中)はどちらも「突合できない」で、どちらもエラーではない。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param appRoot 宣言された実装の木(リポジトリルート相対)。宣言が無ければ null
 * @returns 実装の木があれば true
 */
export function appGrounded(repoRoot: string, appRoot: string | null): boolean {
  return appRoot !== null && isDirectory(join(repoRoot, appRoot));
}

/** ディレクトリの中の全部の名前(ドット始まりも含む・名前順。読めなければ空)。 */
function allEntries(dir: string): readonly string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/**
 * 走査が読まないファイル名の文字(制御文字・行の区切り・向きを変える文字)。
 *
 * ファイルの名前は生成物のヘッダ(コメント)・報告の行に置かれる。改行などを含む名前は仕様の置き場の形(`{aggregate}/{event}.md` ほか)に
 * 当たり得ないので、**どの検査も生成も読まない**(読んで名前をコメントに写すと、コメントを破れる)。
 */
const UNREADABLE_NAME = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;

/**
 * ディレクトリを再帰的に走査し、述語に合うファイルの絶対パスを返す。**ドット始まりも `build` / `dist` / `coverage` も歩く**(名前で飛ばさない。点検 14 回目 C14-1)。
 * 歩かないのは呼び手が渡す**ちょうどのパス**だけで、出力と依存を根の下に持つ木(実装の木の根・仕組みの木)は `output-paths.ts` の `walkRepoFiles` で歩く。
 *
 * @param root 走査の起点
 * @param accept ファイル名(basename)を受け取り、採用するかを返す述語
 * @param skipped 歩かないディレクトリ(走査の起点からのちょうどのパス。区切りは "/")
 * @returns 見つかったファイルの絶対パス(名前順・深さ優先)
 */
export function walkFiles(root: string, accept: (name: string) => boolean, skipped: readonly string[] = []): string[] {
  const walk = (dir: string, prefix: string): string[] => {
    const found: string[] = [];
    for (const entry of allEntries(dir)) {
      if (UNREADABLE_NAME.test(entry)) continue;
      const target = join(dir, entry);
      if (isDirectory(target)) {
        const path = `${prefix}${entry}`;
        if (!skipped.includes(path)) found.push(...walk(target, `${path}/`));
        continue;
      }
      if (accept(entry)) found.push(target);
    }
    return found;
  };
  return isDirectory(root) ? walk(root, '') : [];
}

/** 基準ディレクトリからの相対パス(区切りは常に "/")。 */
export function toRelative(base: string, absolutePath: string): string {
  return relative(base, absolutePath).split(sep).join('/');
}

/**
 * 起点から上へ**製品の根の宣言**(`product.md`)を探す(**探索はこの 1 本だけ**。`detectRepoRoot` と
 * `requireRepoRoot` はこれを呼ぶ)。
 *
 * @param from 探索の起点(絶対パス)
 * @returns 宣言のあるディレクトリの絶対パス。見つからなければ null
 */
function findRepoRoot(from: string): string | null {
  let current = from;
  for (;;) {
    if (isFile(join(current, PRODUCT_DECL_FILE))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * 起点から上へ**製品の根の宣言**(`product.md`)を探してリポジトリルートを決める。
 * 見つからなければ起点の親を返す(lib/model/loader.ts と同じ規則)。
 *
 * 以前は `.git` を探していた。やめた理由は 2 つある ——
 *   ① `.git` は「git の作業ツリーの境界」であって「製品の境界」ではない。1 リポジトリに
 *      製品が 2 つ並ぶ日(モノレポ)に答えられない。
 *   ② fixture の通し実行が**一時ツリーに空の `.git` を置く**という仕掛けでこの規則を騙していた。
 *      宣言を置けばルートが決まるなら、騙す必要がなくなる(設計メモ §3 の発見 2)。
 *
 * @param from 探索の起点(絶対パス)
 * @returns リポジトリルートの絶対パス
 */
export function detectRepoRoot(from: string): string {
  return findRepoRoot(from) ?? dirname(from);
}

/**
 * 起点から上へ**製品の根の宣言**(`product.md`)を探し、**見つからなければ投げる**。
 *
 * CLI の入口が使う口である。`detectRepoRoot` は見つからないと起点の親に**黙って落ちる**ので、
 * 製品の木の外で道具を呼ぶと嘘の根で動き出す —— 入口ではそれを許さない(文面は `lib/io/messages.ts`)。
 * `detectRepoRoot` の既存の呼び手(仕様のパスから根を探す経路)は挙動を変えない。
 *
 * @param from 探索の起点(絶対パス。CLI は作業ディレクトリを渡す)
 * @returns 宣言のあるディレクトリの絶対パス
 * @throws 起点から上に宣言が無いとき(人に読ませる文言つきの Error)
 */
export function requireRepoRoot(from: string): string {
  const found = findRepoRoot(from);
  if (found === null) throw new Error(ROOT_MESSAGES.notFound(from, PRODUCT_DECL_FILE));
  return found;
}
