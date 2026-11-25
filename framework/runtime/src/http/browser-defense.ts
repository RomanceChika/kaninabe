/**
 * **ブラウザ側の守りの既定**(全応答のヘッダ・文書の CSP・要求の出どころ・キャッシュの禁止・ログアウトの消去)の実体。
 *
 * 規約: docs/rules/process/backend/system/standards/conventions/route-handlers.md(§ブラウザ側の守り)
 *
 * ## 判断の値はここに無い
 *
 * どのヘッダをどの値で付けるか(`BrowserDefensePolicy`)は、アプリの枠の後段の宣言から**生成された値**が運んでくる
 * (`{生成物の置き場}/browser-defense.ts`)。ここが持つのは「値をどう組んで応答に付けるか」だけで、製品ごとに書き換える
 * 場所を持たない —— 書き手が何もしなくても、生成物とこの関数を配線した時点で全応答に同じ守りが付く。
 *
 * ## 文書の CSP は要求ごとの nonce で組む
 *
 * スクリプトの読み込み元は、要求ごとに作る使い捨ての値(nonce)を持つものと、**それらが足したもの**に絞る(`script-src 'nonce-…' 'strict-dynamic'`)。
 * `'strict-dynamic'` は信頼を渡すので、CSP だけではスクリプトの口を閉じられない。Next.js の起動スクリプトが nonce を持つ以上、`next/script`・nonce つきの
 * `<script>`・`createElement('script')` は CSP を通る(点検 12 回目 B12-1 で実測)。その口は `layer/closed-framework-surface` と `layer/no-dom-assembly` が閉じる。
 * Next.js は**要求の** `Content-Security-Policy` から nonce を読み取り、自分のスクリプトに付ける(Next.js の公式文書
 * 「Content Security Policy」の Nonces の節)。だから同じ値を要求のヘッダ(後続の描画が読む)と応答のヘッダ(ブラウザが執行する)の
 * 両方に載せる。nonce は暗号論的な乱数 16 バイト(128 ビット)で、推測できない。
 *
 * ## 状態を変える要求は出どころを確かめる
 *
 * 文書の口(画面の URL)に届く状態を変える要求は Server Action である。Next.js は `Origin` が無い要求を**警告だけで通す**
 * (公式文書 `serverActions.allowedOrigins`: "A request that carries no `Origin` header at all is allowed through with a warning")
 * ので、足りない分をここで足す —— `Sec-Fetch-Site: same-origin` と、スキームとホストの両方が自分のオリジンに一致する `Origin` の
 * 両方を要求する(`request-origin.ts`)。
 */

import type { Logger } from '../operation/ports.js';
import { crossOriginRefusal, isSameOriginRequest, isStateChangingMethod, recordOriginRefusal } from './request-origin.js';

/** 応答のヘッダ 1 本。 */
export interface ResponseHeader {
  /** ヘッダの名前。 */
  readonly name: string;
  /** ヘッダの値。 */
  readonly value: string;
}

/** CSP の指令 1 つ(名前と源の並び)。 */
export interface CspDirective {
  /** 指令の名前(`script-src` など)。 */
  readonly name: string;
  /** 源の並び(引用符つきのキーワードはそのまま書く。例 `'none'`)。 */
  readonly sources: readonly string[];
}

/** 文書の CSP の宣言。 */
export interface CspPolicy {
  /** 本番の指令。 */
  readonly directives: readonly CspDirective[];
  /** 要求ごとの nonce を先頭に差し込む指令の名前。 */
  readonly nonceDirectives: readonly string[];
  /** 開発中(`next dev`)だけ足す源(宣言の理由は生成物の注釈が持つ)。本番には決して載らない。 */
  readonly development: readonly CspDirective[];
}

/** ブラウザ側の守りの宣言(生成物が値を持つ)。 */
export interface BrowserDefensePolicy {
  /** 全応答に付ける固定のヘッダ。 */
  readonly headers: readonly ResponseHeader[];
  /** 文書の応答に付ける CSP。 */
  readonly csp: CspPolicy;
  /** 共有のキャッシュにもブラウザにも残させないヘッダ(認証の要る応答・Route Handler の応答)。 */
  readonly noStore: ResponseHeader;
  /** ログアウトの応答で、ブラウザに残るこのサイトのデータを消させるヘッダ。 */
  readonly clearSiteData: ResponseHeader;
}

/** CSP のヘッダの名前(要求と応答の両方に載せる)。 */
export const CSP_HEADER = 'Content-Security-Policy';

/** 後続の描画(Server Component)へ nonce を渡す要求のヘッダの名前(Next.js の公式文書の例と同じ綴り)。 */
export const NONCE_REQUEST_HEADER = 'x-nonce';

/** nonce の乱数のバイト数(128 ビット)。 */
const NONCE_BYTES = 16;

/** 乱数でバイト列を埋める口(既定は Web Crypto。テストが差し替える)。 */
export type FillRandom = (bytes: Uint8Array) => Uint8Array;

/** Web Crypto の乱数(暗号論的に安全な乱数源)。 */
const webCryptoRandom: FillRandom = (bytes) => globalThis.crypto.getRandomValues(bytes);

/**
 * 要求ごとの nonce を作る(暗号論的な乱数 16 バイトを base64 にしたもの)。
 *
 * UUID を使わない —— UUID は版と変種の印でビットを使い、乱数の部分が 128 ビットに満たない。
 *
 * @param fill - 乱数でバイト列を埋める口(省略は Web Crypto)
 * @returns base64 の nonce
 */
export function createNonce(fill: FillRandom = webCryptoRandom): string {
  const bytes = fill(new Uint8Array(NONCE_BYTES));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * 文書の CSP を組む。nonce を差し込む指令には `'nonce-…'` を先頭に足し、開発中なら開発の源を足す。
 *
 * @param csp - CSP の宣言
 * @param nonce - この要求の nonce
 * @param development - 開発中(`next dev`)か
 * @returns ヘッダの値(指令を `; ` で繋いだもの)
 */
export function contentSecurityPolicy(csp: CspPolicy, nonce: string, development: boolean): string {
  return csp.directives
    .map((directive) => {
      const nonceSources = csp.nonceDirectives.includes(directive.name) ? [`'nonce-${nonce}'`] : [];
      const extra = development ? csp.development.filter((added) => added.name === directive.name).flatMap((added) => added.sources) : [];
      return [directive.name, ...nonceSources, ...directive.sources, ...extra].join(' ');
    })
    .join('; ');
}

/**
 * 全応答に付ける固定のヘッダを、Next.js の `headers()` の形(`{ key, value }`)にする。
 *
 * @param policy - ブラウザ側の守りの宣言
 * @returns `next.config` の `headers()` の 1 規則に渡す並び
 */
export function staticHeaderEntries(policy: BrowserDefensePolicy): { key: string; value: string }[] {
  return policy.headers.map((header) => ({ key: header.name, value: header.value }));
}

/** 文書の口(リクエスト前段)の判定。 */
export type DocumentGate =
  | {
      /** 出どころの確かめられない状態を変える要求なので、描画に進ませず閉じる。 */
      readonly kind: 'refuse';
      readonly response: Response;
    }
  | {
      /** 描画に進ませる。要求のヘッダ(nonce と CSP を載せた写し)と、応答に付けるヘッダを返す。 */
      readonly kind: 'pass';
      readonly requestHeaders: Headers;
      readonly responseHeaders: readonly ResponseHeader[];
    };

/** 文書の口の判定の入力(要求の最小の形)。 */
export interface DocumentRequest {
  readonly method: string;
  readonly headers: Headers;
  /** 要求の URL(出どころの確認で、`X-Forwarded-Proto` が無いときの自分のスキームになる)。 */
  readonly url: string;
}

/**
 * 文書の口に届いた要求を判定する(リクエスト前段が呼ぶ唯一の関数)。
 *
 *   - 状態を変える要求(Server Action)で、出どころが自分と確かめられない → 403 で閉じる
 *   - それ以外 → nonce を作り、CSP を要求と応答の両方に載せる。応答にはキャッシュの禁止も付ける
 *
 * @param request - 要求(メソッド・ヘッダ・URL)
 * @param policy - ブラウザ側の守りの宣言
 * @param options - 開発中か・乱数の口
 * @param options.development - 開発中(`next dev`)か(開発中だけ足す源を載せる)
 * @param options.fill - 乱数でバイト列を埋める口(省略は Web Crypto)
 * @param options.logger - 出どころの拒否を記録する出力口(省略は標準出力)
 * @returns 判定
 */
export function gateDocumentRequest(
  request: DocumentRequest,
  policy: BrowserDefensePolicy,
  options: { readonly development: boolean; readonly fill?: FillRandom; readonly logger?: Logger },
): DocumentGate {
  if (isStateChangingMethod(request.method) && !isSameOriginRequest(request)) {
    recordOriginRefusal(request.headers, options.logger);
    return { kind: 'refuse', response: crossOriginRefusal(policy) };
  }
  const nonce = createNonce(options.fill);
  const csp = contentSecurityPolicy(policy.csp, nonce, options.development);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_REQUEST_HEADER, nonce);
  requestHeaders.set(CSP_HEADER, csp);
  return { kind: 'pass', requestHeaders, responseHeaders: [{ name: CSP_HEADER, value: csp }, policy.noStore] };
}
