/**
 * サービスの認証の秘密を**読む口が関門を通っているか**の走査(K6 の材料。I/O 境界)。
 *
 * `strength` を宣言した秘密は、実装の木で必ず次の形で読む(名前が文字列リテラルでその場にある形。K1 が拾える形でもある):
 *
 * ```
 * readServiceSecret('NAME', process.env['NAME'], 32)
 * ```
 *
 * 関門(`@kaninabe/runtime/secret` の `readServiceSecret`。**TypeScript の構文木で、呼び出し先が本物の import に束縛されていることを確かめる**。
 * 同名のローカル関数・名前の食い違い・包み直しは関門に数えない)が、下限に満たない値を「設定されていない」ものとして閉じる(ASVS V13.2.3)。
 * ここでは、ファイルごと・名前ごとに「`process.env` の素の参照が何回あるか」と「その中で関門を通っているものが何回で、
 * 下限として何を書いているか」を数える(`url-read-scan.ts` と同じ作り)。素の参照が関門の数より多い名前は、関門を通らない読み口がある。
 */

import { join } from 'node:path';
import ts from 'typescript';
import { isDirectory, toRelative, walkFiles } from '../io/paths.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import { allowedImports, parseSource, resolveImport, walk } from './import-binding.js';
import type { ImportSpec } from './import-binding.js';
import { REFERENCE_PATTERNS, envScanRoots, isSourceFile, readText } from './env-scan.js';
import { processEnvName } from './url-read-scan.js';

/** 1 つのファイルでの、1 つの設定の読み口の数え上げ。 */
export interface SecretRead {
  /** 環境変数名。 */
  readonly name: string;
  /** 読んでいるファイル(リポジトリルート相対)。 */
  readonly file: string;
  /** 素の参照(`process.env` / `requireEnv`)の回数。関門を通る読みの中の参照も 1 回に数える。 */
  readonly raw: number;
  /** 関門を通った読みが書いた下限(読みの数だけ並ぶ)。 */
  readonly guarded: readonly number[];
}

/** 走査結果。 */
export interface SecretReadScan {
  /** 走査対象の木が 1 つでもあったか。 */
  readonly available: boolean;
  /** 読み口の数え上げ。 */
  readonly reads: readonly SecretRead[];
}

/** 関門: `@kaninabe/runtime/secret` の `readServiceSecret`(別名の import も可。同名のローカル関数・別モジュールの import は関門ではない)。 */
const GATE: readonly ImportSpec[] = [{ module: '@kaninabe/runtime/secret', imported: 'readServiceSecret' }];

/** 名前の形(環境変数名)。 */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/u;

/**
 * ソースの構文木から、関門を通った読み(名前 → 書いた下限の並び)を集める。
 * 関門を通ったと数えるのは、呼び出し先が `@kaninabe/runtime/secret` の `readServiceSecret` の束縛に解決でき、第 1 引数が名前の文字列リテラル NAME、
 * 第 2 引数がちょうど `process.env['NAME']` / `process.env.NAME`(同じ NAME)、第 3 引数が正の整数の数値リテラルで、引数がその 3 つだけの呼び出し。
 */
function guardedReads(source: string, file: string): ReadonlyMap<string, readonly number[]> {
  const sourceFile = parseSource(source, file);
  const bound = allowedImports(sourceFile, GATE);
  const guarded = new Map<string, number[]>();
  if (bound.size === 0) return guarded;
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || resolveImport(node.expression, bound) === null) return;
    const [first, second, third] = node.arguments;
    if (node.arguments.length !== 3 || first === undefined || second === undefined || third === undefined) return;
    if (!ts.isStringLiteralLike(first) || !ENV_NAME.test(first.text) || !ts.isNumericLiteral(third)) return;
    if (processEnvName(second) !== first.text) return;
    const minLength = Number(third.text);
    if (!Number.isInteger(minLength) || minLength < 1) return;
    guarded.set(first.text, [...(guarded.get(first.text) ?? []), minLength]);
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
export function countSecretReads(source: string, file: string): readonly SecretRead[] {
  const raw = new Map<string, number>();
  for (const pattern of REFERENCE_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (name !== undefined && ENV_NAME.test(name)) raw.set(name, (raw.get(name) ?? 0) + 1);
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
export function scanSecretReads(repoRoot: string, productRoots: ProductRoots, layout: ProductLayout): SecretReadScan {
  const roots = envScanRoots(productRoots, layout)
    .map((relative) => join(repoRoot, relative))
    .filter(isDirectory);
  if (roots.length === 0) return { available: false, reads: [] };
  const reads: SecretRead[] = [];
  for (const root of roots) {
    for (const absolute of walkFiles(root, isSourceFile)) {
      reads.push(...countSecretReads(readText(absolute), toRelative(repoRoot, absolute)));
    }
  }
  return { available: true, reads };
}
