/**
 * ハンドブックが写す「実装の実物」を読む I/O 境界。
 *
 * 生成器は I/O をしない規約(scripts-code-quality.md)なので、実装の CSS・状態バッジ・
 * SSR プレビューの断片を読むのは CLI 側の仕事である。**読む位置はすべて製品が宣言した根から
 * 組み立てる**(W3)—— この層がパスの綴りを持つと、2 つ目の製品でハンドブックが空になる。
 *
 * CLI(`cli/generate-docs.ts`)が呼ぶ口で、責務は「読む位置の解決と、読めなかったものを
 * undefined に倒すこと」だけである。
 */

import fs from 'node:fs';
import path from 'node:path';
import { GLOBALS_CSS_SOURCE, STATE_BADGE_SOURCE, UI_CSS_SOURCE } from './book-input-sources.js';
import type { BookInputs, StateGap } from '../gen-kit/book-inputs-types.js';
import {
  parsePreviewFile,
  previewScreenOf,
  previewStateOf,
  stateKeyOf,
} from '../gen-kit/book-inputs.js';
import { appResourcePath } from '../model/product/layout.js';
import type { ProductLayout } from '../model/product/layout.js';
import { previewsPath } from '../model/product/paths.js';
import { FRAMEWORK_BOOK_FACE_DIR } from '../io/paths.js';
import type { ProductRoots } from '../model/product/types.js';

/**
 * ハンドブックが写す「実装の実物」を読む(無いものは undefined のまま = 生成側が
 * プレースホルダを出す)。生成器は I/O をしない規約のため、読むのはここ(CLI)の仕事。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param roots 製品が宣言した根(読む位置はすべてここから組み立てる)
 * @param layout 置き場の配置(写し元の資材の置き場 = 役割 `app-resource`)
 * @param brandIconPath `brand.icon` が指すパス(リポジトリルート相対)。宣言が無ければ null
 */
export function readBookInputs(
  repoRoot: string,
  roots: ProductRoots,
  layout: ProductLayout,
  brandIconPath: string | null,
): BookInputs {
  const readIf = (relative: string | null): string | undefined => {
    if (relative === null) return undefined;
    const absolute = path.join(repoRoot, relative);
    return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf-8') : undefined;
  };
  const previewsRoot = previewsPath(roots);
  const absolutePreviewsDir = previewsRoot === null ? null : path.join(repoRoot, previewsRoot);
  const previews = readPreviews(absolutePreviewsDir);
  const statePreviews = readStatePreviews(absolutePreviewsDir);
  const stateGaps = readStateGaps(absolutePreviewsDir);
  // ロゴは SVG(テキスト)のときだけ埋め込める。この読み込みパイプラインは文字列前提
  // (apply-sections が utf-8 の文字列として書き込む)なので、PNG 等のバイナリを渡すと
  // 中身が壊れる ―― 埋め込まないほうが「壊れた画像」より安全(既知の穴。report に明記)。
  const brandIconSvg = brandIconPath?.endsWith('.svg') === true ? readIf(brandIconPath) : undefined;
  const faceDir = path.join(repoRoot, FRAMEWORK_BOOK_FACE_DIR);
  const faceCss = fs.existsSync(faceDir)
    ? fs
        .readdirSync(faceDir)
        .filter((name) => name.endsWith('.css'))
        .sort()
        .map((name) => fs.readFileSync(path.join(faceDir, name), 'utf-8'))
        .join('\n')
    : undefined;
  return {
    ...pick('faceCss', faceCss),
    ...pick('uiCss', readIf(appResourcePath(layout, roots, UI_CSS_SOURCE))),
    ...pick('globalsCss', readIf(appResourcePath(layout, roots, GLOBALS_CSS_SOURCE))),
    ...pick('stateBadgeSource', readIf(appResourcePath(layout, roots, STATE_BADGE_SOURCE))),
    ...pick('brandIconSvg', brandIconSvg),
    ...(previews === undefined ? {} : { previews }),
    ...(statePreviews === undefined ? {} : { statePreviews }),
    ...(stateGaps === undefined ? {} : { stateGaps }),
  };
}

/**
 * 製品が置いたプレビューの断片の全部(画面と状態の両方。検査の S22 が読む)。
 *
 * @param repoRoot リポジトリルート
 * @param roots 製品の根
 * @returns 名前 → 断片。置き場が無ければ undefined
 */
export function readPreviewFragments(repoRoot: string, roots: ProductRoots): ReadonlyMap<string, string> | undefined {
  const previewsRoot = previewsPath(roots);
  const dir = previewsRoot === null ? null : path.join(repoRoot, previewsRoot);
  const screens = readPreviews(dir);
  if (screens === undefined) return undefined;
  return new Map([...screens, ...(readStatePreviews(dir) ?? [])]);
}

/** 出せない(画面, 状態)の一覧の置き場(同じく app 側の `npm run book:previews` が書く)。 */
const STATE_GAPS_FILE = '_state-gaps.json';

/**
 * SSR プレビューの断片を読む(画面名 → マークアップ)。
 *
 * @param dir 断片の置き場(絶対パス)。宣言が無ければ null
 * @returns 読めた断片。置き場が無ければ undefined(章はプレースホルダを出す)
 */
function readPreviews(dir: string | null): ReadonlyMap<string, string> | undefined {
  if (dir === null || !fs.existsSync(dir)) return undefined;
  const previews = new Map<string, string>();
  for (const file of fs.readdirSync(dir).sort()) {
    const screen = previewScreenOf(file);
    if (screen === null) continue;
    previews.set(screen, parsePreviewFile(fs.readFileSync(path.join(dir, file), 'utf-8')));
  }
  return previews;
}

/**
 * 状態別 SSR プレビューの断片を読む(`{画面名}.{状態}` → マークアップ)。
 *
 * @param dir 断片の置き場(絶対パス)。宣言が無ければ null
 * @returns 読めた断片。置き場が無ければ undefined
 */
function readStatePreviews(dir: string | null): ReadonlyMap<string, string> | undefined {
  if (dir === null || !fs.existsSync(dir)) return undefined;
  const previews = new Map<string, string>();
  for (const file of fs.readdirSync(dir).sort()) {
    const key = previewStateOf(file);
    if (key === null) continue;
    previews.set(
      stateKeyOf(key.screen, key.state),
      parsePreviewFile(fs.readFileSync(path.join(dir, file), 'utf-8')),
    );
  }
  return previews;
}

/**
 * 出せない(画面, 状態)の一覧を読む(`_state-gaps.json`)。
 *
 * @param dir 断片の置き場(絶対パス。同じディレクトリに置く)。宣言が無ければ null
 * @returns 読めた一覧。ファイルが無ければ undefined
 */
function readStateGaps(dir: string | null): readonly StateGap[] | undefined {
  if (dir === null) return undefined;
  const file = path.join(dir, STATE_GAPS_FILE);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as readonly StateGap[];
}

/** 値があるときだけキーを持つオブジェクト断片(exactOptionalPropertyTypes 対応)。 */
function pick<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
