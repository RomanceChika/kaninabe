/**
 * ソースの写しから **import グラフを AST で組む**(層の構造テストの目)。
 *
 * 数えるのは `typescript` の `createSourceFile` が返す木であり、正規表現で `from '...'` を拾わない
 * (コメントや文字列の中の綴りを辺にしないため)。辺になる形は 5 つ ——
 *
 * - `value` … 実行時に効く `import`(`import { a } from`・`import a from`・`import * as a from`)
 * - `type` … `import type` / 指定子が全部 `type` の `import { type A }` / `export type … from` /
 *   `import('./x.js').T` の型
 * - `side` … 副作用 import(`import './x.js'`)
 * - `reexport` … `export { a } from` / `export * from`
 * - `dynamic` … `import('./x.js')` の呼び出し(**指定子が置換なしのテンプレートリテラル**
 *   `` import(`./x.js`) `` も同じ)と、`require('./x.js')` の呼び出し
 *   (`import x = require('./x.js')` は `value`)
 *
 * **指定子が字句でない**動的 import / `require`(`` import(`./${x}.js`) `` / `import(name)` / `require(x)`)は行き先が字面から
 * 決まらない。以前は辺を作らずに黙っていた(fail-open。点検 6 回目 B6-1 —— 有料の連携に届く道が閉包から消えた)。
 * いまは `opaque: true` の印をつけて拾い、グローバルな組み立て(`buildImportGraph`)は `unresolved` に、閉包
 * (`import-closure.ts`)も `unresolved` に載せる —— **閉包が欠けた**ことを使う側が必ず見る(fail-closed)。
 * 指定子の欄には引数の字面(`` `./${x}.js` ``)を入れる(反例に出す用。解決には使わない)。
 *
 * 値の循環を見るときは `type` だけを除く(型は実行時に消えるので循環しない)。**副作用・再輸出・動的**は
 * 実行時にモジュールを読むので値の辺として数える(`semantics-layer.test.ts` の旧版は、副作用 import と
 * 動的 import が検査を通り抜けた)。
 *
 * ファイルの読み込みは `lib/io/read-ts-tree.ts` が持ち、ここは `パス → 本文` の写しだけを受ける
 * 純関数である。
 */

import path from 'node:path';
import ts from 'typescript';
import { FRAMEWORK_CODE_EXTENSIONS } from '../io/paths.js';

/** import の形(辺の種類)。 */
export type ImportKind = 'value' | 'type' | 'side' | 'reexport' | 'dynamic';

/** ファイル → ファイルの辺 1 本。 */
export interface ImportEdge {
  /** 読む側(`lib/` 始まりの相対パス)。 */
  readonly from: string;
  /** 読まれる側(内部の辺ならファイルのパス。外部モジュールなら指定子そのもの)。 */
  readonly to: string;
  readonly kind: ImportKind;
  /** 読む側の何行目か(1 始まり)。 */
  readonly line: number;
}

/** 組んだグラフ。 */
export interface ImportGraph {
  /** 母集合のファイル(昇順)。 */
  readonly files: readonly string[];
  /** 母集合の中の辺。 */
  readonly edges: readonly ImportEdge[];
  /** 相対 import なのに母集合の外(`lib/` の外)を指す辺。`to` は解いたパス。 */
  readonly outside: readonly ImportEdge[];
  /** 相対 import なのに母集合の中に実体が見つからない辺と、指定子が字句でない動的 import / `require`(`to` は指定子の字面)。 */
  readonly unresolved: readonly ImportEdge[];
  /** 相対でない指定子(`node:fs` など)への辺。`to` は指定子そのもの。 */
  readonly external: readonly ImportEdge[];
}

/** 本文から拾った import 1 つ(解決前)。 */
export interface RawImport {
  readonly specifier: string;
  readonly kind: ImportKind;
  readonly line: number;
  /** 指定子が字句でない(行き先が字面から決まらない)。そのとき `specifier` は引数の字面。 */
  readonly opaque?: true;
}

/** `import { type A, type B }` のように指定子が全部 `type` か。 */
function allNamedAreType(elements: readonly { readonly isTypeOnly: boolean }[]): boolean {
  return elements.length > 0 && elements.every((element) => element.isTypeOnly);
}

/** `import` 宣言の種類。 */
function kindOfImport(node: ts.ImportDeclaration): ImportKind {
  const clause = node.importClause;
  if (clause === undefined) return 'side';
  if (clause.isTypeOnly) return 'type';
  const bindings = clause.namedBindings;
  const named = bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements : [];
  return clause.name === undefined && allNamedAreType(named) ? 'type' : 'value';
}

/** `export … from` 宣言の種類。 */
function kindOfExport(node: ts.ExportDeclaration): ImportKind {
  if (node.isTypeOnly) return 'type';
  const clause = node.exportClause;
  if (clause !== undefined && ts.isNamedExports(clause) && allNamedAreType(clause.elements)) return 'type';
  return 'reexport';
}

/** 文字列リテラル、または置換なしのテンプレートリテラルならその本文(それ以外は null)。 */
function literalText(node: ts.Node | undefined): string | null {
  if (node === undefined) return null;
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

/**
 * 1 ファイルの本文から import を全部拾う。
 *
 * @param fileName ファイル名(AST の診断用。中身の判定には使わない)
 * @param source 本文
 * @returns 指定子・種類・行番号(出現順)
 */
export function importsOfSource(fileName: string, source: string): readonly RawImport[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const found: RawImport[] = [];
  const add = (node: ts.Node, specifier: string, kind: ImportKind): void => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    found.push({ specifier, kind, line });
  };
  /** 字句の指定子なら辺に、そうでなければ「行き先が決まらない」印つきで拾う(引数が無ければ空の字面)。 */
  const addDynamic = (node: ts.CallExpression): void => {
    const argument = node.arguments[0];
    const specifier = literalText(argument);
    if (specifier !== null) {
      add(node, specifier, 'dynamic');
      return;
    }
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    found.push({ specifier: argument === undefined ? '' : argument.getText(file), kind: 'dynamic', line, opaque: true });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node, node.moduleSpecifier.text, kindOfImport(node));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node, node.moduleSpecifier.text, kindOfExport(node));
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (ts.isStringLiteral(expression)) add(node, expression.text, node.isTypeOnly ? 'type' : 'value');
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      addDynamic(node);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      addDynamic(node);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      add(node, node.argument.literal.text, 'type');
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * 正規化済みの解決先(`./x.js` を親のパスに畳んだもの)から、実在を当てる**候補の列**を作る
 * (`x.js` → `x.ts` を先に、`.mjs` → `.mts`、`.cjs` → `.cts`、そのまま、拡張子補完、`index`)。
 * 候補の並びの正はここ 1 か所である(C24 の閉包の解決も同じ列を使う)。
 *
 * @param joined 親ディレクトリと指定子を畳んだ、拡張子の補完前のパス
 */
export function resolutionCandidates(joined: string): readonly string[] {
  return [
    joined.replace(/\.js$/, '.ts'),
    joined.replace(/\.mjs$/, '.mts'),
    joined.replace(/\.cjs$/, '.cts'),
    joined,
    ...FRAMEWORK_CODE_EXTENSIONS.map((extension) => `${joined}${extension}`),
    ...FRAMEWORK_CODE_EXTENSIONS.map((extension) => `${joined}/index${extension}`),
  ];
}

/**
 * 相対 import の指定子を母集合のファイルに解く(`./x.js` → `x.ts`、`./x.mjs` → `x.mts`、
 * `./dir` → `dir/index.ts`。拡張子の無い指定子は走査する拡張子を順に当てる)。
 *
 * @returns 解けたパス / 母集合の外を指すなら `{ outside }` / 見つからなければ `null`
 */
function resolveRelative(
  from: string,
  specifier: string,
  files: ReadonlySet<string>,
  rootPrefixes: readonly string[],
): string | { readonly outside: string } | null {
  const joined = path.posix.join(path.posix.dirname(from), specifier);
  if (joined.startsWith('../') || !rootPrefixes.some((prefix) => joined.startsWith(prefix))) return { outside: joined };
  return resolutionCandidates(joined).find((candidate) => files.has(candidate)) ?? null;
}

/**
 * 写しの全ファイルから import グラフを組む。
 *
 * @param sources `lib/` 始まりの相対パス → 本文
 * @param rootPrefix 母集合の根の綴り(例: `lib/`。複数の根なら配列)。どれでも始まらない解決先は「母集合の外」
 * @returns 内部の辺・外を指す辺・解けない辺・外部モジュールへの辺
 */
export function buildImportGraph(sources: ReadonlyMap<string, string>, rootPrefix: string | readonly string[]): ImportGraph {
  const rootPrefixes = typeof rootPrefix === 'string' ? [rootPrefix] : rootPrefix;
  const files = [...sources.keys()].sort();
  const known = new Set(files);
  const edges: ImportEdge[] = [];
  const outside: ImportEdge[] = [];
  const unresolved: ImportEdge[] = [];
  const external: ImportEdge[] = [];
  for (const from of files) {
    for (const raw of importsOfSource(from, sources.get(from) ?? '')) {
      const edge = { from, kind: raw.kind, line: raw.line };
      // 行き先が字面から決まらない指定子は、解けない辺として必ず載せる(閉包が欠けた。fail-closed)。
      if (raw.opaque === true) {
        unresolved.push({ ...edge, to: raw.specifier });
        continue;
      }
      if (!raw.specifier.startsWith('.')) {
        external.push({ ...edge, to: raw.specifier });
        continue;
      }
      const target = resolveRelative(from, raw.specifier, known, rootPrefixes);
      if (target === null) unresolved.push({ ...edge, to: raw.specifier });
      else if (typeof target === 'string') edges.push({ ...edge, to: target });
      else outside.push({ ...edge, to: target.outside });
    }
  }
  return { files, edges, outside, unresolved, external };
}

/** 実行時に効く辺か(`type` だけが消える)。 */
export function isRuntimeEdge(edge: ImportEdge): boolean {
  return edge.kind !== 'type';
}

/**
 * 値の循環(実行時の辺だけで作る強連結成分のうち、2 ファイル以上か自己ループ)を全部返す。
 *
 * @param graph import グラフ
 * @returns 循環ごとのファイルの昇順の一覧(循環の並びも決定的)
 */
export function valueCycles(graph: ImportGraph): readonly (readonly string[])[] {
  const next = new Map<string, string[]>(graph.files.map((file) => [file, []]));
  for (const edge of graph.edges) if (isRuntimeEdge(edge)) next.get(edge.from)?.push(edge.to);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;
  const visit = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const to of next.get(node) ?? []) {
      if (!index.has(to)) {
        visit(to);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(to) ?? 0));
      } else if (onStack.has(to)) {
        low.set(node, Math.min(low.get(node) ?? 0, index.get(to) ?? 0));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    const members: string[] = [];
    for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
      onStack.delete(member);
      members.push(member);
      if (member === node) break;
    }
    const selfLoop = members.length === 1 && (next.get(node) ?? []).includes(node);
    if (members.length > 1 || selfLoop) cycles.push(members.sort());
  };
  for (const file of graph.files) if (!index.has(file)) visit(file);
  return cycles.sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
}
