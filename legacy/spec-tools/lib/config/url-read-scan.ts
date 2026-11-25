/**
 * 設定の URL を**読む口が関門を通っているか**の走査(K4 の材料。I/O 境界)。
 *
 * `format: url` の設定は、実装の木で必ず次の形で読む(名前が文字列リテラルでその場にある形。K1 が拾える形でもある):
 *
 * ```
 * readConfigUrl('NAME', process.env['NAME'], '<scheme>')
 * ```
 *
 * 関門(`@kaninabe/runtime/url` の `readConfigUrl`。**TypeScript の構文木で、呼び出し先が本物の import に束縛されていることを確かめる**。
 * 同名のローカル関数・名前の食い違い・包み直しは関門に数えない)が宣言した `scheme` に合わない値を例外にする(平文の送り先を黙って使わない。
 * ASVS V12.3.1)。ここでは、ファイルごと・名前ごとに「`process.env` の素の参照が何回あるか」と「その中で関門を通っているものが
 * 何回で、どの `scheme` で通っているか」を数える。素の参照が関門の数より多い名前は、関門を通らない読み口がある。
 * 名前を変数越しに読む書き方は拾えない(それ自体を ESLint の `PROCESS_ENV_SELECTORS` が止める)。
 */

import { join } from 'node:path';
import { isDirectory, toRelative, walkFiles } from '../io/paths.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import ts from 'typescript';
import { allowedImports, parseSource, resolveImport, walk } from './import-binding.js';
import type { ImportSpec } from './import-binding.js';
import { REFERENCE_PATTERNS, envScanRoots, isSourceFile, readText } from './env-scan.js';

/** 1 つのファイルでの、1 つの設定の読み口の数え上げ。 */
export interface UrlRead {
  /** 環境変数名。 */
  readonly name: string;
  /** 読んでいるファイル(リポジトリルート相対)。 */
  readonly file: string;
  /** 素の参照(`process.env` / `requireEnv`)の回数。関門を通る読みの中の参照も 1 回に数える。 */
  readonly raw: number;
  /** 関門を通った読みが書いた `scheme`(読みの数だけ並ぶ)。 */
  readonly guarded: readonly string[];
}

/** 走査結果。 */
export interface UrlReadScan {
  /** 走査対象の木が 1 つでもあったか。 */
  readonly available: boolean;
  /** 読み口の数え上げ。 */
  readonly reads: readonly UrlRead[];
}

/** 関門: `@kaninabe/runtime/url` の `readConfigUrl`(別名の import も可。同名のローカル関数・別モジュールの import は関門ではない)。 */
const GATE: readonly ImportSpec[] = [{ module: '@kaninabe/runtime/url', imported: 'readConfigUrl' }];

/** 名前の形(環境変数名)。 */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * `process.env['NAME']` / `process.env.NAME` の NAME(それ以外の式は null)。
 *
 * @param node 式(括弧・`as`・`!` で包んだものは関門の形ではないので辿らない)
 * @returns 名前
 */
export function processEnvName(node: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(node) && !ts.isOptionalChain(node) && isProcessEnv(node.expression)) return node.name.text;
  if (ts.isElementAccessExpression(node) && !ts.isOptionalChain(node) && isProcessEnv(node.expression) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

/** `process.env` そのものか。 */
function isProcessEnv(node: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(node) && node.name.text === 'env' && ts.isIdentifier(node.expression) && node.expression.text === 'process';
}

/**
 * ソースの構文木から、関門を通った読み(名前 → 書いた scheme の並び)を集める。
 * 関門を通ったと数えるのは、呼び出し先が `@kaninabe/runtime/url` の `readConfigUrl` の束縛に解決でき、第 1 引数が名前の文字列リテラル NAME、
 * 第 2 引数がちょうど `process.env['NAME']` / `process.env.NAME`(同じ NAME)、第 3 引数が scheme の文字列リテラルで、引数がその 3 つだけの呼び出し。
 *
 * @param source ファイルの内容
 * @param file ファイル名
 * @returns 名前ごとの scheme
 */
function guardedReads(source: string, file: string): ReadonlyMap<string, readonly string[]> {
  const sourceFile = parseSource(source, file);
  const bound = allowedImports(sourceFile, GATE);
  const guarded = new Map<string, string[]>();
  if (bound.size === 0) return guarded;
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || resolveImport(node.expression, bound) === null) return;
    const [first, second, third] = node.arguments;
    if (node.arguments.length !== 3 || first === undefined || second === undefined || third === undefined) return;
    if (!ts.isStringLiteralLike(first) || !ENV_NAME.test(first.text) || !ts.isStringLiteralLike(third) || !/^[a-z_]+$/u.test(third.text)) return;
    if (processEnvName(second) !== first.text) return;
    guarded.set(first.text, [...(guarded.get(first.text) ?? []), third.text]);
  });
  return guarded;
}

/**
 * ソース 1 本の読み口を数える(純関数)。
 *
 * @param source ファイルの内容
 * @param file ファイル名(結果に載せる)
 * @returns 名前ごとの数え上げ(出現順)
 */
export function countUrlReads(source: string, file: string): readonly UrlRead[] {
  const raw = new Map<string, number>();
  for (const pattern of REFERENCE_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (name !== undefined && /^[A-Z][A-Z0-9_]*$/.test(name)) raw.set(name, (raw.get(name) ?? 0) + 1);
    }
  }
  const guarded = guardedReads(source, file);
  return [...raw.entries()].map(([name, count]) => ({ name, file, raw: count, guarded: guarded.get(name) ?? [] }));
}

/**
 * 実装の木を走査して読み口を数える。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param productRoots 製品が宣言した根
 * @param layout 置き場の配置
 * @returns 走査結果
 */
export function scanUrlReads(repoRoot: string, productRoots: ProductRoots, layout: ProductLayout): UrlReadScan {
  const roots = envScanRoots(productRoots, layout)
    .map((relative) => join(repoRoot, relative))
    .filter(isDirectory);
  if (roots.length === 0) return { available: false, reads: [] };
  const reads: UrlRead[] = [];
  for (const root of roots) {
    for (const absolute of walkFiles(root, isSourceFile)) {
      reads.push(...countUrlReads(readText(absolute), toRelative(repoRoot, absolute)));
    }
  }
  return { available: true, reads };
}
