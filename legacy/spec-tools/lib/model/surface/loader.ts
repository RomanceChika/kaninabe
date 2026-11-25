/**
 * surface_spec(docs/specs/backend/surface.md)を読む I/O 境界。
 *
 * 1 プロジェクト 1 ファイルなので、ディレクトリ走査ではなくファイル 1 枚を読む
 * (notification_spec / job_spec / config_spec / auth_spec / guarantee_spec と同じ形)。
 * YAML → モデルの変換は parse-surface の純粋関数に委ね、ここは読めない環境で壊れないことだけを
 * 担保する(規約: scripts-code-quality.md)。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Finding } from '../../kernel/finding.js';
import { SpecReporter } from '../parse-common.js';
import { parseSafeFrontmatter } from '../safe-frontmatter.js';
import { detectRepoRoot, isFile, toRelative } from '../../io/paths.js';
import type { SurfaceSpecModel } from './types.js';
import { parseSurfaceSpec } from './parse-surface.js';

/** ローダーが積む Finding の検証器 ID(surface の出どころは T12 が報告する)。 */
export const SURFACE_LOADER_VERIFIER_ID = 'T12';

/** 旧い置き場(`api_spec` の頃のファイル名。同じ並びに残っていたら書き直しを名指す)。 */
const RETIRED_FILE_NAME = 'api.md';

/** ローダーの任意設定。 */
export interface LoadSurfaceOptions {
  /** Finding の location.file をこのディレクトリからの相対パスにする。省略時は製品の根の宣言(product.md)を上に探す。 */
  readonly repoRoot?: string;
}

/** loadSurfaceSpecModel の結果。 */
export interface LoadSurfaceResult {
  /** 構築したモデル。ファイルが無い場合は `available: false` の空モデル。 */
  readonly model: SurfaceSpecModel;
  /** 構築中に検出したスキーマ違反。 */
  readonly findings: Finding[];
  /**
   * 読めずにモデルへ入れなかった行(リストの要素・必須のリスト・文字列として読めなかった宣言)の数。0 なら、`findings` に error が残っていても
   * モデルは欠けていない(未知のキー・id の重複で先の行が残る形は行を落とさない)。ファイルを読めない・壊れているときは 0(モデル自体が無いので別の理由で阻害になる)。
   */
  readonly dropped: number;
}

/**
 * surface_spec を読んでモデルを構築する。
 *
 * ファイルが無い場合は「surface の仕様書をまだ開設していない」を意味する正常な状態として
 * `available: false` の空モデルを返す(他のカタログと同じ扱い)。そのとき**土台だけ**が
 * 生成されなくなる(手書きの migration が持つ構成である)。
 *
 * **ビューの側はこのファイルに依らない。** どの表が surface に出るかは entity_spec と access_spec が
 * 決め、書き出し先は表ごとの `surface_migration` が宣言するので、surface の仕様書が無くても
 * T12 の必須は鳴り、生成器はビューを出す —— 4 題材はその構成で動いている
 * (この仕様書に依るのは土台の書き出し先・手書きで残すビューの宣言・一覧の表の 3 つだけ)。
 *
 * 旧い置き場 `api.md` が同じ並びに残っていれば、書き直し(`surface.md` への移動)を名指して error にする。
 *
 * @param file docs/specs/backend/surface.md の絶対パス
 * @param options 相対パス基準などの任意設定
 * @returns モデルとスキーマ違反のリスト
 */
export function loadSurfaceSpecModel(file: string, options: LoadSurfaceOptions = {}): LoadSurfaceResult {
  const repoRoot = options.repoRoot ?? detectRepoRoot(file);
  const retired = retiredPlacementFindings(file, repoRoot);
  if (!isFile(file)) return { ...missingSurfaceSpecModel(), findings: retired };

  const reporter = new SpecReporter(toRelative(repoRoot, file));
  const source = readText(file, reporter);
  const data = source === null ? null : parseSafeFrontmatter(source, reporter);
  if (data === null) {
    return { model: { available: true, spec: null }, findings: [...retired, ...reporter.findings().map(rebrand)], dropped: 0 };
  }

  const result = parseSurfaceSpec(data, reporter);
  return {
    model: { available: true, spec: result.value },
    findings: [...retired, ...result.findings.map(rebrand)],
    dropped: reporter.droppedCount(),
  };
}

/** 旧い置き場のファイルが残っていれば、書き直し先を名指す error を 1 件返す。 */
function retiredPlacementFindings(file: string, repoRoot: string): Finding[] {
  const retired = join(dirname(file), RETIRED_FILE_NAME);
  if (!isFile(retired)) return [];
  const reporter = new SpecReporter(toRelative(repoRoot, retired));
  reporter.error(
    undefined,
    `${RETIRED_FILE_NAME} は surface の仕様書の旧い置き場です(doc_type: api_spec は廃止されました)`,
    `${RETIRED_FILE_NAME} を surface.md に移し、doc_type: surface_spec・id: surface・surface_base_migration に書き直す`,
  );
  return reporter.findings().map(rebrand);
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
 * surface の仕様側のスキーマ違反であることが分かるよう T12 に付け替える。
 */
function rebrand(finding: Finding): Finding {
  return { ...finding, verifier: SURFACE_LOADER_VERIFIER_ID };
}

/**
 * surface の仕様の置き場が無いときの読み込みの結果(`available: false` の空モデル)。
 *
 * **ファイルを読まない純粋な値**である。ローダー自身の「置き場が無い」の分岐と、製品が採っていない種類の入力(読まない)が
 * 同じ値を作るための 1 本(予約の名前の置き場を読みに行かせる形は、その名前に有効な仕様が置かれると前提が崩れる)。
 */
export function missingSurfaceSpecModel(): LoadSurfaceResult {
  return { model: { available: false, spec: null }, findings: [], dropped: 0 };
}
