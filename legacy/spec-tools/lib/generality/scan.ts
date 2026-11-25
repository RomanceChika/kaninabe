/**
 * 仕組み側コード(legacy/spec-tools/lib の体系全体と、app 側の仕組みに近い層)を走査して、
 * 文字列リテラルの中身を集める I/O 境界。
 *
 * W1(語彙漏れの検査)が「仕様の値域と一致する文字列リテラルが無い」ことを見るための
 * 走査であり、ここではファイルを読むだけで判定は持たない
 * (`verify/application-ref-scan.ts` と同じ、走査と判定の分離)。
 */

import { join } from 'node:path';
import { walkRepoFiles } from '../io/output-paths.js';
import { isDirectory, listEntries, toRelative } from '../io/paths.js';
import { vocabularyScanDirs, vocabularyScanLayers } from '../model/framework-base-dirs.js';
import {
  FRAMEWORK_CLI_DIR,
  FRAMEWORK_CODE_EXTENSIONS,
  FRAMEWORK_FORMAL_DIR,
  FRAMEWORK_LIB_DIR,
  FRAMEWORK_LINT_CONFIG_DIR,
  FRAMEWORK_RUNTIME_DIR,
} from '../io/paths.js';
import type { ProductLayout } from '../model/product/layout.js';
import { e2eRootPath } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import {
  extractLiterals,
  isExcludedPath,
  isScannedFile,
  readText,
  type VocabularyScanHit,
} from './literals.js';

/**
 * 接続の方式ごとの adapter パッケージの置き場(`framework/adapters/{名前}`)の親。
 *
 * adapter は runtime が定める中立のポートを実装する仕組み側のコードである(runtime に依存し、runtime は
 * 知らない。ADR-0013)。旧 runtime の中に居たときは根(`framework/runtime`)に入っていたので、外へ出ても
 * 走査の外に落ちないよう、親ディレクトリを根で指す(adapter が増えても列挙し直さない)。
 */
export const FRAMEWORK_ADAPTERS_DIR = 'framework/adapters';

/** 走査するディレクトリ 1 本の宣言。 */
export interface ScanRoot {
  /** リポジトリルート相対のディレクトリ。 */
  readonly dir: string;
  /** 対象にする拡張子(ドット込み)。 */
  readonly extensions: readonly string[];
  /**
   * 文字列リテラルの取り出し方。既定は TypeScript。
   *
   * `tla` は約束事のモデル(`formal/**`)用である —— TLA+ では `'` が**素数つき変数**
   * (`x'`)であって文字列の引用符ではないので、TS の取り出し方をそのまま当てると
   * 行をまたいだ巨大な「文字列」が湧く。文字列は二重引用符だけで、コメントは `\*` で始まる。
   */
  readonly syntax?: 'ts' | 'tla';
}

/**
 * 走査するディレクトリ(リポジトリルート相対)。
 *
 * 束⑫a の初版は `legacy/spec-tools/lib/{model,auth,notification}` の 3 つに絞っていたが、
 * ユーザー裁定により「仕組み側コードの全域」へ広げる —— 仕様の値域は、検証器・
 * 生成器(`legacy/spec-tools/lib` 全体)だけでなく、5 形の定型・ジョブハンドラ・共有コンポーネント・
 * エンジン・Supabase 接続層(app 側の「仕組み」に当たる層)にも書けてしまうため。
 * `app/src/app/**`(画面の実装)・`app/src/operation/{aggregate}/**`(個々の操作の実装)は
 * **仕組みではなく実装**であり対象外(見つけた既存の穴として報告するに留める)。
 *
 * @param roots 製品が宣言した根
 * @param layout 置き場の配置(層と土台の表の宣言元。部品化 ③-c5)
 */
export function vocabularyScanRoots(roots: ProductRoots, layout: ProductLayout): readonly ScanRoot[] {
  const app = roots.app;
  // 実装の木の中の走査範囲。**層の直下の土台(定型・ジョブ基盤・エンジン・接続層)の一覧を
  // ここに持たない** —— 正は置き場の配置が宣言する層と土台の表(`vocabularyScan: true` の行と、
  // 走査の拡張子を宣言した層。口は lib/model/framework-base-dirs.ts)であり、X1・A11・lint・構造テストも
  // 同じ宣言を読む(免除リストを 6 か所に持たない)。実装の木を持たない製品では 1 本も無い(仕様だけのリポジトリでも壊れない)。
  const declared = vocabularyScanDirs(layout);
  // 実行時パッケージは**根で指す**(宣言にも、中のディレクトリの列挙にも依らない)。列挙して
  // いたあいだはパッケージの 13 本が母集合の外にあり、`operation/ports.ts` の散文が製品の集約名を
  // 持っていた(束 ①-c-b。設計メモ §9-9)。根なら、新しく生えたディレクトリも初日から入る。
  // 全域を見るのは `testing/**` も `scripts/**` も仕組み側のコードだからで、実際に製品の表の
  // 名前が出たのは `testing/` だった。`dist` と `node_modules` は出力の閉じた表(`FRAMEWORK_OUTPUT_PATHS`)が外す。
  const frameworkPackages: readonly ScanRoot[] = [
    { dir: FRAMEWORK_RUNTIME_DIR, extensions: FRAMEWORK_CODE_EXTENSIONS },
    // 接続の方式ごとの adapter(PostgREST ほか)。runtime の外へ出ても、語彙漏れの走査から落ちない。
    { dir: FRAMEWORK_ADAPTERS_DIR, extensions: FRAMEWORK_CODE_EXTENSIONS },
    // 境界の規則と自作 ESLint 規則(層の綴りの唯一の正)。ここも仕組み側のコードである。
    { dir: FRAMEWORK_LINT_CONFIG_DIR, extensions: FRAMEWORK_CODE_EXTENSIONS },
  ];
  const appDirs: readonly ScanRoot[] =
    app === null
      ? []
      : [
          ...vocabularyScanLayers(layout, app).map(({ dir, extensions }) => ({ dir, extensions })),
          ...declared
            .filter((entry) => entry.root === 'product')
            .map((entry) => ({ dir: `${app}/${entry.path}`, extensions: ['.ts'] })),
        ];
  return [
    { dir: FRAMEWORK_LIB_DIR, extensions: ['.ts'] },
    ...frameworkPackages,
    ...appDirs,
    // 約束事のモデル(C24)。**仕組み側の形を写したもの**であり、アプリの語を 1 つも持たない
    // ことがこのモデルの前提である(持つと、アプリの仕様が変わるたびにモデルを直すことになり、
    // 「仕組み側を 1 回検証する」が壊れる)。写し元を名指す `\* SOURCE:` 行と日本語の意図は
    // `\*` コメントなので走査の対象外になる —— パスや関数名に業務の語が出るのはそこだけである。
    // `formal/expectations.json` は**実装を名指すための台帳**(どのファイルの何行目を直すか)
    // なので、語が出るのがその役目であり走査しない。**モデルの置き場は仕組みのもの**であり、
    // 製品は 1 行も書かないので宣言からは来ない。
    { dir: FORMAL_DIR, extensions: ['.tla', '.cfg'], syntax: 'tla' as const },
  ];
}

/** 約束事のモデルの置き場(仕組み自身の住所。製品は 1 行も書かない)。 */
export const FORMAL_DIR = FRAMEWORK_FORMAL_DIR;

/**
 * 仕組みの TypeScript のソースの置き場(W3 の走査範囲)。
 *
 * **W1 の走査範囲ではない**(CLI は仕様の語を扱わない配線であり、W1 の母集合は従来どおり
 * 検証器・生成器の置き場である)。**W3 は CLI も見る** —— CLI は宣言を読む入口そのものなので、
 * 根の綴りが 1 本残ると「宣言を読んでいるのに 1 か所だけ綴りで実ファイルを読む」形になる
 * (実測: `check-formal.ts` が `supabase/migrations` を持っていた)。
 *
 * どちらも**製品の根ではなく仕組み自身の住所**であり、正は `lib/io/paths.ts` が持つ。
 */
export const FRAMEWORK_SOURCE_DIRS: readonly string[] = [FRAMEWORK_LIB_DIR, FRAMEWORK_CLI_DIR];

export { FRAMEWORK_CLI_DIR, FRAMEWORK_LIB_DIR } from '../io/paths.js';

/**
 * E2E の置き場(配置の役割 `e2e-root`)直下のうち `walker` で始まるファイルだけを対象にする(ディレクトリ全体ではない)。
 *
 * E2E の置き場には仕様駆動のスモークテスト(`*.spec.ts` 等)やシード投入スクリプトも同居しており、
 * それらはテスト・フィクスチャの性質が強い。ウォーカーのオラクル(`walker*.mts`)だけが
 * 「仕様=生成物を正として実測を検査する」仕組み側のコードなので、そこだけを走査対象にする。
 */
export function walkerDir(roots: ProductRoots, layout: ProductLayout): string | null {
  return e2eRootPath(layout, roots);
}
export const WALKER_FILE = /^walker.*\.mts$/;

export { isScannedFile, isExcludedPath, stripComments, collectTypeAliasLiterals, extractLiterals } from './literals.js';
export type { VocabularyScanHit } from './literals.js';

/**
 * 生成物の目印(先頭の AUTO-GENERATED ヘッダ)。
 *
 * 生成物は**仕組みが仕様の語を書き写した結果**であり、人が仕組み側コードにアプリの語を
 * 書いた漏れではない(「軸は仕組み・語はアプリ」の、まさに意図した向き)。書き写した語の正は
 * 仕様であり、鮮度は `generate:check` が見る。したがって走査の対象外にする
 * —— 生成器そのもの(`legacy/spec-tools/lib/generate/**`)は今までどおり対象である。
 *
 * 2 つに割って持つのは、このファイル自身が「生成物の目印を含むファイル」に化けて
 * 自分を走査対象から外してしまわないようにするためである。
 */
export const GENERATED_MARKER = ['AUTO-GENERATED by', '`npm run generate`'].join(' ');

/**
 * ブックの生成物(`docs/book/` の全ページ)の先頭に置く、全体が生成物であることの宣言。
 *
 * ブックの文言の正は仕様と生成器のコードで、どちらも別の検査が見ている。ブックの生成物を読むと、
 * 仕様の違反が生成物の側で 2 件目になり、その警告が手引きに載って生成物が変わる(生成が 1 回で落ち着かない)。
 * 用語の走査(M8 / M9)は、この宣言を先頭に持つ文書を読まない。章の生成器もこの 1 文を使う
 * (宣言の綴りを 2 か所に持たない)。
 */
export const WHOLE_FILE_GENERATED_NOTICE =
  '<!-- このファイルは全体が生成物である(npm run generate が全置換する)。手で編集しない。 -->';

/** 1 ファイルを走査してヒットを集める(共有の下請け)。 */
function scanFile(
  repoRoot: string,
  absolute: string,
  hits: VocabularyScanHit[],
  syntax: 'ts' | 'tla' = 'ts',
): void {
  const relativePath = toRelative(repoRoot, absolute);
  if (isExcludedPath(relativePath)) return;
  const source = readText(absolute);
  if (source.includes(GENERATED_MARKER)) return;
  for (const { literal, line } of extractLiterals(source, syntax)) {
    hits.push({ file: relativePath, line, literal });
  }
}

/**
 * 指定ディレクトリ配下のソースを走査し、文字列リテラルの中身を集める。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param roots 製品が宣言した根(app 側の走査範囲の位置)
 * @param layout 置き場の配置(層と土台の表の宣言元)
 * @returns ファイルごとの文字列リテラル一覧(対象ディレクトリが無ければ空)
 */
export function scanVocabularyLiterals(
  repoRoot: string,
  roots: ProductRoots,
  layout: ProductLayout,
): readonly VocabularyScanHit[] {
  const hits: VocabularyScanHit[] = [];
  for (const { dir, extensions, syntax } of vocabularyScanRoots(roots, layout)) {
    const absoluteRoot = join(repoRoot, dir);
    if (!isDirectory(absoluteRoot)) continue;
    for (const absolute of walkRepoFiles(repoRoot, dir, (name) => isScannedFile(name, extensions))) {
      scanFile(repoRoot, absolute, hits, syntax ?? 'ts');
    }
  }
  const walker = walkerDir(roots, layout);
  if (walker !== null) {
    const walkerRoot = join(repoRoot, walker);
    for (const entry of listEntries(walkerRoot)) {
      if (!WALKER_FILE.test(entry) || entry.endsWith('.test.mts')) continue;
      scanFile(repoRoot, join(walkerRoot, entry), hits);
    }
  }
  return hits;
}
