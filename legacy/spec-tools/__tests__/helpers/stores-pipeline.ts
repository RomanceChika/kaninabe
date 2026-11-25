/**
 * 実パイプライン(`runAllVerifications`)を通すテストの共有部品: 土台(stores)の仕様の木を一時ツリーへ写し、`uses` の宣言を置いて回す。
 *
 * パイプラインは 1 回ごとに Z3 を使う。Z3 は隔離した worker に閉じ込められ(`lib/guard/z3-host.ts`)、割当の見積りが閾値を超えたら
 * 問いの間で worker が入れ替わり、応答しなくなったら host の期限で止まって error になる。**1 つのテストファイルで回す回数に上限は無い**
 * (かつては 30 回近くで WASM のヒープ 2 GiB が尽きて無音で止まった。40 回・100 回の直列で 1 回あたりの所要が一定なことを実測した)。
 * 後片付けは、使うテストファイルが `afterEach(removeTrees)` で呼ぶ。
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAllVerifications } from '../../lib/compose/verify-pipeline.js';
import type { SpecKind } from '../../lib/model/product/uses.js';
import { TEST_VERIFY_INPUTS } from './platform.js';
import { TEST_ROOTS, writeProductDeclaration } from './product-roots.js';

const STORES = path.join(fileURLToPath(new URL('../fixtures/samples/', import.meta.url)), 'stores', 'docs', 'specs');

/** 土台(stores)が採る種類。 */
export const ALL: readonly SpecKind[] = ['actions', 'queries', 'data_tables', 'notifications', 'jobs', 'config', 'auth', 'external', 'surface', 'screens', 'usecases'];

/** 土台が採る種類から、指した種類を外した宣言。 */
export const without = (...kinds: readonly SpecKind[]): readonly SpecKind[] => ALL.filter((kind) => !kinds.includes(kind));

/** 作った一時ツリー(後片付けのため)。 */
const created: string[] = [];

/** 作った一時ツリーを消す(`afterEach` から呼ぶ)。 */
export function removeTrees(): void {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
}

/** 壊れた仕様(フロントマターが無い)。 */
export const BROKEN = '# フロントマターの無い仕様\n';

/**
 * 仕様の木を一時ツリーへ写し、宣言を置き、実パイプラインを回す。
 *
 * @param uses 製品が採る種類
 * @param tree 写した仕様の木を触る(省略は触らない)
 */
export async function verifyTree(uses: readonly SpecKind[], tree: (specs: string) => void = () => undefined) {
  const repo = mkdtempSync(path.join(tmpdir(), 'input-state-c-'));
  created.push(repo);
  writeProductDeclaration(repo, uses);
  const specs = path.join(repo, TEST_ROOTS.specs);
  cpSync(STORES, specs, { recursive: true });
  tree(specs);
  const lines: string[] = [];
  const result = await runAllVerifications({ ...TEST_VERIFY_INPUTS, domainRoot: path.join(specs, 'domain'), log: (line) => lines.push(line) });
  return { ...result, lines, repo, specs };
}

/** 検査器 ID で始まる行(未実施 / 阻害)。 */
export const rowsOf = (lines: readonly string[], ids: readonly string[]): string[] =>
  lines.filter((line) => ids.some((id) => line.startsWith(`${id}: `)) && /: (未実施|阻害) — /.test(line));

/** 各検査器の Finding。 */
export const findingsOf = <T extends { verifier: string }>(findings: readonly T[], id: string): T[] => findings.filter((finding) => finding.verifier === id);

/** 置き場のファイル 1 枚を消す。 */
export const removeFile = (...segments: string[]) => (specs: string): void => rmSync(path.join(specs, ...segments), { force: true });

/** 置き場のディレクトリごと消す(置き場そのものが無い = 採ったのに読めない)。 */
export const removeDir = (...segments: string[]) => (specs: string): void => rmSync(path.join(specs, ...segments), { recursive: true, force: true });

/** 置き場のファイル 1 枚を壊す(フロントマターの無い仕様にする)。 */
export const breakFile = (...segments: string[]) => (specs: string): void => writeFileSync(path.join(specs, ...segments), BROKEN);

/** 置き場のファイル 1 枚の本文を書き換える(書き換えが効かなければ落とす = テストが空振りで通らない)。 */
export const rewrite =
  (segments: readonly string[], from: string, to: string) =>
  (specs: string): void => {
    const file = path.join(specs, ...segments);
    const before = readFileSync(file, 'utf8');
    if (!before.includes(from)) throw new Error(`${segments.join('/')} に ${from} が無い`);
    writeFileSync(file, before.replace(from, to));
  };
