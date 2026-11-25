/**
 * **要求の出どころの確認**(CSRF の守り)と、Route Handler の応答の部品(キャッシュの禁止・ログアウトの消去)。
 *
 * 規約: docs/rules/process/backend/system/standards/conventions/route-handlers.md(§要求の出どころ)
 *
 * ## 何を要求するか
 *
 * cookie で認証する口は、ブラウザが他のサイトから送らせた要求にも cookie を付けて届けうる。状態を変える要求
 * (`GET` / `HEAD` / `OPTIONS` 以外)では、次の**両方**を要求する:
 *
 *   1. `Sec-Fetch-Site: same-origin` —— ブラウザが「同じオリジンのページから出た要求」と申告している
 *   2. `Origin` が在り、その**スキームとホストの両方**が自分のオリジンに一致する。自分のホストは `X-Forwarded-Host` の先頭
 *      (無ければ `Host`)、自分のスキームは `X-Forwarded-Proto` の先頭(無ければ要求の URL のスキーム)
 *
 * どちらのヘッダもページのスクリプトからは書き換えられない(ブラウザが付ける)。片方でも欠ければ閉じる ——
 * 古いブラウザ・手で組んだ要求は通らない側に倒す(黙って通す既定を作らない)。ホストの比べ方は Next.js の
 * Server Action の検査と同じ(`Origin` のホスト対 `X-Forwarded-Host` か `Host`)で、そこへスキームの一致を足した
 * (`http://app.example` のページからの送信を `https://app.example` の口が受けない)。
 *
 * ## `X-Forwarded-Host` / `X-Forwarded-Proto` を信頼してよい条件
 *
 * この 2 つは**配備の前段が付け直す**ことを前提に読む。前提が崩れる配備では、利用者の手元の HTTP クライアントが
 * 好きな値を書ける(ブラウザは別のサイトのページから任意の名前のヘッダを付けられない —— 付けると事前確認(preflight)が
 * 起き、この仕組みは CORS の許可を一切返さないので本番の要求は送られない。だから**被害者のブラウザ経由の偽装**は
 * この 2 つでは起きない。残るのは cookie を持たない手組みの要求で、それは CSRF ではない)。
 *
 *   - **Vercel** … 公式の文書「Request headers」(https://vercel.com/docs/headers/request-headers)は
 *     `x-forwarded-host` を「`host` と同じ値」、`x-forwarded-proto` を「本番では通常 `https`」と書き、`x-forwarded-for` は
 *     前段のプロキシの値を上書きすると明言している(`x-forwarded-host` の上書きは明言していない —— 「`host` と同じ」が契約の文言である)
 *   - **Cloudflare を前に置くとき** … 公式の文書「Cloudflare HTTP headers」
 *     (https://developers.cloudflare.com/fundamentals/reference/http-headers/)は `X-Forwarded-Proto` を上書きすると書き、
 *     `X-Forwarded-Host` には触れていない。後ろの Vercel の契約(「`host` と同じ」)が前提を支えるが、上書きの明言が無いので、
 *     前段を置いたら runbook の手順で実際に確かめる
 *   - **自前の `next start`(前段なし)** … Next.js 16.4.2 の `base-server.js` は `x-forwarded-host` / `x-forwarded-proto` を
 *     `??=`(**来た値を残し、無いときだけ埋める**)で付ける。前段なしで公開すると利用者の値がそのまま届く。前段を置き、
 *     その前段で 2 つを付け直すこと(runbook §出どころの確認の前提)
 *
 * **事前確認(CORS の preflight)には頼らない。** Route Handler は `Content-Type: text/plain` の本文も読めるので、
 * 事前確認を起こさない形の要求でも中身が届く。出どころはここで確かめる。
 *
 * ## 誰が使うか
 *
 * - リクエスト前段(文書の口に届く Server Action)… `browser-defense.ts` の `gateDocumentRequest`
 * - cookie で認証する手書きの Route Handler(送信の連携の `endpoints` の口)… 最初の 1 行で `refuseCrossOrigin`
 * - 生成されたログアウトの口 … `refuseCrossOrigin` と `logoutResponse`
 *
 * 署名で認証する口(受信 Webhook)と共有秘密で認証する口(Cron)は対象外である(cookie を使わないので、他のサイトから
 * 送らせても認証が付かない)。区別は口の宣言の種類が決める(J2 の口の分類)。
 */

import type { Logger } from '../operation/ports.js';
import { originRefusalRecord, requestIdOf, stdoutLogger } from '../operation/security-log.js';
import type { BrowserDefensePolicy } from './browser-defense.js';
import { jsonResponse } from './response.js';

/** 状態を変えないメソッド(出どころを確かめない)。 */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 状態を変えうるメソッドか(`GET` / `HEAD` / `OPTIONS` 以外。大文字小文字は問わない)。
 *
 * @param method - HTTP のメソッド
 * @returns 状態を変えうるなら true
 */
export function isStateChangingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/** 転送のヘッダの先頭の値(`a, b` の `a`。前後の空白は捨てる)。無い・空なら null。 */
function firstForwarded(headers: Headers, name: string): string | null {
  const first = headers.get(name)?.split(',')[0]?.trim();
  return first === undefined || first === '' ? null : first;
}

/** 自分のホスト(`X-Forwarded-Host` の先頭の値、無ければ `Host`)。どちらも無ければ null。 */
function ownHost(headers: Headers): string | null {
  const forwarded = firstForwarded(headers, 'x-forwarded-host');
  if (forwarded !== null) return forwarded;
  const host = headers.get('host');
  return host === null || host === '' ? null : host;
}

/** 受け付けるスキーム(`URL#protocol` の綴り)。 */
const WEB_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * 自分のスキーム(`X-Forwarded-Proto` の先頭の値、無ければ要求の URL のスキーム。`https:` の形)。
 * `X-Forwarded-Proto` が `http` / `https` 以外・URL が読めない・Web のスキームでないなら null(閉じる側に倒す)。
 */
function ownScheme(headers: Headers, requestUrl: string): string | null {
  const forwarded = firstForwarded(headers, 'x-forwarded-proto');
  if (forwarded !== null) {
    const scheme = `${forwarded.toLowerCase()}:`;
    return WEB_SCHEMES.has(scheme) ? scheme : null;
  }
  const scheme = URL.canParse(requestUrl) ? new URL(requestUrl).protocol : null;
  return scheme !== null && WEB_SCHEMES.has(scheme) ? scheme : null;
}

/** `Origin` のスキームとホスト。無い・`null`・URL として読めないなら null。 */
function originOf(headers: Headers): { readonly scheme: string; readonly host: string } | null {
  const origin = headers.get('origin');
  if (origin === null || origin === '' || origin === 'null' || !URL.canParse(origin)) return null;
  const url = new URL(origin);
  return { scheme: url.protocol, host: url.host };
}

/** 出どころを確かめる要求の最小の形(メソッドは見ない。見るのはヘッダと URL)。 */
export interface OriginCheckedRequest {
  readonly headers: Headers;
  /** 要求の URL(`X-Forwarded-Proto` が無いときの自分のスキーム)。 */
  readonly url: string;
}

/**
 * 要求が自分と同じオリジンのページから出たと確かめられるか(`Sec-Fetch-Site: same-origin` と、自分のオリジンに
 * スキームとホストの両方が一致する `Origin`)。
 *
 * @param request - 要求(ヘッダと URL)
 * @returns 全部が揃って一致すれば true
 */
export function isSameOriginRequest(request: OriginCheckedRequest): boolean {
  if (request.headers.get('sec-fetch-site') !== 'same-origin') return false;
  const origin = originOf(request.headers);
  const host = ownHost(request.headers);
  const scheme = ownScheme(request.headers, request.url);
  return origin !== null && host !== null && scheme !== null && origin.host === host && origin.scheme === scheme;
}

/**
 * 出どころを確かめられない要求を閉じる応答(403。理由は本文に書かない)。
 *
 * @param policy - ブラウザ側の守りの宣言(キャッシュの禁止を付ける)
 * @returns 403 の応答
 */
export function crossOriginRefusal(policy: BrowserDefensePolicy): Response {
  return jsonResponse({ error: 'forbidden' }, { status: 403, headers: { [policy.noStore.name]: policy.noStore.value } });
}

/**
 * 出どころを確かめられなかった要求を 1 行記録する(ASVS V16.3.3 —— 検査をすり抜けようとする試み)。
 *
 * 載せるのは事象・分類・要求の識別子だけで、経路・ヘッダ・本文は載せない(logging.md)。
 *
 * @param headers - 拒んだ要求のヘッダ(要求の識別子を読む)
 * @param logger - 出力口(省略は標準出力)
 */
export function recordOriginRefusal(headers: Headers, logger: Logger = stdoutLogger): void {
  logger.write(originRefusalRecord(requestIdOf(headers)));
}

/**
 * cookie で認証する Route Handler の最初の 1 行。状態を変える要求で出どころを確かめられなければ 403 を返し、
 * それ以外は null(本体へ進む)。閉じるときは 1 行記録する(`recordOriginRefusal`)。
 *
 * @param request - 受け取った要求
 * @param policy - ブラウザ側の守りの宣言
 * @param logger - 記録の出力口(省略は標準出力。製品の口は呼び手が渡せる)
 * @returns 閉じるなら 403 の応答、進むなら null
 */
export function refuseCrossOrigin(request: Request, policy: BrowserDefensePolicy, logger: Logger = stdoutLogger): Response | null {
  if (!isStateChangingMethod(request.method) || isSameOriginRequest(request)) return null;
  recordOriginRefusal(request.headers, logger);
  return crossOriginRefusal(policy);
}

/**
 * Route Handler の応答の初期値(キャッシュの禁止)。`jsonResponse(body, noStoreInit(policy, 200))` の形で使う。
 *
 * @param policy - ブラウザ側の守りの宣言
 * @param status - HTTP のステータス
 * @returns 応答の初期値
 */
export function noStoreInit(policy: BrowserDefensePolicy, status: number): ResponseInit {
  return { status, headers: { [policy.noStore.name]: policy.noStore.value } };
}

/**
 * ログアウトの応答(204)。ブラウザに残るこのサイトのデータ(キャッシュ・cookie・保存領域)を消させ、応答自体も残させない。
 *
 * @param policy - ブラウザ側の守りの宣言
 * @returns 204 の応答
 */
export function logoutResponse(policy: BrowserDefensePolicy): Response {
  return new Response(null, {
    status: 204,
    headers: { [policy.clearSiteData.name]: policy.clearSiteData.value, [policy.noStore.name]: policy.noStore.value },
  });
}
