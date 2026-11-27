/**
 * ビルドの入口の関所のうち、**実ルートの突合(S7)と HTTP の入口の閉世界(J2)**を回す CLI(点検 13 回目 B13-1 の仕上げ・15 回目 C15-3)。どちらも verify と同じ本体を呼ぶ(関所だけ別の規則にしない)。
 *
 * 本番の `next build` は宣言していない並列・割り込みの画面も、宣言していない `route.ts`・メタデータのルート(`opengraph-image.ts`・`sitemap.ts` など)・`public/` の文書も止めない。
 * `vercel.json` の `rewrites`・`vercel.json` と `next.config.ts` の不在・`src/instrumentation.ts`・`src/middleware.ts`・`global-not-found.tsx` も止めない(点検 16 回目 C16-3。
 * どれも verify の J2 / S7 と同じ本体で閉じる: ホストの J2 は `verifyHostJ2`、ほかは入口の閉世界と画面の器の分類)。CI と pre-commit を通らない道(手元のデプロイなど)でも止まるように、製品のビルドの入口
 * (`app/scripts/build-gate.mts`)がこれを呼ぶ。全部の検査(`verify`)はビルドで回さない: 速さのためと、検査器の依存(z3 など)を製品の install に持ち込まないため。
 *
 * **`tsx` を使わず `node --import ./cli/ts-js-resolve.mjs` で動く**(`spec-tools` の依存はビルドの環境に無い)。外の依存は `js-yaml` と `typescript`(`route.ts` と `next.config` の構文木)で、どちらも製品の `devDependencies` が持つ。
 *
 * **ここは閉じる側に倒す**: 通常の verify は「実装の木が無い」「配置が決まらない」「画面の仕様が読めない」で S7 を飛ばしたり指摘に回したりするが、ビルドの入口に来た時点で
 * 実装の木はあるはずなので、飛ばす形は全部赤にする(緑の意味を実際に確かめた範囲より広く見せない)。
 *
 * 使い方: node --import <ts-js-resolve.mjs> cli/build-gate-routes.ts --root <製品の根>。終了コード: 突合が緑なら 0、それ以外は 1。
 */

import path from 'node:path';
import process from 'node:process';
import type { Finding } from '../lib/kernel/finding.js';
import { verifyEntryClosedWorld } from '../lib/job/verifiers/j2-entry-closed.js';
import { catalogInput } from '../lib/kernel/input-state.js';
import { loadAuthSpecModel } from '../lib/model/auth/loader.js';
import { loadExternalSpecModel } from '../lib/model/external/loader.js';
import { loadJobSpecModel } from '../lib/model/job/loader.js';
import { loadProductRoots } from '../lib/model/product/loader.js';
import { layoutModule, sourceRootPath } from '../lib/model/product/layout.js';
import { specPath } from '../lib/model/product/paths.js';
import { selectionOf } from '../lib/model/product/uses.js';
import { loadScreenSpecModel } from '../lib/model/screen/loader.js';
import { gateOrderProblem, loadAppRoutes } from '../lib/screen/app-loader.js';
import { implementationRouteFindings } from '../lib/screen/verifiers/s7-implementation-routes.js';
import { scopeOwners } from '../lib/scope/owners.js';
import { partitionByScope } from '../lib/scope/partition.js';
import { requiredGuardsOf } from '../lib/semantics/required-guards.js';
import { NEXTJS_LAYOUT } from '../lib/targets/nextjs/layout.js';
import { verifyHostJ2 } from '../lib/targets/vercel/job/j2-host.js';
import { repoRootOrExit } from './repo-root.js';

/** 文言の先頭。 */
const NAME = 'build-gate(S7)';

/** 赤の理由を出して終える。 */
function stop(lines: readonly string[]): never {
  for (const line of lines) console.error(`${NAME}: ${line}`);
  process.exit(1);
}

/**
 * 関門の `implementation`(「ファイル::関数名」)の関数名。区切りがちょうど 1 つで、両側が空でないときだけ読める(読めなければ null)。
 *
 * @param implementation 関門の実装の宣言(関門が見つからなければ undefined)
 */
function gateSymbolOf(implementation: string | undefined): string | null {
  const parts = implementation?.split('::') ?? [];
  const [file, symbol] = parts;
  return parts.length === 2 && file !== undefined && file !== '' && symbol !== undefined && symbol !== '' ? symbol : null;
}

/** 指摘の 1 行。 */
function lineOf(finding: Finding): string {
  return `${finding.location?.file ?? ''} ${finding.message}`.trim();
}

const repoRoot = repoRootOrExit(NAME, process.argv.slice(2));
const { model: product, uses, implemented, findings: productFindings } = loadProductRoots(repoRoot);
const productErrors = productFindings.filter((finding) => finding.severity === 'error');
if (productErrors.length > 0) stop(['製品の根の宣言にエラーがあります。壊れた宣言のまま範囲を決めません', ...productErrors.map((finding) => `${finding.verifier} ${lineOf(finding)}`)]);
const roots = product.roots;
if (roots === null || roots.app === null || uses === null) stop([`製品の根の宣言から実装の木を読めません(${repoRoot})。読めないまま通しません`]);

const layout = NEXTJS_LAYOUT;

const loaded = loadScreenSpecModel(path.join(repoRoot, specPath(roots, 'frontend')), { repoRoot, roots, layout });
const loadErrors = loaded.findings.filter((finding) => finding.severity === 'error');
if (loadErrors.length > 0) stop(['画面の仕様を読めません', ...loadErrors.map(lineOf)]);
if (loaded.model.screens.length === 0) stop(['画面の仕様が 0 件です。読めないまま通しません']);

const app = loadAppRoutes(path.join(repoRoot, roots.app), { repoRoot, roots, layout });
if (!app.available && app.placementProblem === undefined) stop(['実装の木の画面の器を読めません。読めないまま通しません']);
if (app.routes.length === 0 && app.placementProblem === undefined) stop(['実ルートが 0 本です。読めないまま通しません']);
if (!app.proxy.available) stop([`リクエスト前段(${app.proxy.file})を読めません。読めないまま通しません`]);

const auth = loadAuthSpecModel(path.join(repoRoot, specPath(roots, 'backend/auth.md')), { repoRoot });
const authErrors = auth.findings.filter((finding) => finding.severity === 'error');
if (authErrors.length > 0) stop(['認証フローの仕様を読めません', ...authErrors.map(lineOf)]);

const gates = auth.model.flow?.gates ?? [];
if (gates.length === 0) stop(['認証フローの仕様の関門が 0 件です。読めないまま通しません']);

// 実装の範囲(`implemented`): verify と同じ仕分けの関数を呼ぶ。範囲の外の画面の「実ルートが無い」だけが外れ、宣言していない実ルートや範囲の中の不在は赤のまま。
// 持ち主の一覧はここで読めた仕様の分だけ(読めなかった種類の持ち主は載らない = 外さない側)。
type EntryCatalogs = { readonly jobs: boolean; readonly auth: boolean; readonly external: boolean };
const inScopeOnly = (findings: readonly Finding[], catalogs: EntryCatalogs): Finding[] => {
  const owners = scopeOwners({
    uses,
    actionIds: [],
    scanEvents: [],
    queryIds: [],
    screenIds: loaded.model.screens.map((screen) => screen.id),
    tableIds: [],
    usecaseIds: [],
    invariantIds: [],
    catalogs: { ...catalogs, guarantees: false, config: false, designTokens: false },
  });
  return [...partitionByScope(findings, implemented, owners).kept];
};
const catalogsLoaded = { jobs: false, auth: auth.model.flow !== null, external: false };
const errors = inScopeOnly(implementationRouteFindings(loaded.model.screens, app, { roots, layout }, gates), catalogsLoaded).filter((finding) => finding.severity === 'error');
if (errors.length > 0) stop(['宣言していない画面、または実ルートの無い画面があります。ビルドを止めます', ...errors.map(lineOf)]);

// HTTP の入口の閉世界(点検 15 回目 C15-3・O15-1)。verify の J2 と同じ本体を呼ぶ: `route.ts` の宣言との突き合わせ・綴りと export の形・出口の関所・メタデータのルートの動的な形・
// 走査の根の外の口の根・`public/` の拡張子・`next.config` の鍵の表の全部が、この 1 本の中にある。ここが足すのは「飛ばす形を全部赤にする」ことだけ(下の 3 行)。
const jobsLoad = loadJobSpecModel(path.join(repoRoot, specPath(roots, 'backend/jobs.md')), { repoRoot });
const externalLoad = loadExternalSpecModel(path.join(repoRoot, specPath(roots, 'backend/external.md')), { repoRoot });
const jobsInput = catalogInput(selectionOf(uses, 'jobs'), { model: jobsLoad.model, findings: jobsLoad.findings, dropped: jobsLoad.dropped });
const externalInput = catalogInput(selectionOf(uses, 'external'), { model: { available: externalLoad.model.available, catalog: externalLoad.model.catalog }, findings: externalLoad.findings, dropped: externalLoad.dropped });
const entrySpecProblems = [...[jobsInput, externalInput].flatMap((input) => (input.state === 'blocked' ? input.findings.map(lineOf) : [])), ...(jobsInput.state === 'blocked' ? [`ジョブの仕様(${jobsInput.reason})`] : []), ...(externalInput.state === 'blocked' ? [`外部連携の仕様(${externalInput.reason})`] : [])];
if (entrySpecProblems.length > 0) stop(['HTTP の入口の宣言を読めません。読めないまま通しません', ...entrySpecProblems]);
const entries = verifyEntryClosedWorld({ jobs: jobsLoad.model, external: externalInput, auth: auth.model, repoRoot, roots, layout });
if (entries.status !== 'ran' || entries.withheld.length > 0 || entries.unreadable.length > 0) stop([`HTTP の入口を確かめ切れていません(${entries.status}・読めない場所 ${entries.unreadable.join(' ') || 'なし'})。読めないまま通しません`]);
const entryErrors = inScopeOnly(entries.findings, { jobs: jobsLoad.model.catalog !== null, auth: auth.model.flow !== null, external: externalLoad.model.catalog !== null }).filter((finding) => finding.severity === 'error');
if (entryErrors.length > 0) stop(['HTTP の入口の閉世界が破れています。ビルドを止めます', ...entryErrors.map(lineOf)]);

// ホストの J2(Cron の登録の突合と `vercel.json` の鍵の許可表・不在。点検 16 回目 C16-3)。verify のホストの後段と同じ 1 本(`verifyHostJ2`)を呼ぶ。
// 後段の選択は配置と同じく固定(上の `NEXTJS_LAYOUT`)で、ホストを替える日はここも替える。
const hostErrors = verifyHostJ2({ jobs: jobsLoad.model, repoRoot, roots }).filter((finding) => finding.severity === 'error');
if (hostErrors.length > 0) stop(['ホストの設定が許可表の外か、ありません。ビルドを止めます', ...hostErrors.map(lineOf)]);

// 関門の順(点検 14 回目 B14-1。`gate-implementation.test.ts` と同じ形を、テストを通らない道でも止める)。
const sourceRoot = sourceRootPath(layout, roots);
const sourceModule = layoutModule(layout, 'source-root');
if (sourceRoot === null || sourceModule === null) stop(['実装のソースの根を決められません。読めないまま通しません']);
// 関門の名前は `implementation` の「ファイル::関数名」から読む。読めない関門があれば、その画面の順の検査を飛ばさずに赤にする(点検 16 回目 C16-2)。
const orderProblems = loaded.model.screens.flatMap((screen) => {
  const guards = requiredGuardsOf(screen, gates);
  const named = guards.map((guard) => ({ guard, symbol: gateSymbolOf(gates.find((gate) => gate.guards === guard)?.implementation) }));
  const unnamed = named.filter((entry) => entry.symbol === null).map((entry) => entry.guard);
  if (unnamed.length > 0) return [`${screen.route} の関門 ${unnamed.join(' / ')} の implementation から関数の名前を読めません(「ファイル::関数名」の形)。読めないまま通しません`];
  const symbols = named.flatMap((entry) => (entry.symbol === null ? [] : [entry.symbol]));
  const route = app.routes.find((candidate) => candidate.route === screen.route);
  const problem = symbols.length === 0 || route === undefined ? null : gateOrderProblem(repoRoot, route.file, sourceRoot, sourceModule, symbols);
  return problem === null ? [] : [problem];
});
if (orderProblems.length > 0) stop(['関門の順が破れています。ビルドを止めます', ...orderProblems]);
console.log(`${NAME}: 緑(画面の仕様 ${String(loaded.model.screens.length)} 件・実ルート ${String(app.routes.length)} 本・HTTP の入口の閉世界)`);
