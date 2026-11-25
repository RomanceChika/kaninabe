/**
 * 実装(app/)を走査して「設定を読んでいる場所」を集める I/O 境界。
 *
 * K1 が突き合わせる相手はソースコードそのものである(J2 が `app/vercel.json` を読むのと同じ
 * 発想で、**設定の正が実装の中にしか無い状態**を仕様の側から閉じる)。検証器はファイル I/O を
 * しないため、読み取りはここで済ませて純粋なデータにして渡す(規約: scripts-code-quality.md)。
 *
 * 拾い方は 2 通りに限る:
 *   1. `process.env.NAME` / `process.env['NAME']`(素の参照)
 *   2. `requireEnv('NAME')`(このリポジトリの「無ければ落とす」ヘルパ。名前が引数に来る)
 * どちらも**名前が文字列リテラルとしてその場にある**形であり、変数越しに読む書き方は
 * 拾えない。拾えない書き方をしないことは **ESLint が要求する**(`@kaninabe/lint-config/policies` の
 * `PROCESS_ENV_SELECTORS`。走査する木と同じ範囲に掛かる。規約(config-spec-writing.md)だけでは
 * 執行者が居ず、`const { X } = process.env;` が K1・K2 をすり抜けた —— 網の穴探し 2026-10-06 の M02)。
 * **ESLint が止める形**: `process.env` の字面があるもの(分割代入・別名・計算した鍵・値として渡す・
 * `requireEnv` に非リテラルを渡す)と、字面を作らないもの(`process` 自体の別名・分割代入・引数・
 * 添字 `process['env']`・`globalThis.process` 経由・`process` の import・`import.meta.env`)。
 * **止まらない下限**: `Reflect.get(globalThis, 'process')` のような静的に決まらない取り出し。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FRAMEWORK_LINT_CONFIG_DIR,
  FRAMEWORK_RUNTIME_DIR,
  isDirectory,
  isFile,
  toRelative,
  walkFiles,
} from '../io/paths.js';
import type { ConfigReadByKind, ConfigTermDecl } from '../model/config/types.js';
import { e2eRootPath, envTemplatePath, scriptRootPath, sourceRootPath } from '../model/product/layout.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';

/**
 * 走査する木(リポジトリルート相対)。
 *
 * 2 種類ある。
 *   - **製品の実装の木**: 並ぶのは役割の名前(ソース・E2E・道具)だけで、木の位置は宣言から・その中の置き場は置き場の配置から来る。
 *     木を持たない製品では 1 本も無い。
 *   - **仕組み側のパッケージ**: W1 / W2 と同じく**根で指す**。列挙していたあいだ、テスト基盤が
 *     `app/tests` から `@kaninabe/runtime/testing/local` へ移った時点で `process.env` の参照 4 件が
 *     母集合から出ていた(束 ①-c-b のレビュー。今日壊れていないのは同じ名前が製品側でも
 *     参照されているからで、K1 が「どこかで読まれている」しか見ないためである)。
 *
 * `'tests'` の行は消した —— 製品にその役割のディレクトリはもう無く、**残しても何も塞がらない**
 * (移った先を見ることが塞ぎである)。
 */
export function envScanRoots(roots: ProductRoots, layout: ProductLayout): readonly string[] {
  // 木の位置は宣言から、その中の置き場(ソースの根・E2E・道具のスクリプト)は置き場の配置の役割から来る。
  const product = [sourceRootPath(layout, roots), e2eRootPath(layout, roots), scriptRootPath(layout, roots)].filter(
    (dir): dir is string => dir !== null,
  );
  return [...product, FRAMEWORK_RUNTIME_DIR, FRAMEWORK_LINT_CONFIG_DIR];
}

/** 設定の雛形(引き継ぎで最初に開かれるファイル)。木を持たない製品では null。 */
export function envTemplateFile(roots: ProductRoots, layout: ProductLayout): string | null {
  return envTemplatePath(layout, roots);
}

/** 走査対象の拡張子。 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** `process.env.NAME` / `process.env['NAME']` / `requireEnv('NAME')` を拾う。 */
export const REFERENCE_PATTERNS = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*['"]([^'"\]]+)['"]\s*\]/g,
  /requireEnv\(\s*['"]([^'")]+)['"]\s*\)/g,
];

/** 環境変数名の形(これに合わないものはノイズとして拾わない)。 */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/** 実装が設定を読んでいる 1 か所。 */
export interface EnvReference {
  /** 環境変数名。 */
  readonly name: string;
  /** 参照しているファイル(リポジトリルート相対)。 */
  readonly file: string;
}

/** 実装側の走査結果。 */
export interface EnvScanResult {
  /** 走査対象のツリーが 1 つでもあったか。false なら K1 は何も見ない。 */
  readonly available: boolean;
  /** 見つかった参照(ファイル名順・重複あり)。 */
  readonly references: readonly EnvReference[];
}

/**
 * 実装ツリーから設定の参照を集める。
 *
 * app/ が無い構成(仕様だけを持つリポジトリ)では `available: false` を返し、
 * 呼び出し側が K1 のスキップを判断する。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param productRoots 製品が宣言した根(走査する木の位置)
 * @param layout 置き場の配置(ソースの根・E2E・道具のスクリプトの置き場)
 * @returns 参照の一覧
 */
export function scanEnvReferences(repoRoot: string, productRoots: ProductRoots, layout: ProductLayout): EnvScanResult {
  const roots = envScanRoots(productRoots, layout)
    .map((relative) => join(repoRoot, relative))
    .filter(isDirectory);
  if (roots.length === 0) return { available: false, references: [] };

  const references: EnvReference[] = [];
  for (const root of roots) {
    for (const absolute of walkFiles(root, isSourceFile)) {
      const file = toRelative(repoRoot, absolute);
      for (const name of extractEnvNames(readText(absolute))) {
        references.push({ name, file });
      }
    }
  }
  return { available: true, references };
}

/** GitHub Actions の workflow が secret を読む形(`secrets.NAME`)。 */
const WORKFLOW_SECRET_PATTERN = /secrets\.([A-Z][A-Z0-9_]*)/g;

/** workflow の拡張子。 */
const WORKFLOW_EXTENSIONS = ['.yml', '.yaml'];

/** 置き場の読み口が設定を読んでいる 1 か所。 */
export interface TargetReference {
  /** 環境変数名。 */
  readonly name: string;
  /** 参照しているファイル(リポジトリルート相対)。 */
  readonly file: string;
  /** どの置き場の読み口か(`vocabulary.target` の語)。 */
  readonly target: string;
}

/** 置き場の読み口の走査結果。 */
export interface TargetScanResult {
  /** 読み口を走査できた置き場(`read_by` を宣言し、その場所が実在したもの)。 */
  readonly scanned: readonly string[];
  /** 見つかった参照。 */
  readonly references: readonly TargetReference[];
}

/**
 * 置き場の `read_by` が指す場所を走査して「その置き場の名前を読んでいる場所」を集める。
 *
 * どこを・どう読むかは**カタログの宣言**(`vocabulary.target[].read_by`)であり、ここは
 * `kind` の値域ごとの読み方だけを持つ(パスも置き場の名前も体系側に無い)。K1 は
 * 「誰も読まない宣言」の判定にこの結果を足し、K3 は置き場の宣言との双方向を見る。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param targets カタログが宣言した置き場の語(`vocabulary.target`)
 * @returns 走査できた置き場と、見つかった参照
 */
export function scanTargetReaders(repoRoot: string, targets: readonly ConfigTermDecl[]): TargetScanResult {
  const scanned: string[] = [];
  const references: TargetReference[] = [];
  for (const term of targets) {
    const readBy = term.readBy;
    if (readBy === undefined) continue;
    const root = join(repoRoot, readBy.path);
    if (!isDirectory(root)) continue;
    scanned.push(term.id);
    const how = readerFor(readBy.kind);
    for (const absolute of walkFiles(root, how.accepts)) {
      const file = toRelative(repoRoot, absolute);
      for (const name of extractNames(readText(absolute), [how.pattern])) {
        references.push({ name, file, target: term.id });
      }
    }
  }
  return { scanned, references };
}

/** `read_by.kind` ごとの読み方(どのファイルを見て、どの形で名前が現れるか)。 */
function readerFor(kind: ConfigReadByKind): {
  readonly pattern: RegExp;
  readonly accepts: (name: string) => boolean;
} {
  switch (kind) {
    case 'workflow_secret':
      return {
        pattern: WORKFLOW_SECRET_PATTERN,
        accepts: (name) => WORKFLOW_EXTENSIONS.some((extension) => name.endsWith(extension)),
      };
  }
}

/**
 * 設定の雛形(実装の木の直下の `.env.example`)に行を持つ変数名を読む。
 *
 * 見るのは `NAME=` の形の行だけで、値は読まない(値は運用のものであり仕様の関心ではない)。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param productRoots 製品が宣言した根(雛形の位置)
 * @param layout 置き場の配置(設定の雛形の置き場)
 * @returns 雛形に現れる変数名。雛形が無ければ null(K2 は何も見ない)
 */
export function readEnvTemplate(repoRoot: string, productRoots: ProductRoots, layout: ProductLayout): readonly string[] | null {
  const relative = envTemplateFile(productRoots, layout);
  if (relative === null) return null;
  const absolute = join(repoRoot, relative);
  if (!isFile(absolute)) return null;
  const names: string[] = [];
  for (const line of readText(absolute).split('\n')) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (match?.[1] !== undefined && !names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/**
 * ソース 1 本から環境変数名を抜き出す(重複は 1 つにまとめる)。
 *
 * @param source ファイルの内容
 * @returns 出現順の変数名
 */
export function extractEnvNames(source: string): readonly string[] {
  return extractNames(source, REFERENCE_PATTERNS);
}

/**
 * ソース 1 本から、与えた形に一致する環境変数名を抜き出す(重複は 1 つにまとめる)。
 *
 * @param source ファイルの内容
 * @param patterns 1 つ目のキャプチャに名前が来る正規表現(`g` フラグ付き)
 * @returns 出現順の変数名
 */
function extractNames(source: string, patterns: readonly RegExp[]): readonly string[] {
  const names: string[] = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (name === undefined || !ENV_NAME.test(name) || names.includes(name)) continue;
      names.push(name);
    }
  }
  return names;
}

/** 走査対象のソースファイルか(型定義ファイルは実行されないので見ない)。 */
export function isSourceFile(name: string): boolean {
  if (name.endsWith('.d.ts')) return false;
  return SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/** ファイルを読む。読めなければ空文字(走査は best-effort であり、ここで検証を止めない)。 */
export function readText(absolute: string): string {
  try {
    return readFileSync(absolute, 'utf8');
  } catch {
    return '';
  }
}
