/**
 * **Route Handler の本文つき応答の部品**(ASVS V4.1.1。本文のある応答に、中身に合う `Content-Type` と文字コード)。
 *
 * 規約: docs/rules/process/backend/system/standards/conventions/route-handlers.md
 *
 * `Response.json(…)` は `Content-Type: application/json` を付けるが **charset を付けない**(JSON は UTF-8 と決まっているが、
 * 応答の宣言には文字コードを書く、という ASVS の線に合わない)。本文のある応答は、手書きの Route Handler も生成した口も
 * **この 2 つだけで作る**:
 *
 *   - `jsonResponse(body, init)` … `application/json; charset=utf-8`
 *   - `textResponse(body, init)` … `text/plain; charset=utf-8`(文字列でも、UTF-8 のバイト列のストリームでも)
 *
 * ダウンロードの応答は `attachmentResponse(body, contentType, init)` で作る(`Content-Disposition: attachment` を必ず付ける。
 * 口は `guardRoute` の `attachmentTypes` に型と理由を宣言する。宣言の無い型は関所が止める。点検 11 回目 B11-3)。
 *
 * `Content-Type` は**常にこの部品が決める**(`init.headers` に別の値があっても上書きする)。本文を持たない応答
 * (`new Response(null, …)`・転送・204)は対象外で、素の `Response` で作ってよい。
 * 部品を通さない `Response.json(…)` / 本文つきの `new Response(…)` は lint(`layer/require-charset-response`)が止める。
 */

/** JSON の応答の `Content-Type`。 */
export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/** 平文の応答の `Content-Type`。 */
export const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

/**
 * 初期値のヘッダを写して `Content-Type` を決め直す(渡された `init` のヘッダは変えない)。
 *
 * @param init - 呼び出し側の応答の初期値
 * @param contentType - 付ける `Content-Type`
 * @returns `Content-Type` を決めたヘッダを持つ応答の初期値
 */
function withContentType(init: ResponseInit, contentType: string): ResponseInit {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', contentType);
  return { ...init, headers };
}

/**
 * JSON の応答を組む(`Content-Type: application/json; charset=utf-8`)。
 *
 * @param body - JSON にできる値(`undefined` と関数・シンボルは JSON にならないので `TypeError`。`Response.json` と同じ)
 * @param init - ステータスやヘッダ(`Content-Type` は上書きされる)
 * @returns 応答
 * @throws {TypeError} 値が JSON にならないとき
 */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const text = JSON.stringify(body);
  if (text === undefined) throw new TypeError('JSON にできない値は応答の本文にできません');
  return new Response(text, withContentType(init, JSON_CONTENT_TYPE));
}

/**
 * 平文の応答を組む(`Content-Type: text/plain; charset=utf-8`)。
 *
 * @param body - 文字列、または UTF-8 のバイト列のストリーム(逐次配信)
 * @param init - ステータスやヘッダ(`Content-Type` は上書きされる)
 * @returns 応答
 */
export function textResponse(body: string | ReadableStream<Uint8Array>, init: ResponseInit = {}): Response {
  return new Response(body, withContentType(init, TEXT_CONTENT_TYPE));
}

/**
 * ダウンロードの応答を組む(`Content-Disposition: attachment`。ブラウザは文書として開かず保存する)。
 *
 * @param body - 本文(文字列・バイト列・ストリーム)
 * @param contentType - 型(`guardRoute` の `attachmentTypes` に宣言した型)
 * @param init - ステータスやヘッダ(`Content-Type` と `Content-Disposition` は上書きされる)
 * @returns 応答
 */
export function attachmentResponse(body: string | Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>, contentType: string, init: ResponseInit = {}): Response {
  const typed = withContentType(init, contentType);
  const headers = new Headers(typed.headers);
  headers.set('Content-Disposition', 'attachment');
  return new Response(body, { ...typed, headers });
}
