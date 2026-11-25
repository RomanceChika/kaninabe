/**
 * 構造の突合のテストを**字面として読む**ところ(コメントの落とし方・import の解決・持ち込み)。
 *
 * `db-parity.ts` が「実行できるか」を判定するための材料を作る側で、ここはその入力(突合のテストの
 * 字面)を読む。
 *
 * ## 何を解くのか
 *
 * 一時ツリーには**題材の生成物**と**仕組みの実物への symlink** しか無い。突合のテストが
 * そこに無いものを import していれば実行できない。ただし**同じ置き場の小さな部品**(型名の
 * 寄せ方など)は責務の分割であってアプリへの依存ではないので、リポジトリから**持ち込む**。
 * 持ち込む先も同じ規則で読むので、アプリの生成物へ辿り着く部品は持ち込めない(= その部品を
 * import した突合ごと実行しない)。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sampleInfrastructureTests, sampleSourceAlias, sampleSourceRoot } from './db-places.js';
import type { ProductLayout } from '../../../model/product/layout.js';
import type { ProductRoots } from '../../../model/product/types.js';



/**
 * **持ち込んでよい範囲**(リポジトリルート相対の接頭辞)。
 *
 * 持ち込むのは「突合のテストが同じ置き場で分けた小さな部品」だけである。ここを開くと、
 * 通し実行が仕組みの実装(`legacy/spec-tools/lib/**`)まで一時ツリーへ写して回り始め、
 * **題材の宣言を 1 つも読まない検査**が題材ごとに 5 回走ることになる(③-2 の裁定 (B) と
 * 同じ線引き —— 通し実行は設計に無い経路を作らない)。
 */
function carryRoot(roots: ProductRoots, layout: ProductLayout): string {
  return `${sampleInfrastructureTests(roots, layout)}/`;
}

/** import を解くときに試す形(TypeScript の解決規則のうち、この木で使われるものだけ)。 */
const RESOLUTIONS: readonly ((specifier: string) => string)[] = [
  (specifier) => specifier,
  (specifier) => `${specifier}.ts`,
  (specifier) => specifier.replace(/\.js$/, '.ts'),
  (specifier) => path.join(specifier, 'index.ts'),
];

/** そのファイルが自分で宣言している名前(`const entries = …` のような局所名)。 */
const BINDING = /\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;

/** import の指定子(`from '…'` と副作用 import の両方)。 */
const SPECIFIER = /(?:from|import)\s+'([^']+)'/g;

/**
 * コメントを落とした字面(名指しの判定は**実行される本文**だけを見る)。
 *
 * 散文にアプリの表名が出るのは当たり前(何を見ているかの説明である)なので、そこで
 * 実行しない判定にすると全部が実行できなくなる。
 *
 * @param source ソース
 * @returns ブロックコメントと行コメントを空白に置き換えた字面
 */
export function strippedSource(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1 ');
}

/**
 * ファイルが自分で束縛している名前を集める。
 *
 * 綴りがホストの表名と同じだけの**局所変数**を「アプリの名前を名指している」と読むと、
 * 実行できるはずの突合が名前の偶然で落ちる(実測: `const entries = grouped.get(column)`)。
 *
 * @param source コメントを落とした字面
 * @returns 束縛された名前の集合
 */
export function boundNames(source: string): ReadonlySet<string> {
  return new Set([...source.matchAll(BINDING)].map((match) => match[1] ?? ''));
}

/**
 * その名前が識別子として現れるか(`Object.entries` のような**属性名**は数えない)。
 *
 * @param source コメントを落とした字面
 * @param name 探す名前
 * @returns 現れていれば true
 */
export function mentions(source: string, name: string): boolean {
  return new RegExp(`(?<![\\w.])${name}(?![\\w])`).test(source);
}

/** その位置に解決できるファイルがあれば、その実パスを返す。 */
function resolveAt(base: string): string | null {
  return RESOLUTIONS.map((shape) => shape(base)).find(existsSync) ?? null;
}

/** そのファイルが持つ import を、相対とソースの根の別名(`{別名}/…`。別名は置き場の配置が与える)に分けて返す。 */
function specifiersOf(source: string, aliasPrefix: string): { relative: readonly string[]; alias: readonly string[] } {
  const all = [...source.matchAll(SPECIFIER)].map((match) => match[1] ?? '');
  return {
    relative: [...new Set(all.filter((s) => s.startsWith('.')))].sort(),
    alias: [...new Set(all.filter((s) => s.startsWith(aliasPrefix)))].sort(),
  };
}

/** 1 つの木を辿った結果。 */
export interface SourceClosure {
  /** そのテストと、持ち込む部品(リポジトリルート相対。名前順)。 */
  readonly files: readonly string[];
  /** 一時ツリーにもリポジトリにも無かった指定子(`{ファイル}: {指定子}`)。 */
  readonly unresolved: readonly string[];
  /** 木の全ファイルのコメントを落とした字面を連ねたもの(名指しの判定に使う)。 */
  readonly text: string;
}

/**
 * テスト 1 本から辿れる字面の木を作る。
 *
 * 相対 import は一時ツリー → リポジトリの順に解き、リポジトリでしか解けなかったものは
 * **持ち込む部品**として木に入れる(その部品の import も同じ規則で辿る)。持ち込めるのは
 * 突合の置き場(`CARRY_ROOT`)の中だけである。ソースの根の別名(置き場の配置が与える)は一時ツリーだけで解く —— 題材の生成物を
 * 指す道であり、リポジトリ側はホストの生成物だからである。
 *
 * @param args リポジトリルート・一時ツリー・起点のファイル(リポジトリルート相対)
 * @returns 木のファイル・解けなかった指定子・字面
 */
export function sourceClosure(args: {
  readonly repoRoot: string;
  readonly treeRoot: string;
  readonly file: string;
  readonly roots: ProductRoots;
  readonly layout: ProductLayout;
}): SourceClosure {
  const seen = new Set<string>();
  const unresolved: string[] = [];
  const texts: string[] = [];
  const queue = [args.file];
  while (queue.length > 0) {
    const file = queue.shift() ?? '';
    if (seen.has(file)) continue;
    seen.add(file);
    const source = strippedSource(readFileSync(path.join(args.repoRoot, file), 'utf-8'));
    texts.push(source);
    const { relative, alias } = specifiersOf(source, `${sampleSourceAlias(args.layout)}/`);
    for (const specifier of alias) {
      const target = path.join(args.treeRoot, sampleSourceRoot(args.roots, args.layout), specifier.slice(`${sampleSourceAlias(args.layout)}/`.length));
      if (resolveAt(target) === null) unresolved.push(`${file}: ${specifier}`);
    }
    for (const specifier of relative) {
      const relativeTarget = path.normalize(path.join(path.dirname(file), specifier));
      if (resolveAt(path.join(args.treeRoot, relativeTarget)) !== null) continue;
      const inRepo = relativeTarget.startsWith(carryRoot(args.roots, args.layout))
        ? resolveAt(path.join(args.repoRoot, relativeTarget))
        : null;
      if (inRepo === null) unresolved.push(`${file}: ${specifier}`);
      else queue.push(path.relative(args.repoRoot, inRepo));
    }
  }
  return { files: [...seen].sort(), unresolved: [...new Set(unresolved)].sort(), text: texts.join('\n') };
}
