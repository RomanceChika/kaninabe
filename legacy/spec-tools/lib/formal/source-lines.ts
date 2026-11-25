/**
 * モデルの**鮮度**の判定(C24 の第 1 段)。
 *
 * モデルは実装の写しであり、写し元が動いたらモデルは黙って嘘になる。それを防ぐため、
 * 各 `.tla` は先頭で写し元を宣言し、ここがその宣言と実ファイルのハッシュを突き合わせる。
 *
 * 宣言には 2 形ある。
 *
 *   - `\* SOURCE: <パス> <sha256>` … **その場で書き換わるファイル**(生成器の TS・アプリの TS)。
 *     sha256 は本文ではなく**そのファイルと相対 import の推移的閉包の hash**(`semantics/import-closure.ts`)。
 *   - `\* SOURCE-FN: <関数名> <sha256>` … **DB の関数**。migration は追記専用の歴史なので、
 *     関数を直すと**新しい番号のファイル**ができて旧ファイルは 1 バイトも動かない。
 *     パスで宣言すると実装を直しても鮮度が赤くならないため、関数名で宣言し、
 *     その関数を定義する最新番号の migration を検査器が解決する。
 *
 * 純粋関数であり throw しない(ファイルの読み込みとハッシュの計算は CLI の仕事)。
 */

import { diffClosure } from '../semantics/import-closure.js';
import type { ClosureFile } from '../semantics/import-closure.js';
import type { FormalFinding, SourceDeclaration } from './types.js';

/** `\* SOURCE: <パス> <sha256>` の形。 */
const SOURCE_PATH = /^\\\*\s*SOURCE:\s*(\S+)\s+([0-9a-f]{64})\s*$/;

/** `\* SOURCE-FN: <関数名> <sha256>` の形。 */
const SOURCE_FN = /^\\\*\s*SOURCE-FN:\s*([A-Za-z_][A-Za-z0-9_]*)\s+([0-9a-f]{64})\s*$/;

/** `SOURCE` を宣言しているのに形が合わない行(書き損じを黙って見逃さないため)。 */
const SOURCE_PREFIX = /^\\\*\s*SOURCE(-FN)?:/;

/** 写し元の宣言の読み取り結果。 */
export interface SourceParseResult {
  readonly declarations: readonly SourceDeclaration[];
  /** 形が合わない `SOURCE` 行(行番号 → その行の字面)。 */
  readonly malformed: readonly { readonly line: number; readonly text: string }[];
}

/**
 * `.tla` の本文から写し元の宣言を読み取る。
 *
 * @param text `.tla` の全文
 * @returns 読めた宣言と、形が合わなかった `SOURCE` 行
 */
export function parseSourceDeclarations(text: string): SourceParseResult {
  const declarations: SourceDeclaration[] = [];
  const malformed: { line: number; text: string }[] = [];
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.trimEnd();
    const asPath = SOURCE_PATH.exec(line);
    if (asPath !== null) {
      declarations.push({ kind: 'path', target: asPath[1] ?? '', sha256: asPath[2] ?? '', line: index + 1 });
      continue;
    }
    const asFn = SOURCE_FN.exec(line);
    if (asFn !== null) {
      declarations.push({ kind: 'function', target: asFn[1] ?? '', sha256: asFn[2] ?? '', line: index + 1 });
      continue;
    }
    if (SOURCE_PREFIX.test(line)) malformed.push({ line: index + 1, text: line.trim() });
  }
  return { declarations, malformed };
}

/** 宣言 1 件を実ファイルへ解決した結果。 */
export type ResolvedSource =
  | {
      readonly kind: 'ok';
      readonly path: string;
      /** `SOURCE:` なら閉包の hash・`SOURCE-FN:` なら解決先 1 本の本文の sha256。 */
      readonly sha256: string;
      /** `SOURCE:` のときの閉包のファイル(`SOURCE-FN:` では無い)。 */
      readonly closure?: readonly ClosureFile[];
      /** 食い違ったとき、宣言を作った時点の閉包(履歴から復元できたときだけ。できなければ null)。 */
      readonly previous?: readonly ClosureFile[] | null;
    }
  | { readonly kind: 'missing'; readonly reason: string };

/** 宣言の `target` → 解決結果。 */
export type ResolvedSources = ReadonlyMap<string, ResolvedSource>;

/** 解決できなかったときの Finding。 */
function unresolved(model: string, declaration: SourceDeclaration, reason: string): FormalFinding {
  return {
    severity: 'error',
    message: `${model}: 写し元を解決できません(${declaration.target})`,
    location: `formal/${model}.tla:${declaration.line}`,
    suggestion:
      declaration.kind === 'function'
        ? `${reason}。関数名を直すか、その関数を定義する migration があるかを確かめる`
        : `${reason}。パスを直すか、写し元が移動したならモデルを見直して SOURCE を更新する`,
  };
}

/** 閉包のファイルを 1 行ずつ出す上限(極端に大きい閉包で端末を埋めない)。 */
const LISTED_FILES = 40;

/** 短い hash(印字用。突合は常に 64 桁で行う)。 */
function short(sha256: string): string {
  return sha256.slice(0, 12);
}

/** 閉包のどのファイルが動いたかを名指す行。旧い閉包を復元できなければ、閉包の全ファイルを出す。 */
function closureDetail(resolved: { closure: readonly ClosureFile[]; previous: readonly ClosureFile[] | null | undefined }): string[] {
  if (resolved.previous === undefined || resolved.previous === null) {
    const listed = resolved.closure.slice(0, LISTED_FILES).map((file) => `  ${file.path} ${short(file.sha256)}`);
    const rest = resolved.closure.length - listed.length;
    return [
      `閉包 ${resolved.closure.length} 本(旧い閉包を git の履歴から復元できなかったので、どれが動いたかは名指せません。全部を出します)`,
      ...listed,
      ...(rest > 0 ? [`  …ほか ${rest} 本`] : []),
    ];
  }
  const delta = diffClosure(resolved.previous, resolved.closure);
  return [
    `閉包 ${resolved.closure.length} 本のうち動いたもの(旧 → 新)`,
    ...delta.changed.map((file) => `  変わった: ${file.path} ${short(file.before)} → ${short(file.after)}`),
    ...delta.added.map((file) => `  増えた(import が増えた): ${file.path} ${short(file.sha256)}`),
    ...delta.removed.map((file) => `  減った(import が減った・消えた): ${file.path} ${short(file.sha256)}`),
  ];
}

/** ハッシュが食い違ったときの Finding。 */
function stale(
  model: string,
  declaration: SourceDeclaration,
  resolved: { path: string; sha256: string; closure?: readonly ClosureFile[]; previous?: readonly ClosureFile[] | null },
): FormalFinding {
  const isFunction = declaration.kind === 'function';
  const what = isFunction
    ? `関数 ${declaration.target}(いまの定義は ${resolved.path})`
    : `${resolved.path} とその import の閉包`;
  return {
    severity: 'error',
    message: `${model}: 写し元が変わりました(${what})`,
    location: `formal/${model}.tla:${declaration.line}`,
    suggestion:
      'モデルがまだその実装を写しているかを読んで確かめ、写せているなら sha256 を ' +
      `${resolved.sha256} に更新する。意味が変わっていたらモデルと expectations.json を直す`,
    detail: [
      `宣言: ${declaration.sha256}`,
      `実際: ${resolved.sha256}`,
      `解決先: ${resolved.path}`,
      ...(resolved.closure === undefined ? [] : closureDetail({ closure: resolved.closure, previous: resolved.previous })),
    ],
  };
}

/**
 * 宣言と実ファイルのハッシュを突き合わせる。
 *
 * @param model モジュール名(`Outbox` 等)
 * @param parsed その `.tla` から読み取った宣言
 * @param resolved 宣言の target → 解決結果(CLI が解決して渡す)
 * @returns 食い違い 1 件につき 1 つの Finding。食い違いが無ければ空配列
 */
export function freshnessFindings(
  model: string,
  parsed: SourceParseResult,
  resolved: ResolvedSources,
): FormalFinding[] {
  const findings: FormalFinding[] = [];
  for (const bad of parsed.malformed) {
    findings.push({
      severity: 'error',
      message: `${model}: SOURCE 行の形が合いません(${bad.text})`,
      location: `formal/${model}.tla:${bad.line}`,
      suggestion:
        '`\\* SOURCE: <リポジトリルートからの相対パス> <sha256 の 64 桁>` か ' +
        '`\\* SOURCE-FN: <関数名> <sha256 の 64 桁>` の 1 行に直す',
    });
  }
  if (parsed.declarations.length === 0 && parsed.malformed.length === 0) {
    findings.push({
      severity: 'error',
      message: `${model}: 写し元(SOURCE / SOURCE-FN)の宣言が 1 行もありません`,
      location: `formal/${model}.tla`,
      suggestion: 'このモデルが何を写したのかを先頭に宣言する',
    });
  }
  for (const declaration of parsed.declarations) {
    const entry = resolved.get(declaration.target);
    if (entry === undefined) {
      findings.push(unresolved(model, declaration, '解決を試みていません'));
      continue;
    }
    if (entry.kind === 'missing') {
      findings.push(unresolved(model, declaration, entry.reason));
      continue;
    }
    if (entry.sha256 !== declaration.sha256) findings.push(stale(model, declaration, entry));
  }
  return findings;
}
