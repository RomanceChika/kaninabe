/**
 * 仕組み側の約束事のモデル検査(C24)の CLI。
 *
 * 使い方:
 *   npm run check:formal                 (`--root` の説明は `ROOT_OPTION_HELP`。`lib/io/messages.ts`)
 *   npm run check:formal -- --freshness  (鮮度(1)だけ。TLC も Java も要らず数秒。毎 push の docs ジョブと pre-commit が回す)
 *
 * 見るのは 5 つ。(1) モデルの**鮮度**(`SOURCE:` の sha256 = 写し元と相対 import の**閉包**の hash /
 * `SOURCE-FN:` の sha256 = 関数を定義する最新の migration の本文。実ファイルと突き合わせる)、
 * (2) PlusCal の**翻訳の一致**(翻訳し直して差分 0)、(3) 各性質を **TLC** で回す、
 * (4) 答えを `formal/expectations.json` の宣言と**突き合わせる**、
 * (5) **模型の前提が実装で保たれているか**(予算 + タイムアウト < リース)。
 *
 * 判定そのものは既製品(TLC)が下し、ここが持つのは写像と突合と印字だけである。
 * 道具(Java 21 / tla2tools.jar)が無ければ **error で報告して止まる** —— 黙って緑に
 * しない。終了コードは違反 0 件なら 0、それ以外は 1。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { explainCounterexample } from '../lib/formal/counterexample.js';
import { parseExpectations, verdictFindings } from '../lib/formal/expectations.js';
import type { MigrationFile } from '../lib/formal/migration-function.js';
import { formatFormalFinding, formatFormalSummary } from '../lib/formal/report.js';
import { premiseCheck } from '../lib/formal/premise.js';
import { describeMissing, resolveToolchain } from '../lib/formal/toolchain.js';
import type { Toolchain } from '../lib/formal/toolchain.js';
import { parseTlcOutput } from '../lib/formal/tlc-output.js';
import { translationFindings } from '../lib/formal/translation.js';
import type { FormalFinding, ModelExpectation, PropertyExpectation, TlcResult } from '../lib/formal/types.js';
import { cfgPropertyLineFindings, looksLikeToolFailure, toolFailureFinding } from '../lib/formal/workspace.js';
import { PRODUCT_DECL_FILE } from '../lib/io/paths.js';
import { childEnvOutsideRoot } from '../lib/io/safe-path.js';
import { freshnessOnly, loadMigrations, sourceFindings } from './formal-sources-io.js';
import { selectLayout } from './select-target-values.js';
import type { ProductLayout } from '../lib/model/product/layout.js';
import { repoRootOrExit, withoutRootOption } from './repo-root.js';
import { loadProductRoots } from '../lib/model/product/loader.js';
import type { ProductRoots } from '../lib/model/product/types.js';

/** リポジトリルート(作業ディレクトリから製品の根の宣言を上へ探す。`--root <path>` で上書き)。 */
const REPO_ROOT = repoRootOrExit('check:formal', process.argv.slice(2));
const FORMAL_DIR = path.join(REPO_ROOT, 'formal');
/** 鮮度だけを見る指定(TLC を起動しない)。 */
const FRESHNESS_OPTION = '--freshness';
const COLOR = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;

/** TLC 1 回の上限(秒)。超えたら答えが出ていないので error で報告する。 */
const TLC_TIMEOUT_SECONDS = Number.parseInt(process.env['FORMAL_TLC_TIMEOUT'] ?? '120', 10);

/** ファイルを読む(読めなければ null)。 */
function readText(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}

/** Java を 1 回回し、標準出力と標準エラーを 1 本にした行と終了コードを返す。 */
function runJava(
  tool: Toolchain,
  args: readonly string[],
  cwd: string,
  timeoutSeconds?: number,
): { lines: string[]; code: number; timedOut: boolean } {
  // **JVM の言い分を英語に固定する。** 既定では OS の言語で出るので、道具の故障を
  // 字面で見分ける側(`looksLikeToolFailure`)が環境によって当たったり外れたりする
  // (実測: 日本語環境では「メイン・クラスを検出およびロードできませんでした」と出て、
  // 英語の目印に当たらず「PlusCal の括弧を確かめろ」という嘘の診断になった)。
  // java は候補が全滅すると PATH の `java` に落ちる(toolchain.ts)。`npm run` が足す `node_modules/.bin` の同名の bin を拾わないよう、PATH を濾す(10 回目 C10-4)。
  const result = spawnSync(tool.java, ['-Duser.language=en', '-Duser.country=US', '-XX:+UseParallelGC', '-cp', tool.jar, ...args], {
    cwd,
    env: childEnvOutsideRoot(process.env, REPO_ROOT),
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    ...(timeoutSeconds === undefined ? {} : { timeout: timeoutSeconds * 1000 }),
  });
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  // 打ち切りの見分け。spawnSync は `error.code = 'ETIMEDOUT'` を立てるが、環境によっては
  // シグナルだけ(SIGTERM)や、シェル経由の終了コード 143 として帰ってくる —— 3 つとも見る。
  // 見分けを外すと「TLC が終了コード 143 で落ちました」という、直す先の読めない文面になる。
  const timedOut =
    (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' ||
    result.signal === 'SIGTERM' ||
    result.status === 143;
  return {
    lines: text.split('\n').map((line) => line.trimEnd()),
    code: result.status ?? 1,
    timedOut: timeoutSeconds !== undefined && timedOut,
  };
}

/** モデル 1 本ぶんの作業場(`.old` や trace の書き出しでリポジトリを汚さない)。 */
function workspaceFor(model: string, tla: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `formal-${model}-`));
  fs.writeFileSync(path.join(dir, `${model}.tla`), tla);
  return dir;
}

/** 性質 1 つを TLC で回す。 */
function runProperty(
  tool: Toolchain,
  model: string,
  property: PropertyExpectation,
  dir: string,
  baseCfg: string,
): { result: TlcResult; ms: number } {
  const cfgName = `run_${property.id}.cfg`;
  // **掴む順の検査(DEADLOCK)だけは性質の行を足さない。** `CHECK_DEADLOCK TRUE` で回し、
  // 「ここから先へ進めない状態」を反例にする(待ちの循環はそこにしか現れない)。
  const cfg =
    property.check === 'DEADLOCK'
      ? `${baseCfg.replace(/CHECK_DEADLOCK\s+FALSE/g, 'CHECK_DEADLOCK TRUE')}\n`
      : `${baseCfg}\n${property.check} ${property.id}\n`;
  fs.writeFileSync(path.join(dir, cfgName), cfg);
  const startedAt = Date.now();
  const run = runJava(
    tool,
    ['tlc2.TLC', '-workers', '1', '-noTE', '-metadir', `states_${property.id}`, '-config', cfgName, `${model}.tla`],
    dir,
    TLC_TIMEOUT_SECONDS,
  );
  const ms = Date.now() - startedAt;
  if (run.timedOut) return { result: { kind: 'timeout', seconds: TLC_TIMEOUT_SECONDS }, ms };
  if (looksLikeToolFailure(run.lines)) {
    return { result: { kind: 'error', reason: '道具が動きませんでした', output: run.lines }, ms };
  }
  return { result: parseTlcOutput(run.lines, run.code), ms };
}

/** 答えの一言(進捗行に出す)。 */
function verdictNote(property: PropertyExpectation, result: TlcResult, ms: number): string {
  const seconds = (ms / 1000).toFixed(1);
  if (result.kind === 'holds') return `holds ${seconds}s / 状態 ${result.distinct} / 深さ ${result.depth}`;
  if (result.kind === 'violated') {
    const expected = property.verdict === 'violated' ? '宣言どおり' : '宣言と食い違う';
    return `violated(${expected}) ${seconds}s / 反例 ${result.trace.length} 状態`;
  }
  if (result.kind === 'timeout') return `打ち切り(${result.seconds}s)`;
  return `答えなし ${seconds}s`;
}

/** モデル 1 本を 1 つの定数の組で検査する。 */
function checkModel(
  tool: Toolchain,
  expectation: ModelExpectation,
  migrations: readonly MigrationFile[],
  roots: ProductRoots,
  layout: ProductLayout,
): { findings: FormalFinding[]; checked: number } {
  const { model, cfg } = expectation;
  const tla = readText(path.join(FORMAL_DIR, `${model}.tla`));
  const cfgText = readText(path.join(FORMAL_DIR, cfg));
  if (tla === null || cfgText === null) {
    const missing = tla === null ? `${model}.tla` : cfg;
    return {
      findings: [
        {
          severity: 'error',
          message: `${model}: モデルの ${missing} がありません`,
          location: `formal/${missing}`,
          suggestion: 'expectations.json の model / cfg と formal/ のファイル名を揃える',
        },
      ],
      checked: 0,
    };
  }

  const findings: FormalFinding[] = [
    ...sourceFindings(REPO_ROOT, model, tla, migrations, roots, layout),
    ...cfgPropertyLineFindings(cfg, cfgText),
  ];

  const dir = workspaceFor(model, tla);
  const translation = runJava(tool, ['pcal.trans', '-nocfg', '-unixEOL', `${model}.tla`], dir);
  const translated = translation.code === 0 ? readText(path.join(dir, `${model}.tla`)) : null;
  if (translated === null) {
    findings.push(
      looksLikeToolFailure(translation.lines)
        ? toolFailureFinding('pcal.trans', tool.jar, translation.lines)
        : {
            severity: 'error',
            message: `${model}: pcal.trans が PlusCal を翻訳できませんでした`,
            location: `formal/${model}.tla`,
            suggestion: 'PlusCal の本文の括弧とラベルを確かめる(pcal.trans の言い分は下に出す)',
            detail: translation.lines.filter((line) => line.trim() !== '').slice(0, 8),
          },
    );
    fs.rmSync(dir, { recursive: true, force: true });
    return { findings, checked: 0 };
  }
  findings.push(...translationFindings(model, tla, translated));

  let checked = 0;
  for (const property of expectation.properties) {
    const { result, ms } = runProperty(tool, model, property, dir, cfgText);
    checked += 1;
    console.log(`  ${model} [${cfg}] / ${property.id} ${verdictNote(property, result, ms)}`);
    const trace = result.kind === 'violated' ? explainCounterexample(property, result.trace) : [];
    if (result.kind === 'violated' && property.verdict === 'violated') {
      for (const line of trace) console.log(`      ${line}`);
    }
    findings.push(...verdictFindings(`${model} / ${cfg}`, property, result, trace));
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { findings, checked };
}

/** `formal/` にあるのに 1 度も回されないモデル・定数の組を拾う(黙って検査から漏れないように)。 */
function unusedFiles(declared: readonly ModelExpectation[]): FormalFinding[] {
  if (!fs.existsSync(FORMAL_DIR)) return [];
  const models = new Set(declared.map((entry) => entry.model));
  const cfgs = new Set(declared.map((entry) => entry.cfg));
  return fs
    .readdirSync(FORMAL_DIR)
    .filter((file) => file.endsWith('.tla') || file.endsWith('.cfg'))
    .filter((file) => (file.endsWith('.tla') ? !models.has(file.slice(0, -4)) : !cfgs.has(file)))
    .map((file) => ({
      severity: 'error' as const,
      message: `${file}: formal/ にあるのに expectations.json から 1 度も回されません`,
      location: `formal/${file}`,
      suggestion: 'expectations.json に models の 1 要素(model / cfg / premise / properties)を足すか、ファイルを消す',
    }));
}

/** `--freshness`(鮮度だけ)の指定か。他の綴りは黙って無視せず止める(打ち間違いで TLC が回り出さないため)。 */
function freshnessRequested(): boolean | null {
  const rest = withoutRootOption(process.argv.slice(2));
  if (rest.length === 0) return false;
  if (rest.length === 1 && rest[0] === FRESHNESS_OPTION) return true;
  console.error(`check:formal: 知らない引数です(${rest.join(' ')})。使えるのは ${FRESHNESS_OPTION} と --root だけです`);
  return null;
}

function main(): number {
  const freshness = freshnessRequested();
  if (freshness === null) return 1;
  // migration の置き場は製品が宣言する(写し元の解決に使う)。
  const roots = loadProductRoots(REPO_ROOT).model.roots;
  if (roots === null) {
    console.error(`check:formal: 製品の根の宣言(${PRODUCT_DECL_FILE})を読めません`);
    return 1;
  }
  // 前提の値の居場所(起動口)は置き場の配置から引く(値を選ぶのは組み立ての根 = この CLI)。
  const layout = selectLayout('check:formal', roots);
  // 鮮度だけ。**道具(Java / TLC)を探しにいかない**(ここより前で返す)。
  if (freshness) return freshnessOnly(REPO_ROOT, roots, layout, COLOR);
  const home = os.homedir();
  const resolved = resolveToolchain({ env: process.env, home, exists: (file) => fs.existsSync(file) });
  if ('what' in resolved) {
    for (const line of describeMissing(resolved)) console.error(line);
    return 1;
  }
  const tool: Toolchain = resolved;
  const probe = spawnSync(tool.java, ['-version'], { encoding: 'utf-8', env: childEnvOutsideRoot(process.env, REPO_ROOT) });
  if (probe.error !== undefined || (probe.status ?? 1) !== 0) {
    for (const line of describeMissing({ what: 'java', looked: [tool.java] })) console.error(line);
    return 1;
  }

  const raw = readText(path.join(FORMAL_DIR, 'expectations.json'));
  if (raw === null) {
    console.error('check:formal: formal/expectations.json がありません(性質ごとの宣言が正典です)');
    return 1;
  }
  let parsedJson: unknown = null;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    console.error(`check:formal: formal/expectations.json を読めません(${String(error)})`);
    return 1;
  }

  const expectations = parseExpectations(parsedJson);
  const findings: FormalFinding[] = expectations.problems.map((problem) => ({
    severity: 'error' as const,
    message: problem,
    location: 'formal/expectations.json',
    suggestion: '定数の組ごとに model / cfg / premise を書き、性質ごとに id / check / intent / verdict を揃える',
  }));
  findings.push(...unusedFiles(expectations.models));

  const migrations = loadMigrations(REPO_ROOT, roots);
  const premise = premiseCheck(REPO_ROOT, (file) => readText(path.join(REPO_ROOT, file)), roots, layout, migrations);
  for (const note of premise.notes) console.log(note);
  findings.push(...premise.findings);
  let checked = 0;
  for (const expectation of expectations.models) {
    const outcome = checkModel(tool, expectation, migrations, roots, layout);
    findings.push(...outcome.findings);
    checked += outcome.checked;
  }

  console.log('');
  for (const finding of findings) console.log(formatFormalFinding(finding, { color: COLOR }));
  console.log(formatFormalSummary(findings, checked, { color: COLOR }));
  return findings.some((finding) => finding.severity === 'error') ? 1 : 0;
}

process.exit(main());
