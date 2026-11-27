/**
 * 仕様の意味検証 CLI。
 *
 * 使い方: npm run verify [-- [<ドメイン仕様の木へのパス>] [--root <path>] [--implemented-base <product.md>] [--list-out-of-scope]]
 *   - 既定の対象は、製品の根の宣言(product.md)が指す仕様の木の `domain`(トレース検証・文書整合検証は
 *     同じ宣言から決まる)。根は呼ばれた場所(`INIT_CWD`、無ければ作業ディレクトリ)から上へ product.md を探して決め、`--root` で上書きできる
 *   - パスを渡したときはそれが対象になる(相対パスは呼ばれた場所から解く。根はそのパスから上へ探す。`--root` は使わない)
 *   - `--root` の説明は `ROOT_OPTION_HELP`(`lib/io/messages.ts`)
 *   - `--implemented-base <product.md>`: 基準の `product.md`。実装の範囲(`implemented`)が広がる向きにしか動かないこと(P14)を見る。値は位置引数に混ざらない
 *   - `--list-out-of-scope`: 実装の範囲の外にある仕様の名前を、要約の行に続けて出す(手元用。公開される場所の log には付けない)
 *   - 終了コード: エラー 0 件なら 0、1 件以上なら 1(警告のみなら 0)
 *   - `--fail-on-unclassified`: 未分類の警告が 1 件でもあれば 1(拡張候補に当たる警告は 0 のまま)。
 *     **出荷の経路(CI の docs ジョブ・pre-commit)に付ける門**で、判定は `lib/verify/exit-code.ts`
 *
 * **この CLI が持つのは引数の解釈と出力の整形だけ**である。どの仕様種を読み、どの群を
 * どの順で実行するかは lib/compose/verify-pipeline.ts が持つ(検査が増えてもここは変わらない)。
 */

import path from 'node:path';
import process from 'node:process';
import { formatFinding, formatSkipSummary, formatSummary } from '../lib/verify/report.js';
import { decideExit, failOnUnclassifiedRequested } from '../lib/verify/exit-code.js';
import { frameworkHostRoot } from '../lib/io/framework-paths.js';
import { runAllVerifications } from '../lib/compose/verify-pipeline.js';
import { verifyInputsOf } from '../lib/target-api/contract.js';
import { selectPlatformTargets } from './select-platform.js';
import { shutdownZ3 } from '../lib/guard/z3.js';
import { exitCodeAfterShutdown } from '../lib/guard/z3-finish.js';
import { describeFreshness } from '../lib/deps/report.js';
import { LATEST_FILE } from '../lib/deps/types.js';
import { readScratchText } from '../lib/io/scratch.js';
import { loadProductRoots } from '../lib/model/product/loader.js';
import { specPath } from '../lib/model/product/paths.js';
import { detectRepoRoot, PRODUCT_DECL_FILE } from '../lib/io/paths.js';
import { formatScopeSummary } from '../lib/scope/summary.js';
import { invocationDir, repoRootOrExit, withoutRootOption } from './repo-root.js';
import { implementedBaseOption, listOutOfScopeRequested, resolveBaseFile, withoutImplementedBase } from './scope-options.js';

/**
 * 製品の宣言が指す仕様の木の `domain`(既定の対象)。宣言を読めなければ文言を出して止まる。
 *
 * @param repoRoot 製品の根の絶対パス
 * @returns ドメイン仕様の木の絶対パス
 */
function declaredDomainRoot(repoRoot: string): string {
  const loaded = loadProductRoots(repoRoot);
  const roots = loaded.model.roots;
  if (roots === null) {
    console.error(`verify: 製品の根の宣言(${PRODUCT_DECL_FILE})を読めないため検証できません:`);
    for (const finding of loaded.findings) console.error(formatFinding(finding, { color: false }));
    process.exit(1);
  }
  return path.join(repoRoot, specPath(roots, 'domain'));
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const base = implementedBaseOption(argv);
  if (base.kind === 'missing') {
    console.error('verify: --implemented-base には基準の product.md のパスを続けて書いてください。');
    return 1;
  }
  const argPath = withoutImplementedBase(withoutRootOption(argv)).find((arg) => !arg.startsWith('--'));
  const domainRoot = argPath ? path.resolve(invocationDir(), argPath) : declaredDomainRoot(repoRootOrExit('verify', argv));
  const color = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;
  const opts = { color };
  // 後段の選択の契約は製品の宣言(実装の木の有無・生成物の置き場)を読む。宣言を読めなければ、パイプラインの P 群がそれを指して止まる
  // (そのときの選択は実装の木なしとして扱う。検証はそこで打ち切られる)。
  const roots = loadProductRoots(detectRepoRoot(domainRoot)).model.roots ?? { app: null, generated: '' };

  const { findings, modelBuilt, skipNotes, extensionLedger, scopeReport } = await runAllVerifications({
    domainRoot,
    // 仕組み自身の保証台帳と見張りテストの根(Z3)。製品の宣言からは来ない —— 検査器の位置から引き、必ず渡す(省くと Z3 は未実施になる)。
    frameworkRoot: frameworkHostRoot(),
    // 後段(プラットフォームの設定と、後段が登録する検査)を選ぶのは組み立ての根であるこの CLI だけ(検証のパイプラインは選ばない)。
    ...verifyInputsOf(selectPlatformTargets('verify', roots)),
    ...(base.kind === 'value' ? { implementedBase: resolveBaseFile(base.value, invocationDir()) } : {}),
    log: (line) => console.log(line),
  });

  // 警告は「拡張候補(仕組みの宿題)」と「未分類」に分けて出す(台帳: legacy/spec-tools/extension-candidates.md)。
  for (const finding of findings) console.log(formatFinding(finding, opts, extensionLedger.ledger));
  console.log(formatSummary(findings, opts, extensionLedger.ledger));
  // 検査の範囲が縮んだ実行を、最後の 1 行だけ読む運用にも伝える(検査の漏れ探し 2026-09-12 §3)。
  if (skipNotes.length > 0) console.log(formatSkipSummary(skipNotes, opts));
  // 実装の範囲を宣言した製品だけ、求めなかった突合の要約を 1 行で言う(指摘ではない。既定は種類と件数だけ)。
  if (scopeReport !== null) console.log(formatScopeSummary(scopeReport, { listNames: listOutOfScopeRequested(argv) }));
  // 依存の脆弱性の検査(`npm run deps:check`)の最終実施を範囲サマリに足す。7 日超・記録なしは警告の言い方だが、
  // 検証の指摘(Finding)ではないので未分類の門(--fail-on-unclassified)には掛からない(回し忘れを言うだけで、出荷は止めない)。
  const freshness = describeFreshness(readScratchText(detectRepoRoot(domainRoot), LATEST_FILE), new Date());
  console.log(freshness.stale ? `⚠ ${freshness.line}` : freshness.line);
  if (!modelBuilt) {
    console.error('モデルを構築できなかったため、V2 以降の検証は実行していません。');
    return 1;
  }
  const decision = decideExit(findings, extensionLedger.ledger, failOnUnclassifiedRequested(argv));
  if (decision.gateNote !== null) console.error(`verify: ${decision.gateNote}`);
  return decision.code;
}

const exitCode = await main();
// Z3 のワーカースレッドを畳む(残すとプロセスが終われない)。出力を済ませた後で行い、失敗は 1 行にして終了コードを 1 にする。
process.exit(await exitCodeAfterShutdown(exitCode, shutdownZ3, (line) => console.error(line), 'verify'));
