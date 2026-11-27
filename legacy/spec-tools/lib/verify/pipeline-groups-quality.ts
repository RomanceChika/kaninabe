/**
 * 経験則・視覚・語彙の群の実行と「何件見たか」の 1 行報告(U 群 / G 群 / W 群)。
 *
 * [verify-pipeline-groups.ts](../compose/verify-pipeline-groups.ts) と役目は同じで、責務の線は
 * **「仕様種ごとの検証」と「仕様種に紐づかない検証」**である —— この 3 群はどれも
 * 「宣言の正しさ」ではなく **書き方の質**(warning の経験則・トークンと CSS の一致・
 * 仕組み側コードへの語彙漏れ)を見るので、仕様種が増えても増えない。
 */

import path from 'node:path';
import type { SpecModel } from '../model/types.js';
import type { Finding } from '../kernel/finding.js';
import type { VerifyContext } from '../check-api/contract.js';
import type { ProgressLog } from './group-contract.js';
import type { NotificationSpecModel } from '../model/notification/types.js';
import type { JobSpecModel } from '../model/job/types.js';
import type { ConfigSpecModel } from '../model/config/types.js';
import { runUxVerification } from '../ux/run.js';
import { ALL_UX_VERIFIERS } from '../ux/verifiers/index.js';
import { ALL_USECASE_VERIFIERS } from '../usecase/verifiers/index.js';
import { uxLimitsOf } from '../ux-principles/limits.js';
import { verifyUxPrinciples } from '../ux-principles/run.js';
import type { UxContext } from '../ux/context.js';
import type { UxPrinciplesModel } from '../model/ux-principles/types.js';
import type { ScreenSpecModel } from '../model/screen/types.js';
import { runDesignVerification } from '../design/run.js';
import { runGeneralityVerification } from '../generality/run.js';
import { appGrounded, detectRepoRoot } from '../io/paths.js';
import { describeMissingRole } from './check-run-report.js';
import { appPath } from '../model/product/paths.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';

/**
 * UX 経験則の検査(U 群)を実行し、実行状況を一行で残す。
 *
 * S 群と同じ画面仕様を入力にするが、**指摘はすべて warning** であり、verify の
 * 「エラー 0」条件には影響しない(ux-lint.md)。免除の適用まで含めて run.ts が済ませてある。
 */
export function runUx(
  model: SpecModel,
  screens: ScreenSpecModel,
  principles: UxPrinciplesModel,
  guards: VerifyContext['guards'],
  operations: Pick<UxContext, 'catalogs' | 'actions'>,
  log: ProgressLog,
): Finding[] {
  // 台帳の整合(U8)。スキーマ適合は読み込み時に積んである。台帳が無ければ何も言わない。
  const ledger = verifyUxPrinciples(principles, {
    ux: ALL_UX_VERIFIERS.map((verifier) => verifier.id),
    usecase: ALL_USECASE_VERIFIERS.map((verifier) => verifier.id),
  });
  log(
    principles.available
      ? `U8(UX 原則の台帳): 原則 ${principles.spec?.principles.length ?? 0} 件の整合を見ました(違反 ${ledger.length} 件。閾値は台帳から読む)。`
      : 'U8(UX 原則の台帳): specs/frontend/ux-principles.md が無いため、閾値は検査器の既定値で動きます。',
  );
  const result = runUxVerification({
    domain: model,
    screens,
    context: { guards, limits: uxLimitsOf(principles), ...operations },
  });
  if (!result.available) {
    log('U 群(UX 経験則): specs/frontend/screens が無いためスキップしました。');
    return [...ledger, ...result.findings];
  }
  log(
    `U 群(UX 経験則): screen_spec ${result.screenCount} 件に対し U1〜U5 を実行しました` +
      `(warning ${result.warningCount} 件 / 受け入れの掃除漏れ ${result.staleCount} 件 / ` +
      `理由つきで受け入れ ${result.acceptedCount} 件)。`,
  );
  return [...ledger, ...result.findings];
}

/**
 * 視覚層の検証(G 群)を実行し、実行状況を一行で残す。
 *
 * 入力はトークン仕様と実装の CSS の 2 つで、どちらの位置も specs/domain から導く。
 * 実行状況の文言は run.ts が組み立てる(この層に「何件見たか」の知識を置かないため)。
 */
export function runDesign(domainRoot: string, roots: ProductRoots, layout: ProductLayout, log: ProgressLog): { readonly findings: readonly Finding[]; readonly tokensLoaded: boolean } {
  const repoRoot = detectRepoRoot(domainRoot);
  const appRoot = appPath(roots);
  const result = runDesignVerification({
    designRoot: path.join(path.dirname(domainRoot), 'frontend', 'design'),
    appRoot: appRoot === null ? '' : path.join(repoRoot, appRoot),
    repoRoot,
    roots,
    layout,
  });
  log(result.summary);
  // 配置にアプリの既定のアイコンの役割が無いなら、G8 の既定の残骸の検査は見ていない(黙って緑にしない。語は未実施と同じ)。
  if (result.defaultIconUnplaced) log(describeMissingRole('G8', 'app-icon(アプリの既定のアイコン)', '既定のアイコンの残骸'));
  return { findings: [...result.findings], tokensLoaded: result.tokensLoaded };
}

/**
 * 語彙漏れ検査(W 群)を実行し、実行状況を一行で残す。
 *
 * W1(文字列リテラル)は `legacy/spec-tools/lib` が常に存在するのでスキップが無いが、
 * **W2(散文)はアプリ側の仕組みの層だけを見る**ので、`app/` を読めない構成では
 * 走査対象が 1 つも無い —— 黙って 0 件になる範囲は進捗行に出す(束 ㉑)。
 */
export function runGenerality(
  model: SpecModel,
  notifications: NotificationSpecModel,
  jobs: JobSpecModel,
  config: ConfigSpecModel,
  domainRoot: string,
  roots: ProductRoots,
  layout: ProductLayout,
  log: ProgressLog,
): Finding[] {
  const repoRoot = detectRepoRoot(domainRoot);
  const result = runGeneralityVerification({ domain: model, notifications, jobs, config, repoRoot, roots, layout });
  const scope = appGrounded(repoRoot, roots.app)
    ? 'W1・W2・W3・W4'
    : 'W1・W3・W4(実装の木が無いため W2 の散文の走査はスキップ)';
  log(
    `W 群(語彙漏れ検査): 仕組み側コードの全域を走査し ${scope} を実行しました` +
      `(散文で「例:」の印により免除した行 ${String(result.exemptedLines)} 件)。`,
  );
  // 信号(300 行)を超えて宣言(@oversize / @split-review)で通したファイルの本数。上限は置かないので、
  // 増え方を毎回見せる(情報であり warning ではない)。
  log(`W 群(300 行の宣言): 300 行を超える宣言つきファイル ${String(result.oversizeDeclared)} 本。`);
  return result.findings;
}

