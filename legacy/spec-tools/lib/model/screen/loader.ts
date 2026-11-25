/**
 * specs/frontend を走査して ScreenSpecModel を構築するローダー。
 *
 * ファイル I/O を行うのはこのモジュール(と CLI)だけであり、YAML → モデルの変換は
 * parse-screen / parse-chrome の純粋関数に委ねる(規約: scripts-code-quality.md)。
 * 構築時に検出できるのは S0(スキーマ適合)だけで、S1〜S12 は検証器がモデルに対して行う。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding } from '../../kernel/finding.js';
import { SpecReporter } from '../parse-common.js';
import { parseSafeFrontmatter } from '../safe-frontmatter.js';
import { detectRepoRoot, isDirectory, toRelative, walkFiles } from '../../io/paths.js';
import type { ChromeSpec, ScreenSpec, ScreenSpecModel } from './types.js';
import { parseScreenSpec } from './parse-screen.js';
import { parseChromeSpec } from './parse-chrome.js';
import { expandChromeNavigations } from './expand-chrome.js';
import { readGuideDecls } from './guide-decls-loader.js';
import type { ProductLayout } from '../product/layout.js';
import type { ProductRoots } from '../product/types.js';

/** ローダーが積む Finding の検証器 ID。ローダーが担うのは S0(スキーマ適合)のみ。 */
export const S0_VERIFIER_ID = 'S0';

/** ディレクトリガイド。仕様ではないので読み飛ばす(免除宣言だけをここから読む)。 */
const GUIDE_FILE = 'README.md';

/** 画面仕様の置き場(specs/frontend からの相対)。 */
const SCREENS_DIR = 'screens';

/** 共有クロームの置き場(specs/frontend からの相対)。 */
const CHROME_DIR = 'chrome';

/** ローダーの任意設定。 */
export interface LoadScreensOptions {
  /**
   * Finding の location.file をこのディレクトリからの相対パスにする。
   * 省略時は rootDir から上に製品の根の宣言(product.md)を探し、見つからなければ rootDir の親を使う。
   */
  readonly repoRoot?: string;
  /** 製品が宣言した根(E2E スモークの置き場の判定に使う)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(E2E スモークの置き場 = 役割 `e2e-root`)。 */
  readonly layout: ProductLayout;
}

/** loadScreenSpecModel の結果。 */
export interface LoadScreensResult {
  /** 構築したモデル。screens ディレクトリが無い場合は `available: false` の空モデル。 */
  readonly model: ScreenSpecModel;
  /** 構築中に検出した S0 違反。空とは限らない。 */
  readonly findings: Finding[];
  /**
   * モデルへ入れずに捨てた仕様・宣言の数(読めなかった画面・クロームのファイル・読めなかった README の免除宣言)。
   * 0 なら、S0 の違反が残っていてもモデルは欠けていない(id の不一致・表示名の重複のように、読めた上での違反)。
   */
  readonly dropped: number;
}

/**
 * specs/frontend 配下を走査して画面仕様のモデルを構築する。
 *
 * `screens/{group}/{name}.md` を screen_spec、`chrome/{name}.md` を chrome_spec として読み、
 * README.md と `template.{doc_type}.md` は読み飛ばす。
 *
 * `screens/` が無い場合は「画面をまだ仕様化していない」を意味する正常な状態として
 * `available: false` の空モデルを返す(ディレクトリはあるが 0 件の場合とは区別する)。
 *
 * @param rootDir specs/frontend の絶対パス
 * @param options 相対パス基準などの任意設定
 * @returns モデルと S0 違反のリスト
 */
export function loadScreenSpecModel(rootDir: string, options: LoadScreensOptions): LoadScreensResult {
  const screensRoot = join(rootDir, SCREENS_DIR);
  if (!isDirectory(screensRoot)) return missingScreenSpecModel();

  const repoRoot = options.repoRoot ?? detectRepoRoot(rootDir);
  const { roots, layout } = options;
  const findings: Finding[] = [];
  const screens: ScreenSpec[] = [];
  let dropped = 0;
  for (const absolute of walkFiles(screensRoot, isSpecFile)) {
    const spec = read(absolute, screensRoot, repoRoot, findings, (data, file, relPath) =>
      parseScreenSpec(data, file, relPath, roots, layout),
    );
    if (spec === null) dropped += 1;
    else screens.push(spec);
  }

  const chromeRoot = join(rootDir, CHROME_DIR);
  const chromes: ChromeSpec[] = [];
  for (const absolute of walkFiles(chromeRoot, isSpecFile)) {
    const spec = read(absolute, chromeRoot, repoRoot, findings, parseChromeSpec);
    if (spec === null) dropped += 1;
    else chromes.push(spec);
  }

  checkLabelUniqueness([...screens, ...chromes], findings);

  // README の免除宣言(unexposed / unreachable_states / unseen_states)の読み違いは、免除を落とす(綴り違いのキーも宣言なしに見える)。
  const declFindings = findings.length;
  const guideDecls = readGuideDecls(screensRoot, repoRoot, findings, S0_VERIFIER_ID);
  dropped += findings.length - declFindings;

  // 共有クロームの遷移は、この時点で継承画面へ展開する。以降の検査・生成は
  // 「画面が自分で宣言した遷移」と区別せずに扱えばよくなる(lib/model/screen/expand-chrome.ts)。
  return {
    model: {
      available: true,
      screens: expandChromeNavigations(screens, chromes),
      chromes,
      ...guideDecls,
    },
    findings,
    dropped,
  };
}

/** 表示名の一意性検査が見る最小限の形(screen_spec / chrome_spec の共通部分)。 */
interface LabelledSpec {
  readonly name: string;
  readonly label?: string;
  readonly location: { readonly file: string };
}

/**
 * 画面・共有クロームの表示名(トップレベル `label`)が全体で一意かを見る。
 *
 * この label はハンドブックの画面一覧・カードの見出し・遷移図の節点に出る。2 枚の画面が
 * 同じ表示名を宣言すると、図の節点も一覧の行も別物として読めなくなる(内部名は違うのに
 * 読み手には同じ名前に見える)。画面とクロームを同じ名前空間で見るのは、章の中で
 * 同じ見出しの列に並ぶためである。1 ファイルの中では分からない食い違いなので、
 * 全ファイルを読み終えたここで見る。
 *
 * @param specs 読み込み済みの screen_spec と chrome_spec(同じ名前空間で見る)
 * @param findings 違反の記録先(重複 1 件につき S0 を 1 つ積む)
 */
export function checkLabelUniqueness(
  specs: readonly LabelledSpec[],
  findings: Finding[],
): void {
  const seen = new Map<string, string>();
  for (const spec of specs) {
    if (spec.label === undefined) continue;
    const first = seen.get(spec.label);
    if (first === undefined) {
      seen.set(spec.label, spec.name);
      continue;
    }
    findings.push({
      verifier: S0_VERIFIER_ID,
      severity: 'error',
      message: `label "${spec.label}" が ${first} と ${spec.name} で重複しています`,
      location: { file: spec.location.file, pointer: 'label' },
      suggestion: '画面の表示名は全画面・全クローム間で一意にする(一覧の行も遷移図の節点も区別が付かなくなる)',
      counterexample: { label: spec.label, screens: `${first}, ${spec.name}` },
    });
  }
}

/** 仕様として読む対象か。README と template は仕様ではない。 */
function isSpecFile(name: string): boolean {
  if (!name.endsWith('.md')) return false;
  if (name === GUIDE_FILE) return false;
  return !/^template\..+\.md$/.test(name);
}

/** 1 つの仕様ファイルを読んでパースする(screen / chrome で共通)。 */
function read<T>(
  absolute: string,
  rootDir: string,
  repoRoot: string,
  findings: Finding[],
  parse: (data: unknown, file: string, relPath: string) => { value: T | null; findings: readonly Finding[] },
): T | null {
  const file = toRelative(repoRoot, absolute);
  const reporter = new SpecReporter(file);
  const source = readText(absolute, reporter);
  const data = source === null ? null : parseSafeFrontmatter(source, reporter);
  findings.push(...reporter.findings().map(rebrand));
  if (data === null) return null;

  const result = parse(data, file, toRelative(rootDir, absolute));
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
 * 画面仕様側のスキーマ違反であることが分かるよう S0 に付け替える。
 */
function rebrand(finding: Finding): Finding {
  return { ...finding, verifier: S0_VERIFIER_ID };
}

/**
 * screen_spec の置き場が無いときの読み込みの結果(`available: false` の空モデル。ディレクトリはあるが 0 件の場合とは区別する)。
 *
 * **ファイルを読まない純粋な値**である。ローダー自身の「置き場が無い」の分岐と、製品が採っていない種類の入力(読まない)が
 * 同じ値を作るための 1 本(予約の名前の置き場を読みに行かせる形は、その名前に有効な仕様が置かれると前提が崩れる)。
 */
export function missingScreenSpecModel(): LoadScreensResult {
  return {
    model: {
      available: false,
      screens: [],
      chromes: [],
      unexposed: [],
      unreachableStates: [],
      unseenStates: [],
    },
    findings: [],
    dropped: 0,
  };
}
