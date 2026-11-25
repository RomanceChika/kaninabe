/**
 * トークン仕様と実装側 CSS の読み込み。
 *
 * ファイル I/O を行うのはこのモジュールだけであり、検証器・生成器は構築済みのモデルを
 * 引数で受け取る(規約: scripts-code-quality.md「I/O と純粋ロジックの分離」)。
 *
 * 仕様が無い環境(`specs/frontend/design` ごと無い)でも壊れない。その場合
 * `available: false` を返し、G 群は 1 つも実行されない。
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SpecReporter } from '../parse-common.js';
import { parseSafeFrontmatter } from '../safe-frontmatter.js';
import type { Finding } from '../../kernel/finding.js';
import {
  appGrounded,
  detectRepoRoot,
  FRAMEWORK_BOOK_FACE_DIR,
  isDirectory,
  isFile,
  toRelative,
  walkFiles,
} from '../../io/paths.js';
import { parseDesignTokens } from './parse-tokens.js';
import type {
  BrandFileCheck,
  BrandFileStatus,
  CssScanResult,
  DesignBrand,
  DesignTokenModel,
  ScannedCssFile,
} from './types.js';
import { bookPath } from '../product/paths.js';
import { appIconPath, sourceRootPath } from '../product/layout.js';
import type { ProductLayout } from '../product/layout.js';
import type { ProductRoots } from '../product/types.js';

/** ローダーが積む Finding の検証器 ID(スキーマ適合 = G0)。 */
export const G0_VERIFIER_ID = 'G0';

/** トークン仕様のファイル名(1 プロジェクト 1 ファイル)。 */
const TOKENS_FILE = 'tokens.md';

/**
 * アプリの枠が既定で置くアイコンの置き場(リポジトリルート相対)。
 * 独自のアイコンを宣言すればアプリの枠は既定のアイコンを要らないので、残っていれば既定の残骸(G8(d))。
 *
 * **置き場は置き場の配置の役割 `app-icon`(アプリの枠の後段が与える)が決める**。実装の木を持たない製品では「残骸」もありえないので null。
 *
 * @param roots 製品が宣言した根(実装の木の位置)
 * @param layout 置き場の配置
 * @returns 置き場。実装の木が無い・配置に無いときは null
 */
export function defaultIconPath(roots: ProductRoots, layout: ProductLayout): string | null {
  return appIconPath(layout, roots);
}

/** ローダーの任意設定。 */
export interface LoadDesignOptions {
  /** Finding の location.file をこのディレクトリからの相対にする。省略時は製品の根の宣言(product.md)を上に探す。 */
  readonly repoRoot?: string;
}

/** loadDesignTokens の結果。 */
export interface LoadDesignResult {
  /** 構築できたモデル。 */
  readonly model: DesignTokenModel;
  /** 構築中に検出した G0 違反。 */
  readonly findings: readonly Finding[];
  /**
   * 読めずにモデルへ入れなかった行(palette の名前・リストの要素・必須のリスト・読めなかった brand の宣言)の数。0 なら、`findings` に error が
   * 残っていてもモデルは欠けていない。ファイルを読めない・壊れているときは 0(モデル自体が無いので別の理由で阻害になる)。
   */
  readonly dropped: number;
}

/**
 * トークン仕様を読む。
 *
 * @param designRoot `docs/specs/frontend/design` の絶対パス
 * @param options 相対パス基準などの任意設定
 * @returns モデルと G0 違反
 */
export function loadDesignTokens(designRoot: string, options: LoadDesignOptions = {}): LoadDesignResult {
  const absolute = join(designRoot, TOKENS_FILE);
  if (!isFile(absolute)) return missingDesignTokens();

  const repoRoot = options.repoRoot ?? detectRepoRoot(designRoot);
  const file = toRelative(repoRoot, absolute);
  const reporter = new SpecReporter(file);
  const source = readText(absolute, reporter);
  const data = source === null ? null : parseSafeFrontmatter(source, reporter);
  const findings: Finding[] = reporter.findings().map(rebrand);
  if (data === null) return { model: { available: true, spec: null }, findings, dropped: 0 };

  const parsed = parseDesignTokens(data, file);
  findings.push(...parsed.findings.map(rebrand));
  return { model: { available: true, spec: parsed.value }, findings, dropped: parsed.dropped };
}

/**
 * 実装側の CSS を読む。
 *
 * 走査するのは実装のソースの根(置き場の配置の役割 `source-root`)配下の `.css` すべてである。「CSS Modules だけ」に絞らないのは、
 * グローバル CSS に生値を逃がす経路を空けないため。生成物の CSS(G1 の対象外)は製品の宣言した生成物の総置き場(`roots.generated`)の下。
 *
 * @param appRoot 実装の木の絶対パス
 * @param roots 製品が宣言した根(生成物の総置き場)
 * @param layout 置き場の配置(実装のソースの根)
 * @param options 相対パス基準などの任意設定
 * @returns 走査結果。ソースの根が無ければ `available: false`
 */
export function loadAppCss(appRoot: string, roots: ProductRoots, layout: ProductLayout, options: LoadDesignOptions = {}): CssScanResult {
  const sourceRel = sourceRootPath(layout, { app: '' });
  const cssRoot = sourceRel === null ? null : join(appRoot, sourceRel);
  if (cssRoot === null || !isDirectory(cssRoot)) return { available: false, files: [] };
  // 生成物の総置き場を実装の木からの相対にする(実装の木の外なら、生成物の CSS は実装の木の走査に現れない)。
  const generatedPrefix = roots.app !== null && roots.generated.startsWith(`${roots.app}/`) ? `${roots.generated.slice(roots.app.length + 1)}/` : null;

  const repoRoot = options.repoRoot ?? detectRepoRoot(appRoot);
  const files: ScannedCssFile[] = [];
  for (const absolute of walkFiles(cssRoot, (name) => name.endsWith('.css'))) {
    const relToApp = toRelative(appRoot, absolute);
    files.push({
      file: toRelative(repoRoot, absolute),
      source: readFileSync(absolute, 'utf8'),
      generated: generatedPrefix !== null && relToApp.startsWith(generatedPrefix),
    });
  }
  return { available: true, files };
}

/**
 * ハンドブックの人向けの表示の CSS(`book-face/`)を読む。
 *
 * 実装の CSS と**同じ規約**で見るため、`loadAppCss` の結果に足して G1・G2・G7 に渡す
 * (ここの CSS も生値を書かず、宣言したトークンだけを引き、足したトークンを使う)。
 * 置き場が無い環境では空を返す(仕組みだけのリポジトリでも壊れない)。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @returns 走査したファイル(生成物ではない)
 */
export function loadBookFaceCss(repoRoot: string): readonly ScannedCssFile[] {
  const root = join(repoRoot, FRAMEWORK_BOOK_FACE_DIR);
  return walkFiles(root, (name) => name.endsWith('.css')).map((absolute) => ({
    file: toRelative(repoRoot, absolute),
    source: readFileSync(absolute, 'utf8'),
    generated: false,
  }));
}

/**
 * `brand` が指す各ファイルの実在・ハッシュを確かめる(G8 の材料)。
 *
 * ここだけがファイル I/O(実在確認・SHA-256 計算)を行い、検証器(g8-brand.ts)は
 * 結果の真偽値・文字列を比べるだけの純粋関数にする(規約: scripts-code-quality.md)。
 *
 * app/ の木が無いリポジトリ(仕様だけのサンプル・実装をまだ書いていない新規プロジェクト)では
 * ロゴの実ファイルが存在しえないので、`appGrounded: false` を持ち帰って検証器が実在の項を
 * 飛ばせるようにする(X1・J2・S7 と同じ扱い。束 ⑲-1)。
 *
 * @param repoRoot リポジトリルートの絶対パス(`brand` のパスはここからの相対)
 * @param roots 製品が宣言した根(実装の木と読み物の位置)
 * @param layout 置き場の配置(既定のアイコンの残骸の位置)
 * @param brand 読み込み済みの brand 宣言(無ければ null)
 * @returns 各ファイルの実在チェック結果
 */
export function loadBrandFiles(
  repoRoot: string,
  roots: ProductRoots,
  layout: ProductLayout,
  brand: DesignBrand | null,
): BrandFileStatus {
  const favicon = defaultIconPath(roots, layout);
  const faviconIcoExists = favicon !== null && isFile(join(repoRoot, favicon));
  const grounded = appGrounded(repoRoot, roots.app);
  if (brand === null) {
    return {
      icon: null,
      appleIcon: null,
      ogImage: null,
      bookCopy: null,
      faviconIcoExists,
      faviconIcoPath: favicon,
      appGrounded: grounded,
    };
  }
  return {
    appGrounded: grounded,
    icon: checkBrandFile(repoRoot, brand.icon),
    appleIcon: checkBrandFile(repoRoot, brand.appleIcon),
    ogImage: checkBrandFile(repoRoot, brand.ogImage),
    bookCopy: checkBrandFile(repoRoot, bookCopyPathOf(roots, brand.icon)),
    faviconIcoExists,
    faviconIcoPath: favicon,
  };
}

/**
 * ハンドブック側の写しのパス。SVG は生成物(book-assets.ts)が写すので対象外(null)。
 *
 * @param roots 製品が宣言した根(読み物の位置)
 * @param iconPath `brand.icon` のパス
 * @returns 写しのパス(読み物の `assets/brand-icon.<拡張子>`)。SVG か宣言なしなら null
 */
export function bookCopyPathOf(roots: ProductRoots, iconPath: string | null): string | null {
  if (iconPath === null || iconPath.endsWith('.svg')) return null;
  const ext = iconPath.slice(iconPath.lastIndexOf('.'));
  return bookPath(roots, `assets/brand-icon${ext}`);
}

/** 宣言 1 件(パス)の実在・ハッシュを確かめる。宣言が無ければ null。 */

function checkBrandFile(repoRoot: string, declaredPath: string | null): BrandFileCheck | null {
  if (declaredPath === null) return null;
  const absolute = join(repoRoot, declaredPath);
  const exists = isFile(absolute);
  return { declaredPath, exists, sha256: exists ? sha256Of(absolute) : null };
}

/** ファイルの中身の SHA-256(16 進)。 */
function sha256Of(absolute: string): string {
  return createHash('sha256').update(readFileSync(absolute)).digest('hex');
}

/** ファイルを読む。読めない場合は Finding を積んで null。 */
function readText(absolute: string, reporter: SpecReporter): string | null {
  try {
    return readFileSync(absolute, 'utf8');
  } catch (cause) {
    reporter.error(
      undefined,
      `ファイルを読み込めません: ${cause instanceof Error ? cause.message : String(cause)}`,
      'ファイルの権限とパスを確認する',
    );
    return null;
  }
}

/** SpecReporter は V1 として報告するので、G 群の ID に付け替える。 */
function rebrand(finding: Finding): Finding {
  return { ...finding, verifier: G0_VERIFIER_ID };
}

/**
 * デザイントークンの置き場が無いときの読み込みの結果(`available: false` の空モデル)。
 *
 * **ファイルを読まない純粋な値**である。ローダー自身の「置き場が無い」の分岐と、製品が採っていない種類の入力(読まない)が
 * 同じ値を作るための 1 本(予約の名前の置き場を読みに行かせる形は、その名前に有効な仕様が置かれると前提が崩れる)。
 */
export function missingDesignTokens(): LoadDesignResult {
  return { model: { available: false, spec: null }, findings: [], dropped: 0 };
}
