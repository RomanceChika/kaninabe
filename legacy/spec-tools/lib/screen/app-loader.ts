/**
 * 実装(app/)側からルートの事実を読み取るローダー。S7 の入力を作る。
 *
 * **仕様側の器が実装のファイルシステムを読む唯一の場所**である。走査の起点は引数で受け取り、
 * このモジュールがパスを決め打ちしない(CLI が本物の app/ を、テストが fixture を渡す)。**画面の器・リクエスト前段の置き場と、
 * ファイル配置 → ルートの逆引きは、置き場の配置(`ProductLayout`。アプリの枠の後段が与える)から引く**。matcher の解釈は純粋モジュール
 * lib/screen/route-match.ts に置いてあり、ここは I/O と組み立てだけを行う(規約: scripts-code-quality.md)。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isDirectory, isFile, toRelative } from '../io/paths.js';
import { walkTree } from '../io/walk-tree.js';
import type { AppRoute, AppRoutesModel, PageMetadataForm } from '../model/screen/app-types.js';
import { layoutPath, layoutScan } from '../model/product/layout.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import { pageRender, shellAwaitsGates } from './page-gate-order.js';
import { pageMetadataForm } from './page-metadata.js';

/** `matcher: [...]` の配列部分。オブジェクト形式・変数参照は捕まえない(= 解釈できない扱い)。 */
const MATCHER_ARRAY = /matcher\s*:\s*\[([\s\S]*?)\]/;

/** 配列の中の文字列リテラル。 */
const STRING_LITERAL = /'([^']*)'|"([^"]*)"/g;

/** loadAppRoutes の任意設定。 */
export interface LoadAppRoutesOptions {
  /** Finding の location.file をこのディレクトリからの相対パスにする。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(リクエスト前段の置き場を示すのに使う)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(画面の器の走査の根・逆引き・リクエスト前段の置き場。アプリの枠の後段が与える)。 */
  readonly layout: ProductLayout;
}

/**
 * 「実装の木を読めなかった」を表す空のモデル。
 *
 * **実装の木を宣言していない製品と、宣言したがまだ無い製品の答えを 1 つにする**ための口である。
 * 前者は走査そのものを行わないので(配線層が先に判る)、同じ形をここから作れるようにしてある。
 *
 * @param roots 製品が宣言した根(リクエスト前段の置き場を示すのに使う)
 * @param layout 置き場の配置
 * @returns `available: false` のモデル(S7 は何も見ない)
 */
export function unavailableAppRoutes(roots: ProductRoots, layout: ProductLayout): AppRoutesModel {
  return {
    available: false,
    routes: [],
    proxy: {
      available: false,
      file: layoutPath(layout, roots.app, 'request-gate') ?? '',
      patterns: [],
    },
  };
}

/** 実装の木があるのに、画面の器の走査の根を配置から決められない(配置の欠落)。S7 が前提の失敗として指す。 */
function misplacedAppRoutes(roots: ProductRoots, layout: ProductLayout): AppRoutesModel {
  return {
    ...unavailableAppRoutes(roots, layout),
    placementProblem:
      '置き場の配置から画面の器(screen-shell)の走査の根を決められません(配置が screen-shell を宣言していない・逆引き(classify)が無い・基準の役割が辿れない)',
  };
}

/**
 * 実装の木を走査して実ルートとリクエスト前段の matcher を読み取る。
 *
 * 実装の木(ディレクトリ)がまだ無い環境(仕様だけのリポジトリ)では `available: false` を返し、
 * S7 は何も検査しない。これは「実装がまだ無い」を意味し、「実装にルートが 0 本」とは区別する。
 * **実装の木を宣言していてディレクトリもあるのに、置き場の配置が画面の器の走査を決められない**(`screen-shell` が無い・逆引きが無い)ときは、
 * スキップではなく**前提の失敗**(`placementProblem`)で、実装が無いことと読ませない。
 *
 * @param appRoot 実装の木の絶対パス
 * @param options リポジトリルート(相対パスの基準)・製品の根・置き場の配置
 * @returns 実ルートと matcher のモデル
 */
export function loadAppRoutes(appRoot: string, options: LoadAppRoutesOptions): AppRoutesModel {
  const scan = layoutScan(options.layout, '', 'screen-shell');
  if (scan === null) return isDirectory(appRoot) ? misplacedAppRoutes(options.roots, options.layout) : unavailableAppRoutes(options.roots, options.layout);
  if (!isDirectory(join(appRoot, scan.dir))) return unavailableAppRoutes(options.roots, options.layout);
  const shellDir = join(appRoot, scan.dir);
  const gate = layoutPath(options.layout, '', 'request-gate');

  const routes: AppRoute[] = [];
  // 名前で 1 つも飛ばさない走査(点検 14 回目 C14-1)。`build` / `dist` / `coverage` / ドット始まりも Next.js にはただの URL のセグメントである。
  const walked = walkTree(shellDir);
  for (const absolute of walked.files) {
    const route = scan.keyOf(toRelative(shellDir, absolute));
    if (route === null) continue;
    routes.push({ route, file: toRelative(options.repoRoot, absolute), metadata: readMetadataForm(absolute) });
  }
  routes.sort((a, b) => a.route.localeCompare(b.route));

  const unreadable = walked.unreadable.map((absolute) => toRelative(options.repoRoot, absolute));
  const unread = unreadable.length === 0 ? {} : { unreadable };
  if (gate === null) return { available: true, routes, proxy: { available: false, file: '', patterns: [] }, requestGateMissing: true, ...unread };
  const gatePath = join(appRoot, gate);
  return { available: true, routes, proxy: readProxyMatcher(gatePath, toRelative(options.repoRoot, gatePath)), ...unread };
}

/**
 * 関門のある画面の描画の順を読む(page の最初の値の `await` が器の描画で、器の最初の `await` が関門)。ビルドの入口の関所だけが呼ぶ。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param pageFile `page.tsx`(リポジトリルート相対)
 * @param sourceRoot 実装のソースの根(リポジトリルート相対。別名の解決先)
 * @param sourceModule 実装のソースの根の別名
 * @param symbols 関門の実装の名前(順に)
 * @returns 破れの理由(守られていれば null)
 */
export function gateOrderProblem(repoRoot: string, pageFile: string, sourceRoot: string, sourceModule: string, symbols: readonly string[]): string | null {
  const absolute = join(repoRoot, pageFile);
  const render = pageRender(readTextOrEmpty(absolute));
  if (render === null) return `${pageFile} の最初の値の await が器の描画(render…Screen)ではありません`;
  const base = render.specifier.startsWith(`${sourceModule}/`) ? join(repoRoot, sourceRoot, render.specifier.slice(sourceModule.length + 1)) : resolve(dirname(absolute), render.specifier);
  const shell = [`${base}.tsx`, `${base}.ts`].find((candidate) => isFile(candidate));
  if (shell === undefined) return `${pageFile} の器(${render.specifier})を読めません`;
  return shellAwaitsGates(readTextOrEmpty(shell), render.render, symbols) ? null : `${toRelative(repoRoot, shell)} の最初の await が関門ではありません(${symbols.join(' → ')} が先頭に要ります)`;
}

/** ファイルを読む(読めなければ空 = 形が読めず赤になる)。 */
function readTextOrEmpty(absolute: string): string {
  try {
    return readFileSync(absolute, 'utf8');
  } catch {
    return '';
  }
}

/** ファイルの `generateMetadata` の形を読む(読めないファイルは許可の形の外)。 */
function readMetadataForm(absolute: string): PageMetadataForm {
  try {
    return pageMetadataForm(readFileSync(absolute, 'utf8'));
  } catch {
    return { kind: 'unreadable' };
  }
}

/**
 * リクエスト前段の `matcher` を静的に読む。
 *
 * 実行して確かめるのではなく**書かれた文字列を読む**だけなので、動的に組み立てた matcher は
 * 読めない。読めなかったことは `available: false` として持ち帰り、S7 が「検査していない」と
 * 言えるようにする(読めない = 覆っている、にはしない)。
 */
function readProxyMatcher(
  absolute: string,
  file: string,
): AppRoutesModel['proxy'] {
  if (!isFile(absolute)) return { available: false, file, patterns: [] };
  let source: string;
  try {
    source = readFileSync(absolute, 'utf8');
  } catch {
    return { available: false, file, patterns: [] };
  }
  const body = MATCHER_ARRAY.exec(source)?.[1];
  if (body === undefined) return { available: false, file, patterns: [] };

  const patterns: string[] = [];
  for (const match of body.matchAll(STRING_LITERAL)) {
    // 字面のエスケープ(`'favicon\\.ico$'` の `\\`)を外して、実行時の文字列にする(6 回目 B6-3)。
    patterns.push((match[1] ?? match[2] ?? '').replace(/\\(.)/g, '$1'));
  }
  return { available: true, file, patterns };
}
