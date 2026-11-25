/**
 * 実装(app/src)を走査して「export された関数・定数の名前」と「**呼び出し口がある名前**」を
 * 集める I/O 境界。
 *
 * V10 が突き合わせる相手はソースコードそのものである(K1 の `env-scan.ts` と同じ発想 —
 * `enforced_by`(`kind: application`)の `ref` は「制約を隔離した純粋関数名」または
 * 「zod スキーマ名」という**識別子**であり、ファイルパスを持たない。したがって
 * 「実在するか」は名前空間全体(app/src 配下の export 名の集合)に対する所属判定になる。
 * 検証器はファイル I/O をしないため、走査はここで済ませて純粋なデータにして渡す
 * (規約: scripts-code-quality.md)。
 *
 * 拾うのは `export function {name}` / `export async function {name}` / `export const {name}`
 * の 3 形だけである(純粋関数もアロー関数の定数も zod スキーマもこの形で宣言される規約
 * のため — server-actions.md / conventions)。テストファイル(`.test.ts(x)`)と生成物
 * (`**\/generated/**`)は対象に含めない —— `ref` が指すのは**手で書いた実体**であり、
 * テストのローカル関数や生成された写しを実在の根拠にすると、生成物を消しても
 * 参照が生き残ってしまう。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDirectory, toRelative, walkFiles } from '../io/paths.js';
import { sourceRootPath } from '../model/product/layout.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';

/**
 * 走査する実装ツリー(リポジトリルート相対)。実装の木の位置は製品の宣言から、その中のソースの根は置き場の配置(役割 `source-root`)から来る。
 */
export function applicationRefScanRoot(roots: ProductRoots, layout: ProductLayout): string | null {
  return sourceRootPath(layout, roots);
}

/** 走査対象の拡張子。 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/** `export function` / `export async function` / `export const` の宣言名を拾う。 */
const EXPORT_PATTERNS = [
  /export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
  /export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
];

/** 実装側の走査結果。 */
export interface ApplicationRefScanResult {
  /** 実装の木を走査できたか。false なら V10 のこの下位検査は何も見ない。 */
  readonly available: boolean;
  /** 見つかった export 名の集合(ファイル名は持たない — ref は識別子だけを指すため)。 */
  readonly exportedNames: ReadonlySet<string>;
  /**
   * **自分の宣言以外の場所に現れた名前**の集合(= 呼び出し口がある名前)。
   *
   * 「export されている」だけでは執行点の実在を意味しない —— 呼ぶ側が消えても、純関数と
   * その単体テストは残るからである(束 ⑰-3 で操作の実装が生成物になったとき、2 つの
   * 不変条件がこの形で黙って無効になった)。コメントと文字列リテラルは落として数えるので、
   * doc コメントの中で名前を挙げているだけでは呼び出し口として数えない。
   */
  readonly referencedNames: ReadonlySet<string>;
}

/**
 * 実装ツリーから export された関数・定数の名前を集める。
 *
 * app/ が無い構成(仕様だけを持つリポジトリ)では `available: false` を返し、
 * 呼び出し側がこの下位検査のスキップを判断する(K1 / H2 と同じ扱い)。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param roots 製品が宣言した根(実装の木の位置)
 * @param layout 置き場の配置(実装のソースの根)
 * @returns export 名の集合
 */
export function scanApplicationRefs(repoRoot: string, roots: ProductRoots, layout: ProductLayout): ApplicationRefScanResult {
  const relative = applicationRefScanRoot(roots, layout);
  if (relative === null) {
    return { available: false, exportedNames: new Set(), referencedNames: new Set() };
  }
  const root = join(repoRoot, relative);
  if (!isDirectory(root)) {
    return { available: false, exportedNames: new Set(), referencedNames: new Set() };
  }

  const names = new Set<string>();
  const referenced = new Set<string>();
  for (const absolute of walkFiles(root, isSourceFile)) {
    if (isExcluded(toRelative(repoRoot, absolute))) continue;
    const source = readText(absolute);
    for (const name of extractExportedNames(source)) names.add(name);
    for (const name of extractReferencedNames(source)) referenced.add(name);
  }
  return { available: true, exportedNames: names, referencedNames: referenced };
}

/** 行コメント・ブロックコメント・文字列リテラルを空白に潰す(名前の「言及」を数えないため)。 */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ')
    .replace(/'(?:\\.|[^'\\\n])*'/g, ' ')
    .replace(/"(?:\\.|[^"\\\n])*"/g, ' ');
}

/** 宣言の頭(`export function foo` / `export const foo`)そのものを落とす。 */
const DECLARATION_HEADS = [
  /export\s+(?:async\s+)?function\s+[A-Za-z_$][A-Za-z0-9_$]*/g,
  /export\s+const\s+[A-Za-z_$][A-Za-z0-9_$]*/g,
];

/**
 * ソース 1 本から「自分の宣言以外の場所に現れた識別子」を抜き出す。
 *
 * import 文に現れるだけでも数える(取り込んで使わない形はそれ自体が別の問題であり、
 * ここは「誰からも触れられていない」という最も危険な形だけを見る下限の検査である)。
 *
 * @param source ファイルの内容
 * @returns 出現した識別子(重複なし)
 */
export function extractReferencedNames(source: string): readonly string[] {
  let code = stripNonCode(source);
  for (const pattern of DECLARATION_HEADS) code = code.replace(pattern, ' ');
  return [...new Set(code.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [])];
}

/**
 * ソース 1 本から export 名を抜き出す(重複は 1 つにまとめる)。
 *
 * @param source ファイルの内容
 * @returns 出現順の export 名
 */
export function extractExportedNames(source: string): readonly string[] {
  const names: string[] = [];
  for (const pattern of EXPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (name === undefined || names.includes(name)) continue;
      names.push(name);
    }
  }
  return names;
}

/** 走査対象のソースファイルか(型定義・テストは対象外)。 */
function isSourceFile(name: string): boolean {
  if (name.endsWith('.d.ts') || name.endsWith('.test.ts') || name.endsWith('.test.tsx')) return false;
  return SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/** テスト補助(`__tests__`)と生成物(`generated`)を除外する。 */
function isExcluded(relativePath: string): boolean {
  return relativePath.includes('/__tests__/') || relativePath.includes('/generated/');
}

/** ファイルを読む。読めなければ空文字(走査は best-effort であり、ここで検証を止めない)。 */
function readText(absolute: string): string {
  try {
    return readFileSync(absolute, 'utf8');
  } catch {
    return '';
  }
}
