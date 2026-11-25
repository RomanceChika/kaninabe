/**
 * specs/backend/queries を走査して QuerySpecModel を構築するローダー。
 *
 * ファイル I/O を行うのはこのモジュール(と CLI)だけであり、YAML → モデルの変換は
 * parse-query の純粋関数に委ねる(規約: scripts-code-quality.md)。
 * 構築時に検出できるのは Q0(スキーマ適合)だけで、Q1〜Q7 は検証器がモデルに対して行う。
 */

import { readFileSync } from 'node:fs';
import type { Finding } from '../../kernel/finding.js';
import { SpecReporter } from '../parse-common.js';
import { parseSafeFrontmatter } from '../safe-frontmatter.js';
import { detectRepoRoot, isDirectory, toRelative, walkFiles } from '../../io/paths.js';
import type { QuerySpec, QuerySpecModel } from './types.js';
import { parseQuerySpec } from './parse-query.js';

/** ローダーが積む Finding の検証器 ID。ローダーが担うのは Q0(スキーマ適合)のみ。 */
export const Q0_VERIFIER_ID = 'Q0';

/** ディレクトリガイド。仕様ではないので読み飛ばす。 */
const GUIDE_FILE = 'README.md';

/** ローダーの任意設定。 */
export interface LoadQueriesOptions {
  /**
   * Finding の location.file をこのディレクトリからの相対パスにする。
   * 省略時は rootDir から上に製品の根の宣言(product.md)を探し、見つからなければ rootDir の親を使う。
   */
  readonly repoRoot?: string;
}

/** loadQuerySpecModel の結果。 */
export interface LoadQueriesResult {
  /** 構築したモデル。ディレクトリが無い場合は `available: false` の空モデル。 */
  readonly model: QuerySpecModel;
  /** 構築中に検出した Q0 違反。空とは限らない。 */
  readonly findings: Finding[];
  /** モデルへ入れずに捨てたクエリ仕様のファイルの数(0 なら、Q0 の違反が残っていてもモデルは欠けていない)。 */
  readonly dropped: number;
}

/**
 * specs/backend/queries 配下を走査して読み取りクエリ仕様のモデルを構築する。
 *
 * `{aggregate}/{name}.md` を query_spec として読み、README.md と
 * `template.{doc_type}.md` は読み飛ばす。
 *
 * ディレクトリが無い場合は「読み取り経路をまだ仕様化していない」を意味する正常な状態として
 * `available: false` の空モデルを返す(action_spec と違い、query_spec は全操作の網羅を
 * 要求しないため、不在そのものは違反ではない)。ディレクトリはあるが 0 件の場合とは区別する。
 *
 * @param rootDir specs/backend/queries の絶対パス
 * @param options 相対パス基準などの任意設定
 * @returns モデルと Q0 違反のリスト
 */
export function loadQuerySpecModel(
  rootDir: string,
  options: LoadQueriesOptions = {},
): LoadQueriesResult {
  if (!isDirectory(rootDir)) return missingQuerySpecModel();

  const repoRoot = options.repoRoot ?? detectRepoRoot(rootDir);
  const findings: Finding[] = [];
  const queries: QuerySpec[] = [];
  let dropped = 0;
  for (const absolute of walkFiles(rootDir, isQuerySpecFile)) {
    const spec = readQuerySpec(absolute, rootDir, repoRoot, findings);
    if (spec === null) dropped += 1;
    else queries.push(spec);
  }
  return { model: { available: true, queries }, findings, dropped };
}

/** query_spec として読む対象か。README と template は仕様ではない。 */
function isQuerySpecFile(name: string): boolean {
  if (!name.endsWith('.md')) return false;
  if (name === GUIDE_FILE) return false;
  return !/^template\..+\.md$/.test(name);
}

/** 1 つの query_spec ファイルを読んでパースする。 */
function readQuerySpec(
  absolute: string,
  rootDir: string,
  repoRoot: string,
  findings: Finding[],
): QuerySpec | null {
  const file = toRelative(repoRoot, absolute);
  const reporter = new SpecReporter(file);
  const source = readText(absolute, reporter);
  const data = source === null ? null : parseSafeFrontmatter(source, reporter);
  findings.push(...reporter.findings().map(rebrand));
  if (data === null) return null;

  const result = parseQuerySpec(data, file, toRelative(rootDir, absolute));
  findings.push(...result.findings.map(rebrand));
  return result.value;
}

/** ファイルを読む。読めない場合は違反を記録して null。 */
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

/**
 * SpecReporter はドメイン仕様用に検証器 ID を V1 固定で積むため、
 * query_spec 側のスキーマ違反であることが分かるよう Q0 に付け替える。
 */
function rebrand(finding: Finding): Finding {
  return { ...finding, verifier: Q0_VERIFIER_ID };
}

/**
 * query_spec の置き場が無いときの読み込みの結果(`available: false` の空モデル)。
 *
 * **ファイルを読まない純粋な値**である。ローダー自身の「置き場が無い」の分岐と、製品が採っていない種類の入力(読まない)が
 * 同じ値を作るための 1 本(予約の名前の置き場を読みに行かせる形は、その名前に有効な仕様が置かれると前提が崩れる)。
 */
export function missingQuerySpecModel(): LoadQueriesResult {
  return { model: { available: false, queries: [] }, findings: [], dropped: 0 };
}
