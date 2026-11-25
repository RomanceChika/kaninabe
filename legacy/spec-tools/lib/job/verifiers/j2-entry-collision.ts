/**
 * J2(続き)HTTP の入口の衝突 — ジョブの起動口(`endpoint`)と受信 Webhook の口が、**同じ URL を 2 つの持ち主が取らない**。
 *
 * Cron の起動口(製品が手で書く Route Handler)と受信 Webhook の口(生成器が書く Route Handler)は、**同じ URL の空間**(置き場の配置の
 * `http-entry`。キーは URL のパス)に入る。どちらも「この URL はこの持ち主のもの」という主張で、同じ URL を 2 つが取れば、片方が黙って
 * もう片方を上書きする(生成される受信口が手書きの起動口を潰す・2 つのジョブが 1 つの口を取り合う)。この検査は、**主張を集めて配置に当てて一括で
 * 衝突を見る**(`lib/model/product/layout-claims.ts` の `layoutClaimProblems`。契約は「衝突したら失敗」)。
 *
 * 集める主張は 7 種類で、持ち主は 3 通りである(HTTP の入口の宣言の全数は `job/entry-declarations.ts`。閉世界は `j2-entry-closed.ts`):
 *   - ジョブの `endpoint` … `http-entry`・持ち主 `product`(手書きの Route Handler)
 *   - 認証フロー仕様の `callback.endpoint`(OAuth の帰り道)… `http-entry`・持ち主 `product`
 *   - 送信の連携の `endpoints`(その連携を使う手書きの口)… `http-entry`・持ち主 `product`
 *   - 認証フロー仕様の `logout.endpoint`(ログアウトの口)… `http-entry`・持ち主 = ログアウトの口の生成器
 *   - 受信の連携 1 件の受信口 … `http-entry`(URL は `/api/inbound/{連携}`)・持ち主 = 受信口の生成器
 *   - 同じ連携の配線 … `composition-root`(キーは連携 ID)・持ち主 = 受信口の生成器
 *   - 画面の `route` … `screen-shell`・持ち主 `product`(**役割をまたぐ主張**。画面の器と HTTP の入口は同じ URL の空間を取り、同じセグメントに両方は置けない)。
 *     画面どうしの重複・画面の route が辿れないこと(S7 / S1 の持ち物)は**ここでは言わない**(画面の主張だけが関わる指摘は落とす)
 *
 * **ジョブのカタログを採らない製品でも、実装の木を宣言していれば衝突は見る**(受信口と画面の `route` の取り合いは、ジョブの有無に依らない。J2 の他の部分 =
 * 接地・Cron の登録の突合は「ジョブ仕様が無い」で飛ぶが、この続きは実行する。違反の位置はジョブのカタログが無ければ製品の宣言の `roots.app`)。
 * **実装の木を持たない製品**(`roots.app` が null)は、置く場所が無いので置き場の衝突を見ない(事実として置き場が無い)。**実装の木があるのに配置が役割を
 * 宣言していない構成は、黙って見ない形にせず**、「置き場を決められません」と衝突とは別の文面で言う(配置に無い役割・基準が辿れない配置・キーの形)。
 * 外部連携カタログが読めないとき(阻害)は受信口の主張を作れないので、ジョブどうしの衝突だけを見て、見ていないことは呼び手が行で言う。
 *
 * **大文字小文字だけ違う URL は衝突**として数える(大文字小文字を区別しないファイルシステムでは同じディレクトリになる。`layoutClaimProblems`)。
 * **逆引きを持つ役割は、置き場 → 逆引きが同じ URL に戻ること(`not_reachable`)も見る**(`_cron/x` のようにルーティングに使わない名前の下・`(g)/x` のように
 * ルーティングで消える名前・`[x]` のように 1 本の URL に結べない動的なセグメントは、Cron が叩いても 404 になる)。ルーティングの規約で同じ URL になる綴り
 * (`/(g)/x` と `/x`)は 1 つの置き場の取り合いとして数える。
 * **endpoint に `//`・`?`・`#`・`.` / `..` のセグメントがあるのは仕様の誤り**(URL のパスだけを書く。ファイルの置き場にならない)で、実装の木の有無に依らず指す
 * (ジョブの `endpoint`・認証の `callback.endpoint`・送信の連携の `endpoints` のどれも同じ)。
 * **endpoint は 1 ジョブ 1 本**(同じ URL を 2 つのジョブで共有しない — job-spec-writing.md)。共有すれば 2 つのジョブの主張が同じ置き場を取り、衝突になる。
 */

import type { Finding } from '../../kernel/finding.js';
import type { AuthSpecModel } from '../../model/auth/types.js';
import type { ExternalCatalogSpec } from '../../model/external/types.js';
import type { JobSpecModel } from '../../model/job/types.js';
import type { ScreenSpecModel } from '../../model/screen/types.js';
import { layoutClaimProblems } from '../../model/product/layout-claims.js';
import type { LayoutClaim, LayoutClaimProblem } from '../../model/product/layout-claims.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import { PRODUCT_DECL_FILE } from '../../io/paths.js';
import { entryDeclarationsOf, isMalformedEndpoint } from '../entry-declarations.js';
import type { EntryDeclaration } from '../entry-declarations.js';

/** この検証器の ID(J2 の続き)。 */
export const VERIFIER_ID = 'J2';

/** 受信口と配線を書く生成器の ID(コアの生成器 `code-inbound-route` と同じ。`j2-entry-collision.test.ts` が食い違いを見る)。 */
export const INBOUND_ROUTE_GENERATOR_ID = 'code-inbound-route';

/** J2(入口の衝突)の入力。 */
export interface EntryCollisionInput {
  readonly jobs: JobSpecModel;
  /** 読み込めた外部連携カタログ(受信口の主張の材料。読めなければ undefined = ジョブどうしだけ見る)。 */
  readonly external: ExternalCatalogSpec | undefined;
  /** 製品が宣言した根(実装の木が無ければ何も見ない)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(アプリの枠の後段が与える)。 */
  readonly layout: ProductLayout;
  /** 読み込み済みの画面仕様(画面の `route` を役割をまたぐ主張に入れる。省略・`available: false` は画面を採っていない = 画面の主張は無い)。 */
  readonly screens?: ScreenSpecModel;
  /** 読み込み済みの認証フロー仕様(`callback.endpoint` を主張に入れる。省略・読めない・`callback` が無いは認証の口の主張なし)。 */
  readonly auth?: AuthSpecModel;
}

/**
 * 置き場の主張を集める(ジョブ・外部連携・認証の口の宣言と、画面の `route`。宣言の並びのまま)。
 * URL のパスとして書けない endpoint(`isMalformedEndpoint`)は主張にしない(別に指す)。
 *
 * @param jobs 読み込み済みのジョブカタログ
 * @param external 読み込めた外部連携カタログ
 * @param screens 読み込み済みの画面仕様(画面の `route` の主張の材料。省略は画面の主張なし)
 * @param auth 読み込み済みの認証フロー仕様(`callback.endpoint` の主張の材料。省略は認証の口の主張なし)
 * @returns 主張の並び(ジョブ → 外部連携の宣言順 → 認証の口 → 画面の順)
 */
export function entryClaimsOf(jobs: JobSpecModel, external: ExternalCatalogSpec | undefined, screens?: ScreenSpecModel, auth?: AuthSpecModel): LayoutClaim[] {
  const claims: LayoutClaim[] = [];
  for (const decl of entryDeclarationsOf(jobs, external, auth)) {
    if (decl.origin === 'inbound') {
      claims.push({ role: 'http-entry', key: decl.url, owner: INBOUND_ROUTE_GENERATOR_ID, source: decl.source });
      claims.push({ role: 'composition-root', key: decl.owner, owner: INBOUND_ROUTE_GENERATOR_ID, source: `外部連携 ${decl.owner} の受信の配線` });
    } else if (!isMalformedEndpoint(decl.url)) {
      claims.push({ role: 'http-entry', key: decl.url, owner: 'product', source: decl.source });
    }
  }
  for (const screen of screens?.available === true ? screens.screens : []) {
    claims.push({ role: 'screen-shell', key: screen.route, owner: 'product', source: screenSource(screen.name, screen.route) });
  }
  return claims;
}

/** 画面の主張の出どころの文面(S7 と同じ文面。画面の主張だけが関わる指摘を落とすときの目印にもなる)。 */
function screenSource(name: string, route: string): string {
  return `画面 ${name} の route ${route}`;
}

/** 置き場を取り合っている(衝突の)違反か。それ以外は「置き場を決められない」違反。 */
function isCollision(kind: LayoutClaimProblem['kind']): boolean {
  return kind === 'duplicate_path' || kind === 'multiplicity';
}

/** 反例の欄(宣言の種類ごとの持ち主の名前の鍵)。 */
const OWNER_KEY = { job: 'job', inbound: 'integration', auth_callback: 'owner', external_endpoint: 'integration', auth_start: 'owner', auth_logout: 'owner' } as const;

/** endpoint の書き方の誤り(`//`・`?`・`#`・`.` / `..`)。仕様に URL を書く宣言(ジョブ・認証の口・ログアウトの口・送信の連携の口)だけを見る(受信口の URL は連携 ID から決まる)。 */
function malformedEndpointFindings(declarations: readonly EntryDeclaration[]): Finding[] {
  return declarations
    .filter((decl) => decl.origin !== 'inbound' && isMalformedEndpoint(decl.url))
    .map(
      (decl): Finding => ({
        verifier: VERIFIER_ID,
        severity: 'error',
        message: `${decl.source} が URL のパスとして書けません(\`//\`・\`?\`・\`#\`・\`.\` / \`..\` のセグメントを含んでいます)`,
        location: decl.location,
        suggestion: 'endpoint には URL のパスだけを書く(クエリ・フラグメント・空のセグメント・`.` / `..` のセグメントはファイルの置き場にならず、置き場の衝突も正しく数えられない)',
        counterexample: { [OWNER_KEY[decl.origin]]: decl.owner, endpoint: decl.url },
      }),
    );
}

/**
 * HTTP の入口の置き場を検証する(衝突と、置き場を決められないこと)。
 *
 * @param input ジョブカタログ・外部連携カタログ・根・配置
 * @returns 違反のリスト
 */
export function verifyEntryCollision(input: EntryCollisionInput): Finding[] {
  // ジョブのカタログを採らない製品でも、受信口と画面の route の衝突は見る(位置はジョブのカタログではなく、置き場の根を宣言した製品の宣言 = 実装の木の宣言に置く)。
  const location = input.jobs.catalog?.location ?? { file: PRODUCT_DECL_FILE, pointer: 'roots.app' };
  const syntax = malformedEndpointFindings(entryDeclarationsOf(input.jobs, input.external, input.auth));
  if (input.roots.app === null) return syntax;
  const claims = entryClaimsOf(input.jobs, input.external, input.screens, input.auth);
  const screenSources = new Set(claims.filter((claim) => claim.role === 'screen-shell').map((claim) => claim.source));
  // 画面の主張だけが関わる指摘(画面の route の重複・辿れない route)は S1 / S7 の持ち物。J2 が言うのは HTTP の入口が関わるものだけ。
  const problems = layoutClaimProblems(input.layout, claims).filter((problem) => problem.sources.some((source) => !screenSources.has(source)));
  const placement = problems.map((problem): Finding => {
    const collision = isCollision(problem.kind);
    return {
      verifier: VERIFIER_ID,
      severity: 'error',
      message: collision ? `HTTP の入口が衝突しています: ${problem.message}` : `HTTP の入口の置き場を決められません: ${problem.message}`,
      location,
      suggestion: collision
        ? '同じ URL を 2 つの持ち主が取ると、片方がもう片方の Route Handler を黙って上書きする(画面の器と HTTP の入口が同じ URL を取るのも同じ)。ジョブの endpoint か、' +
          '認証の callback か、送信の連携の endpoints か、受信の連携 ID(受信口の URL は `/api/inbound/{連携}`)か、画面の route のどれかを別の URL に直す(大文字小文字だけ違う URL・ルーティングの規約で同じ URL になる綴りも、同じ置き場)'
        : 'アプリの枠の後段の配置が、この役割を宣言し(HTTP の入口・受信の配線)、基準の役割まで辿れてキーの形に合うようにする。' +
          'endpoint は、ルーティングに使わない名前・ルーティングで消える名前・動的なセグメントを含まない、1 本の URL に書く' +
          '(実装の木を宣言する製品はアプリの枠の後段を選ぶ。選ぶのは組み立ての根)',
      counterexample: { kind: problem.kind, sources: problem.sources.join(' / ') },
    };
  });
  return [...syntax, ...placement];
}
