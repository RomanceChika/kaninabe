/**
 * specs/backend/data/tables を走査して DataTableSpecModel を構築するローダー。
 *
 * ファイル I/O を行うのはこのモジュール(と CLI)だけであり、YAML → モデルの変換は
 * parse-data-table の純粋関数に委ねる(規約: scripts-code-quality.md)。
 * 構築時に検出できるのは T0(スキーマ適合)だけで、T1 は検証器がモデルに対して行う。
 */

import { readFileSync } from 'node:fs';
import type { Finding } from '../../kernel/finding.js';
import { SpecReporter } from '../parse-common.js';
import { parseSafeFrontmatter } from '../safe-frontmatter.js';
import { detectRepoRoot, isDirectory, toRelative, walkFiles } from '../../io/paths.js';
import type { DataTableSpec, DataTableSpecModel } from './types.js';
import { parseDataTableSpec } from './parse-data-table.js';

/** ローダーが積む Finding の検証器 ID。ローダーが担うのは T0(スキーマ適合)のみ。 */
export const T0_VERIFIER_ID = 'T0';

/** ディレクトリガイド。仕様ではないので読み飛ばす。 */
const GUIDE_FILE = 'README.md';

/** ローダーの任意設定。 */
export interface LoadDataTablesOptions {
  /**
   * Finding の location.file をこのディレクトリからの相対パスにする。
   * 省略時は rootDir から上に製品の根の宣言(product.md)を探し、見つからなければ rootDir の親を使う。
   */
  readonly repoRoot?: string;
}

/** loadDataTableSpecModel の結果。 */
export interface LoadDataTablesResult {
  /** 構築したモデル。ディレクトリが無い場合は `available: false` の空モデル。 */
  readonly model: DataTableSpecModel;
  /** 構築中に検出した T0 違反。空とは限らない。 */
  readonly findings: Finding[];
  /**
   * モデルへ入れずに捨てたテーブル仕様のファイルの数(0 なら、T0 の違反が残っていてもモデルは欠けていない)。
   * **表の中で行を落としたファイル**(読めなかった行・宣言がある表)も 1 枚として数え、その表はモデルに入れない
   * (欠けた行を前提にした自己完結の検査が、偽の指摘を出さないため。名前は `model.droppedTables` に載る)。
   */
  readonly dropped: number;
}

/**
 * specs/backend/data/tables 配下を走査してテーブル仕様のモデルを構築する。
 *
 * `{table}.md` を data_table として読み、README.md と `template.{doc_type}.md` は読み飛ばす。
 * ディレクトリが無い場合は「テーブル仕様をまだ開設していない」を意味する正常な状態として
 * `available: false` の空モデルを返す(query_spec と同じ扱い)。
 *
 * @param rootDir specs/backend/data/tables の絶対パス
 * @param options 相対パス基準などの任意設定
 * @returns モデルと T0 違反のリスト
 */
export function loadDataTableSpecModel(
  rootDir: string,
  options: LoadDataTablesOptions = {},
): LoadDataTablesResult {
  if (!isDirectory(rootDir)) return missingDataTableSpecModel();

  const repoRoot = options.repoRoot ?? detectRepoRoot(rootDir);
  const findings: Finding[] = [];
  const tables: DataTableSpec[] = [];
  const droppedTables: string[] = [];
  const droppedEntities: Record<string, string> = {};
  for (const absolute of walkFiles(rootDir, isDataTableFile)) {
    const read = readDataTableSpec(absolute, rootDir, repoRoot, findings);
    if (read.spec !== null && !read.droppedRows) {
      tables.push(read.spec);
      continue;
    }
    const relative = toRelative(rootDir, absolute);
    droppedTables.push(relative);
    if (read.entity !== undefined) droppedEntities[relative] = read.entity;
  }
  findings.push(...overloadFindings(tables));
  if (droppedTables.length === 0) return { model: { available: true, tables }, findings, dropped: 0 };
  const entities = Object.keys(droppedEntities).length === 0 ? {} : { droppedEntities };
  return { model: { available: true, tables, droppedTables, ...entities }, findings, dropped: droppedTables.length };
}

/**
 * **同じ名前の関数を 2 つの表が宣言している**形(R17。同じ名前の別の overload)。
 *
 * 1 ファイルの中の重複は表のパーサーが落とすが、表をまたぐ重複は 1 ファイルでは見えない。同じ名前の関数が 2 本宣言されると、
 * 引数の型の並びだけが違う別の関数(overload)が DB に並ぶ —— 権限の許可・呼び出し・生成の「古い overload を落とす」前置が
 * 名前で引く箇所では、どちらを指しているのかが宣言から 1 つに決まらない。関数の名前は全 data_table を通して一意にする。
 */
function overloadFindings(tables: readonly DataTableSpec[]): Finding[] {
  const first = new Map<string, string>();
  const findings: Finding[] = [];
  for (const table of tables) {
    for (const fn of table.functions) {
      const earlier = first.get(fn.name);
      if (earlier === undefined) {
        first.set(fn.name, table.location.file);
        continue;
      }
      findings.push({
        verifier: T0_VERIFIER_ID,
        severity: 'error',
        message: `関数 ${fn.name} を 2 つの表が宣言しています(${earlier} と ${table.location.file})。同じ名前の別の overload が DB に並び、名前で引く権限と呼び出しがどちらを指すか決まりません`,
        location: { ...table.location, pointer: `functions.${fn.name}` },
        suggestion: '関数の名前は全 data_table を通して一意にする(同じ関数なら 1 つの表にだけ宣言し、別の関数なら名前を変える)',
        counterexample: { function: fn.name, first: earlier, second: table.location.file },
      });
    }
  }
  return findings;
}

/** data_table として読む対象か。README と template は仕様ではない。 */
function isDataTableFile(name: string): boolean {
  if (!name.endsWith('.md')) return false;
  if (name === GUIDE_FILE) return false;
  return !/^template\..+\.md$/.test(name);
}

/** 1 つの data_table ファイルを読んだ結果(読めなかったファイルは `spec: null`)。 */
interface ReadDataTable {
  readonly spec: DataTableSpec | null;
  /** 表の中で、読めずに落とした行・宣言があったか。 */
  readonly droppedRows: boolean;
  /**
   * フロントマターの `entity`(書かれていて文字列のとき)。表を読めずに落としたとき、その表の ID の名前空間(entity 名)を
   * 知るのに使う(表全体の信用はしない — 名前だけを読む)。
   */
  readonly entity?: string;
}

/** 1 つの data_table ファイルを読んでパースする。 */
function readDataTableSpec(
  absolute: string,
  rootDir: string,
  repoRoot: string,
  findings: Finding[],
): ReadDataTable {
  const file = toRelative(repoRoot, absolute);
  const reporter = new SpecReporter(file);
  const source = readText(absolute, reporter);
  const data = source === null ? null : parseSafeFrontmatter(source, reporter);
  if (data === null) {
    findings.push(...reporter.findings().map(rebrand));
    return { spec: null, droppedRows: false };
  }

  const result = parseDataTableSpec(data, toRelative(rootDir, absolute), reporter);
  findings.push(...result.findings.map(rebrand));
  const entity = data['entity'];
  return {
    spec: result.value,
    droppedRows: reporter.droppedCount() > 0,
    ...(typeof entity === 'string' && entity !== '' ? { entity } : {}),
  };
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
 * data_table 側のスキーマ違反であることが分かるよう T0 に付け替える。
 */
function rebrand(finding: Finding): Finding {
  return { ...finding, verifier: T0_VERIFIER_ID };
}

/**
 * data_table の置き場が無いときの読み込みの結果(`available: false` の空モデル)。
 *
 * **ファイルを読まない純粋な値**である。ローダー自身の「置き場が無い」の分岐と、製品が採っていない種類の入力(読まない)が
 * 同じ値を作るための 1 本(予約の名前の置き場を読みに行かせる形は、その名前に有効な仕様が置かれると前提が崩れる)。
 */
export function missingDataTableSpecModel(): LoadDataTablesResult {
  return { model: { available: false, tables: [] }, findings: [], dropped: 0 };
}
