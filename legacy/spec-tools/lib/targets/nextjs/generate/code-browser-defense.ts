/**
 * アプリの枠の後段 Next.js の**ブラウザ側の守り**の生成器 —— 宣言の値(`NEXTJS_BROWSER_DEFENSE`)を製品の実装の木へ配る。
 *
 * 出力は 2 つ:
 *   - `{生成物の置き場}/browser-defense.ts` … 宣言の値(実行時パッケージの `BrowserDefensePolicy` の形)。`next.config` の `headers()`・
 *     生成したリクエスト前段・cookie で認証する Route Handler・生成したログアウトの口が読む唯一の値
 *   - リクエスト前段(置き場の配置の `request-gate`。Next.js の `proxy.ts`)… 文書の口に届く要求ごとに nonce を作って CSP を要求と応答の両方に載せ、
 *     状態を変える要求(Server Action)の出どころを確かめ、そのあとセッションの更新(`session-refresh`)を呼ぶ。保護範囲(`matcher`)は
 *     静的な資材と Route Handler の置き場を除く全部(Next.js の公式文書「Content Security Policy」の matcher の例と同じ形)
 *
 * **判断はここに無い。** 値は後段の宣言・組み方は実行時パッケージ(`@kaninabe/runtime/http/browser-defense`)が持ち、ここは配線を書くだけ。
 * 手で書く場所を残さない(書き忘れた製品だけが開く形にしない)。規約どおりファイル I/O はしない純粋関数である。
 */

import type { SpecModel } from '../../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../../gen-kit/generator.js';
import { frozen } from '../../../gen-kit/frozen-constants.js';
import { DEEP_FREEZE_HELPER, docComment, generatedFile, generatedHeader, renderLiteral, tsString } from '../../../gen-kit/code-emit.js';
import { bodyModulesOf } from '../../../generate/body-modules.js';
import { placedPath } from '../../../generate/layout-placement.js';
import { RUNTIME_BROWSER_DEFENSE_MODULE } from '../../../generate/render/runtime-modules.js';
import type { BrowserDefenseProfile } from '../../../model/product/browser-defense.js';
import type { SourceLocation } from '../../../kernel/source-location.js';
import { NEXTJS_BROWSER_DEFENSE } from '../browser-defense.js';

/** この生成器の ID(置き場の配置の `request-gate` の持ち主と同じ)。 */
export const BROWSER_DEFENSE_GENERATOR_ID = 'code-browser-defense';

/** 生成物の置き場の中のファイル名(拡張子なし)。 */
export const BROWSER_DEFENSE_MODULE_NAME = 'browser-defense';

/** 生成物が export する値の名前。 */
export const BROWSER_DEFENSE_CONST = 'BROWSER_DEFENSE';

/** 値の正(生成物の見出しに出す。仕様の木ではなく、アプリの枠の後段の宣言)。 */
const PROFILE_SOURCE = 'legacy/spec-tools/lib/targets/nextjs/browser-defense.ts';

/** 前提の失敗が指す位置(値の正)。 */
const PROFILE_LOCATION: SourceLocation = { file: PROFILE_SOURCE };

/**
 * 通さない URL 1 つを、否定先読みの 1 項にする(正規表現の特別な文字はエスケープ。末尾が `/` でないものはパスの完全一致 = 終端 `$` を付ける。
 * 6 回目 B6-3)。
 *
 * @param exclusion 通さない URL(先頭の `/` を除いた形)
 */
export function matcherExclusionTerm(exclusion: string): string {
  const escaped = exclusion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return exclusion.endsWith('/') ? escaped : `${escaped}$`;
}

/**
 * リクエスト前段の保護範囲(`matcher` の 1 本)。宣言の除外(区切りつきの接頭辞・完全一致)に当たらない全部の URL。
 *
 * @param profile ブラウザ側の守りの宣言
 * @returns matcher の文字列
 */
export function requestGateMatcher(profile: BrowserDefenseProfile): string {
  return `/((?!${profile.gateExcludedPrefixes.map(matcherExclusionTerm).join('|')}).*)`;
}

/** 応答のヘッダ 1 本(実行時パッケージの `ResponseHeader` と同じ形)。 */
type HeaderLiteral = { readonly name: string; readonly value: string };

/** CSP の指令 1 つ(実行時パッケージの `CspDirective` と同じ形)。 */
type DirectiveLiteral = { readonly name: string; readonly sources: readonly string[] };

/** 生成物に書く値(実行時パッケージの `BrowserDefensePolicy` と同じ形。食い違えば製品の型検査が止める)。 */
type PolicyLiteral = {
  readonly headers: readonly HeaderLiteral[];
  readonly csp: { readonly directives: readonly DirectiveLiteral[]; readonly nonceDirectives: readonly string[]; readonly development: readonly DirectiveLiteral[] };
  readonly noStore: HeaderLiteral;
  readonly clearSiteData: HeaderLiteral;
};

/** 実行時パッケージの形の値(開発中の源の理由は注釈へ出し、値からは落とす)。 */
function policyValue(profile: BrowserDefenseProfile): PolicyLiteral {
  return {
    headers: profile.headers.map((header) => ({ name: header.name, value: header.value })),
    csp: {
      directives: profile.csp.directives.map((directive) => ({ name: directive.name, sources: [...directive.sources] })),
      nonceDirectives: [...profile.csp.nonceDirectives],
      development: profile.csp.development.map((added) => ({ name: added.name, sources: [...added.sources] })),
    },
    noStore: { name: profile.noStore.name, value: profile.noStore.value },
    clearSiteData: { name: profile.clearSiteData.name, value: profile.clearSiteData.value },
  };
}

/** 宣言の値のファイル。 */
function renderPolicy(profile: BrowserDefenseProfile): string {
  const reasons = [
    ...profile.csp.development.map((added) => `- 開発中だけ ${added.name} に ${added.sources.join(' ')} を足す: ${added.reason}`),
    ...profile.relaxations.map((relax) => `- 本番の ${relax.directive} に ${relax.source} を許す: ${relax.reason}`),
  ];
  return [
    generatedHeader([PROFILE_SOURCE]),
    '',
    `import type { BrowserDefensePolicy } from ${tsString(RUNTIME_BROWSER_DEFENSE_MODULE)};`,
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      'ブラウザ側の守りの宣言(全応答の固定のヘッダ・文書の CSP・キャッシュの禁止・ログアウトの消去)。',
      '',
      '`next.config` の `headers()`・生成したリクエスト前段・cookie で認証する Route Handler・ログアウトの口が読む唯一の値である。',
      '値を変えるときはアプリの枠の後段の宣言を直す(床を下回る値は後段の選択の契約が止める)。値は深く凍結する(実行時の書き換えで守りを外させない)。',
      ...(reasons.length === 0 ? [] : ['', '床を緩める宣言(理由つき):', ...reasons]),
    ]),
    `export const ${BROWSER_DEFENSE_CONST}: BrowserDefensePolicy = ${frozen(renderLiteral(policyValue(profile)))};`,
    '',
  ].join('\n');
}

/** リクエスト前段のファイル。 */
function renderRequestGate(profile: BrowserDefenseProfile, ctx: GenerateContext): string {
  const modules = bodyModulesOf(ctx, { what: 'リクエスト前段', location: PROFILE_LOCATION });
  return [
    generatedHeader([PROFILE_SOURCE]),
    '',
    "import type { NextRequest } from 'next/server';",
    `import { gateDocumentRequest } from ${tsString(RUNTIME_BROWSER_DEFENSE_MODULE)};`,
    `import { ${BROWSER_DEFENSE_CONST} } from ${tsString(modules.generated(BROWSER_DEFENSE_MODULE_NAME))};`,
    `import { refreshSession } from ${tsString(modules.sessionRefresh())};`,
    '',
    docComment([
      'リクエスト前段の保護範囲 —— 静的な資材と Route Handler の置き場を除く全部の URL(文書の口と、そこへ届く Server Action)。',
      'nonce は要求ごとに作るので、文書を返す全部の口を通す(Next.js の公式文書「Content Security Policy」の matcher の例と同じ形)。',
    ]),
    'export const config = {',
    `  matcher: [${tsString(requestGateMatcher(profile))}],`,
    '};',
    '',
    docComment([
      '文書の口に届いた要求の前段(Next.js の `proxy` ファイル規約)。',
      '',
      '①状態を変える要求(Server Action)で、出どころ(`Sec-Fetch-Site: same-origin` と、スキームとホストが自分に一致する `Origin`)を確かめられなければ 403 で拒む',
      '②要求ごとに nonce を作り、スクリプトの CSP を要求(Next.js が描画で nonce を読む)と応答(ブラウザが執行する)の両方に載せる',
      '③セッションを更新し(期限切れのアクセストークンの更新。認可の判定はしない)、応答に CSP とキャッシュの禁止を付ける',
      '',
      '@param request - 受け取った要求',
      '@returns 後続へ渡す応答(拒むときは 403)',
    ]),
    'export async function proxy(request: NextRequest): Promise<Response> {',
    `  const gate = gateDocumentRequest(request, ${BROWSER_DEFENSE_CONST}, { development: process.env.NODE_ENV === 'development' });`,
    "  if (gate.kind === 'refuse') return gate.response;",
    '  const response = await refreshSession(request, gate.requestHeaders);',
    '  for (const header of gate.responseHeaders) response.headers.set(header.name, header.value);',
    '  return response;',
    '}',
    '',
  ].join('\n');
}

/**
 * ブラウザ側の守りの宣言の値と、リクエスト前段を生成するジェネレーター(どちらも全置換)。実装の木を持たない製品では何も出さない。
 * 置き場は製品の宣言(`roots.generated`)と置き場の配置(`request-gate` / `session-refresh`)が決め、決められなければ前提の失敗で止める。
 */
export const browserDefenseGenerator: DocGenerator = {
  id: BROWSER_DEFENSE_GENERATOR_ID,

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    if (ctx.roots.app === null) return [];
    const profile = NEXTJS_BROWSER_DEFENSE;
    const gate = placedPath(ctx.layout, ctx.roots, { role: 'request-gate', what: 'リクエスト前段', location: PROFILE_LOCATION, verifier: 'S7' });
    return [
      { file: generatedFile(ctx.roots, `${BROWSER_DEFENSE_MODULE_NAME}.ts`), content: renderPolicy(profile), wholeFile: true },
      { file: gate, content: renderRequestGate(profile, ctx), wholeFile: true },
    ];
  },
};
