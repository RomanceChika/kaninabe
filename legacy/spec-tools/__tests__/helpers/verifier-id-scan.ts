/**
 * 検査器のコード(`legacy/spec-tools/lib`)を走査して、検査 ID の綴りを集める I/O 境界(**テストの道具**)。
 *
 * 検査 ID の実在の正は全検査の表(`lib/compose/all-checks.ts`)である。ここは表の登録漏れを見つける突き合わせ用で、
 * コードに ID として書かれている綴りを集める(`verifier-id-literals.ts` が集め方、`gates/check-registry.test.ts` が判定)。
 * 走査する場所は実行している検査器自身の位置から引く(製品の根から導かない)。
 */

import { fileURLToPath } from 'node:url';
import { isDirectory, walkFiles } from '../../lib/io/paths.js';
import { tryReadText } from '../../lib/io/read-text.js';
import { collectVerifierIds } from './verifier-id-literals.js';

/**
 * 実行している検査器の `lib` の絶対パス。
 *
 * @returns `legacy/spec-tools/lib` の絶対パス
 */
export function defaultLibDir(): string {
  return fileURLToPath(new URL('../../lib/', import.meta.url));
}

/**
 * `lib` 配下の `.ts` から、検査 ID の綴りを集める。
 *
 * @param libDir 走査の起点(既定は実行している検査器の `lib`)
 * @returns 検査 ID の集合。起点が読めない構成では null
 */
export function scanKnownVerifierIds(libDir: string = defaultLibDir()): ReadonlySet<string> | null {
  if (!isDirectory(libDir)) return null;
  const sources = walkFiles(libDir, (name) => name.endsWith('.ts')).flatMap((file) => tryReadText(file) ?? []);
  return collectVerifierIds(sources);
}
