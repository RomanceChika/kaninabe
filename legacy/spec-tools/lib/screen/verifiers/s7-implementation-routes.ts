/**
 * S7 実ルートとの突合。
 *
 * screen-spec-writing.md の S7:「`route` が実装の木の画面の器(ルーティング層の実ファイル構造)と 1 対 1 に対応し、
 * `requires_auth: true` の画面のルートがリクエスト前段の `matcher` に覆われている」。
 * **画面の器・リクエスト前段の置き場と、ファイル配置 → route の逆引きは、置き場の配置(`ProductLayout`の `screen-shell` / `request-gate`。アプリの枠の後段が与える)が決める**。
 *
 * S1 までの検査は仕様どうしの整合だけを見ており、**仕様が実装と同じ世界の話をしているか**は
 * 誰も見ていなかった。片方向だけでは足りない: 仕様にあるのに実ルートが無ければ「書いただけの画面」、
 * 実ルートにあるのに仕様が無ければ「誰も宣言していない入口」であり、後者は可視性・入場条件の
 * 検査すべてがその画面を素通りする(検査の穴が静かに開く)ため、両方向を見る。
 *
 * matcher の突合は**静的パース**である。matcher に正規表現を書かれると解釈できないので、
 * その場合は「覆っている」と決めつけず、検査していないことを警告として出す
 * (緑の意味を、実際に確かめた範囲より広く見せない)。
 */

import type { Finding, ScreenVerifier } from '../verifier.js';
import { authGateBlocked, screenFinding } from '../verifier.js';
import { isParsableMatcher, matcherCovers } from '../route-match.js';
import type { AppRoutesModel } from '../../model/screen/app-types.js';
import { isSpecRouteForm } from '../../model/screen/route-syntax.js';
import type { ScreenInput, ScreenSpec } from '../../model/screen/types.js';
import type { AuthGateDecl } from '../../model/auth/types.js';
import { requiredGuardsOf } from '../../semantics/required-guards.js';
import { layoutClaimProblems } from '../../model/product/layout-claims.js';
import type { LayoutClaim } from '../../model/product/layout-claims.js';
import { layoutPath, layoutScan, screenShellPath } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';
import type { ScreenContext } from '../verifier.js';

/** S7: 仕様の route と実ルート・proxy matcher の対応を検証する。 */
export const implementationRoutesVerifier: ScreenVerifier = {
  id: 'S7',
  title: '実ルート — route がルーティング層の page と 1 対 1 で、要ログイン画面が matcher に覆われる',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    return implementationRouteFindings(input.screens.screens, input.app, ctx, authGateBlocked(ctx) ? null : (input.auth.flow?.gates ?? []));
  },
};

/**
 * S7 の本体。全検査の通し(`verify`)とビルドの入口の関所(`cli/build-gate-routes.ts`)が同じ 1 本を呼ぶ(関所だけ別の規則にしない)。
 *
 * @param screens 画面の仕様
 * @param app 実ルートと matcher のモデル
 * @param ctx 製品の根と置き場の配置
 * @param gates auth_spec の関門の宣言(阻害で読めないときは null。`generateMetadata` の判定を出さない。行は `reachability-notes` が言う)
 * @returns 指摘
 */
export function implementationRouteFindings(screens: readonly ScreenSpec[], app: AppRoutesModel, ctx: Pick<ScreenContext, 'roots' | 'layout'>, gates: readonly AuthGateDecl[] | null): Finding[] {
  // 実装がまだ無い(app/ を読めない)構成では何も見ない。CLI がスキップを 1 行報告する。
  // ただし**実装の木があるのに、置き場の配置が画面の器の走査を決められない**(配置の欠落)のはスキップではなく前提の失敗(黙って全部を飛ばさない)。
  if (!app.available) return app.placementProblem === undefined ? [] : [placementFinding(app.placementProblem, ctx)];
  return [
    ...unreachableRoutes(screens, ctx.layout),
    ...missingImplementations(screens, app, ctx.roots, ctx.layout),
    ...(app.unreadable ?? []).map((file) =>
      screenFinding('S7', {
        message: `実装の木の ${file} を読めません。読めない場所の実ルートは突合できません`,
        location: { file },
        suggestion: '読み取りの権限を確かめる(読めないまま「宣言の無い画面は無い」と言わない)',
        counterexample: { file },
      }),
    ),
    ...undeclaredRoutes(screens, app, ctx.roots),
    ...uncoveredAuthRoutes(screens, app, ctx.layout),
    ...(gates === null ? [] : ungatedMetadata(screens, app, gates)),
  ];
}

/**
 * 関門のある画面の `generateMetadata` が関門の外にある(点検 14 回目 B14-1)。
 *
 * Next.js は `generateMetadata` を page の描画と同時に実行るので、page の関門は守らない。値は 307 / 404 の本文に載る。関門のある画面で許す形は、
 * 最初の文で画面の一番強い関門を待つ形だけ(`role_gate` の画面は `role_gate` の実装、ほかは `requires_auth` の実装)。関門の宣言が無い公開の画面は見ない。
 */
function ungatedMetadata(screens: readonly ScreenSpec[], app: AppRoutesModel, gates: readonly AuthGateDecl[]): Finding[] {
  return screens.flatMap((screen) => {
    const guards = requiredGuardsOf(screen, gates);
    const route = app.routes.find((candidate) => candidate.route === screen.route);
    if (guards.length === 0 || route === undefined || route.metadata.kind === 'none') return [];
    const strongest = gates.find((gate) => gate.guards === guards[guards.length - 1])?.implementation.split('::')[1];
    if (route.metadata.kind === 'gated' && route.metadata.symbol === strongest) return [];
    return [
      screenFinding('S7', {
        message: `関門のある画面 ${screen.name} の ${route.file} の generateMetadata が関門の中にありません(page の描画と同時に走り、値が 307 / 404 の本文に載ります)`,
        location: { file: route.file },
        suggestion: `\`export async function generateMetadata(…) { await ${strongest ?? '関門の実装'}(…); … }\` の形にする(最初の文で関門を待つ。別名の export・再 export・\`export *\` は読めないので置かない)`,
        counterexample: { screen: screen.name, route: screen.route },
      }),
    ];
  });
}

/** 置き場の配置が画面の器の走査を決められない(実装の木はあるのに突合できない)前提の失敗。 */
function placementFinding(problem: string, ctx: Pick<ScreenContext, 'roots'>): Finding {
  return screenFinding('S7', {
    message: `実ルートとの突合の前提が満たされていません: ${problem}`,
    location: { file: specPath(ctx.roots, 'frontend/screens') },
    suggestion:
      'アプリの枠の後段の配置が、画面の器(screen-shell)を宣言し、逆引き(classify)と基準の役割を持つようにする' +
      '(実装の木を宣言する製品はアプリの枠の後段を選ぶ。配置の定義の検査が、選ぶ根の 1 回でこの欠落を先に止める)',
    counterexample: { role: 'screen-shell' },
  });
}

/**
 * 仕様の route が、置き場の配置の画面の器として**そもそも辿れない**(置き場 → 逆引きが同じ route に戻らない・配置が決められない)。
 *
 * 辿れない route は、実装の木をどう走査しても「実ルート」として見つからないので、「実ルートが無い」(下の `missingImplementations`)と
 * 見分けがつかなくなる。**原因が配置の側にある**ことを別の指摘として言う(例: ルーティングに使わない名前の下に置かれる route)。
 * route の重複は S1 の持ち物なので、ここでは言わない(置き場の主張の重複・多重度は数えない)。
 */
function unreachableRoutes(screens: readonly ScreenSpec[], layout: ProductLayout): Finding[] {
  const bySource = new Map(screens.map((screen) => [`画面 ${screen.name} の route ${screen.route}`, screen]));
  const claims: LayoutClaim[] = screens.map((screen) => ({ role: 'screen-shell', key: screen.route, owner: 'product', source: `画面 ${screen.name} の route ${screen.route}` }));
  const own = new Set(['unknown_role', 'invalid_key', 'unresolvable', 'not_reachable']);
  return layoutClaimProblems(layout, claims)
    .filter((problem) => own.has(problem.kind))
    .flatMap((problem) => {
      const screen = problem.sources[0] === undefined ? undefined : bySource.get(problem.sources[0]);
      if (screen === undefined) return [];
      return [
        screenFinding('S7', {
          message: problem.message,
          location: { file: screen.location.file, pointer: 'route' },
          suggestion:
            'route を、置き場の配置の画面の器として辿れる形に直す(ルーティングに使わない名前・形に合わない route は、実装の木を走査しても実ルートとして見つからない)',
          counterexample: { screen: screen.name, route: screen.route },
        }),
      ];
    });
}

/** 仕様にあるのに実ルートが無い。 */
function missingImplementations(
  screens: readonly ScreenSpec[],
  app: AppRoutesModel,
  roots: ProductRoots,
  layout: ProductLayout,
): Finding[] {
  const scan = layoutScan(layout, roots.app, 'screen-shell');
  const routeRoot = scan?.dir ?? '';
  const implemented = new Set(app.routes.map((route) => route.route));
  return screens
    .filter((screen) => !implemented.has(screen.route))
    .map((screen) =>
      screenFinding('S7', {
        message: `route ${screen.route} に対応する実ルートが ${routeRoot} にありません`,
        location: { file: screen.location.file, pointer: 'route' },
        suggestion:
          `${screenShellPath(layout, roots, screen.route) ?? routeRoot} を作るか、` +
          'route を実装の配置に合わせる(動的セグメントの名前も実装と同じにする)',
        counterexample: { screen: screen.name, route: screen.route },
      }),
    );
}

/**
 * 実ルートがあるのに仕様が無い。
 *
 * 実ルートが**仕様の route の文法に載らない形**(パラレルルート・インターセプト・キャッチオール等。逆引きが置き場の綴りのまま返したもの)は、
 * 「route を書け」と案内しない —— 書いても S1 が文法外で止めるので循環する。「未対応」と別の文面で名指す。
 */
function undeclaredRoutes(screens: readonly ScreenSpec[], app: AppRoutesModel, roots: ProductRoots): Finding[] {
  const declared = new Set(screens.map((screen) => screen.route));
  return app.routes
    .filter((route) => !declared.has(route.route))
    .map((route) =>
      isSpecRouteForm(route.route)
        ? screenFinding('S7', {
            message: `実ルート ${route.route} を宣言している screen_spec がありません`,
            location: { file: route.file },
            suggestion:
              `${specPath(roots, 'frontend/screens/{group}/{name}.md')} に route: ${route.route} の screen_spec を書く` +
              '(宣言の無い画面は for / reads / actions のどの検査も受けない)',
            counterexample: { route: route.route, file: route.file },
          })
        : screenFinding('S7', {
            message: `実ルート ${route.route} は未対応の配置です(仕様の route の文法に載らない形。パラレルルート・インターセプト・キャッチオール等は、本物の URL になるのに screen_spec で宣言できません。根の外の layout・template と loading・error・not-found などは、関門の外側で描かれて 307 / 404 の本文に載ります)`,
            location: { file: route.file },
            suggestion:
              'このファイルを静的セグメントか :param の形の置き場に移す(route: を書き足しても、S1 が文法外として止める。' +
              'スロットの部品も、宣言した画面の中で出し分ける形に直す。layout の部品は各画面の関門の後で描く。これらの記法を仕様に載せるかは文法の設計から起こす)',
            counterexample: { route: route.route, file: route.file },
          }),
    );
}

/**
 * `requires_auth: true` の画面が proxy の matcher に覆われているか。
 *
 * 覆われていない画面でも `requireSession()` は各画面が呼ぶので未ログインは弾かれる。
 * ここで見るのは**セッション更新の前段を通るか**であり、通らない画面は
 * 「1 時間後にトークンが切れて突然ログイン画面に飛ぶ」ことになる。
 */
function uncoveredAuthRoutes(screens: readonly ScreenSpec[], app: AppRoutesModel, layout: ProductLayout): Finding[] {
  const guarded = screens.filter((screen) => screen.requiresAuth);
  if (guarded.length === 0) return [];
  // 配置にリクエスト前段の役割が無い構成(そのスタックには前段の matcher が無い)は、被覆を見られない。緑にも警告にもせず、実行ログが「未実施」と名指す。
  if (app.requestGateMissing === true) return [];

  const proxy = app.proxy;
  if (!proxy.available) {
    return [
      screenFinding('S7', {
        message: `requires_auth: true の画面が ${guarded.length} 枚ありますが、${proxy.file} の matcher を読めませんでした`,
        location: { file: proxy.file },
        suggestion:
          `${layoutPath(layout, '', 'request-gate') ?? 'リクエスト前段'} に \`export const config = { matcher: [...] }\` を文字列リテラルの配列で書く` +
          '(動的に組み立てた matcher は静的に読めないため、この突合は行われない)',
        severity: 'warning',
        counterexample: { screens: guarded.map((screen) => screen.name).join(', ') },
      }),
    ];
  }

  const unreadable = proxy.patterns.filter((pattern) => !isParsableMatcher(pattern));
  const readable = proxy.patterns.filter((pattern) => isParsableMatcher(pattern));
  const findings = unreadable.map((pattern) =>
    screenFinding('S7', {
      message: `matcher ${pattern} を静的に解釈できないため、被覆の検査から除外しました`,
      location: { file: proxy.file },
      suggestion:
        'matcher を「リテラルのセグメント」と ":name" / ":name*" / ":name+" / ":name?" だけで書く' +
        '(正規表現つきのパターンは、どのルートを覆うかを仕様側から確かめられない)',
      severity: 'warning',
      counterexample: { pattern },
    }),
  );

  for (const screen of guarded) {
    if (readable.some((pattern) => matcherCovers(pattern, screen.route))) continue;
    findings.push(
      screenFinding('S7', {
        message: `requires_auth: true の画面 ${screen.name}(${screen.route})が proxy の matcher に覆われていません`,
        location: { file: screen.location.file, pointer: 'requires_auth' },
        suggestion:
          `${proxy.file} の matcher に ${screen.route} を覆うパターンを足す` +
          '(セッション更新の前段を通らない画面は、トークンの期限切れでログイン画面へ落ちる)',
        counterexample: { screen: screen.name, route: screen.route, matcher: proxy.patterns.join(', ') },
      }),
    );
  }
  return findings;
}
