/**
 * **Axiom へ送る口**(`@kaninabe/runtime/log-sink` の `LogSink` の実装。ASVS V16.4.3)。
 *
 * 取り込みの文書(Axiom の公式): `POST https://{domain}/v1/ingest/{dataset}`・`Authorization: Bearer <API トークン>`・
 * 本文は `application/x-ndjson`(1 行 1 JSON)・1 回に最大 10,000 件・429 でレート制限。SDK は要らず、`fetch` で送れる。
 * 既定の domain は `api.axiom.co`(EU の組織は `api.eu.axiom.co`)。
 *
 * ## この部品が守ること
 *
 * - **送る前に宛先を縛る** —— domain は `axiom.co` 配下のホスト名だけ、dataset は英数字と `-` `_` だけ。環境の取り違えで、トークンが
 *   別のホストへ送られない(崩れていたら送らずに `misconfigured` の失敗にする)
 * - **転送について行かない** —— 既定の `fetch` は `safeFetch`(`redirect: "error"`。ASVS V15.3.2)
 * - **短い時間枠** —— 既定 3 秒で打ち切る(応答の後に実行する仕事が、サーバーレスの実行時間を使い切らない)
 * - **投げない・載せない** —— 失敗は理由の閉じた語(`LogSinkFailure`)で返す。応答の本文・ヘッダ・例外の文言・トークンは読まず・返さない
 * - **行は変えない** —— `LogRecord` をそのまま 1 行 1 JSON にする。時刻は Axiom が取り込み時に付ける(欄を足さない)
 * - **トークンは書き込み専用を前提にする** —— Axiom の Basic の API トークン(データセット単位・取り込み専用。作成後に権限を変えられない)。
 *   このトークンで読むことも消すこともできないので、侵入されて奪われても、過去のログを消されない
 *
 * 環境変数の名前はこの部品が決めない(製品の配線が読んで値を渡す。`axiomSinkFromValues`)。
 */

import { safeFetch } from '@kaninabe/runtime/http/safe-fetch';
import type { LogSink, LogSinkFailure, LogSinkResult } from '@kaninabe/runtime/log-sink';
import type { LogRecord } from '@kaninabe/runtime/ports';

/** 既定の取り込みのホスト(US。EU の組織は `api.eu.axiom.co`)。 */
export const AXIOM_DEFAULT_DOMAIN = 'api.axiom.co';

/** 1 回の取り込みの最大件数(Axiom の上限)。超えたら束を分けて送る。 */
export const AXIOM_MAX_BATCH = 10_000;

/** 既定の打ち切り時間(ミリ秒)。 */
export const AXIOM_DEFAULT_TIMEOUT_MS = 3000;

/** 取り込みのホストとして受け入れる形(`axiom.co` 配下のホスト名だけ。ポート・パス・資格情報を含められない)。 */
const DOMAIN_SHAPE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+axiom\.co$/u;

/** データセット名として受け入れる形。 */
const DATASET_SHAPE = /^[A-Za-z0-9_-]{1,128}$/u;

/** Axiom の送り先の設定。 */
export interface AxiomSinkOptions {
  /** API トークン(Basic・取り込み専用・そのデータセットだけ)。 */
  readonly token: string;
  /** 取り込み先のデータセット名。 */
  readonly dataset: string;
  /** 取り込みのホスト(省略は `api.axiom.co`)。 */
  readonly domain?: string;
  /** 打ち切り時間(ミリ秒。省略は 3000)。 */
  readonly timeoutMs?: number;
  /** `fetch` の差し替え口(省略は `safeFetch` = 転送について行かない)。テストが差し替える。 */
  readonly fetch?: typeof fetch;
}

/**
 * HTTP の状態を失敗の語に写す(2xx は成功)。
 *
 * @param status - 応答の状態コード
 * @returns 失敗の語。成功なら null
 */
function failureOfStatus(status: number): LogSinkFailure | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'rejected';
}

/**
 * 投げられたものを失敗の語に写す(打ち切り = timeout、それ以外 = network)。文言は読まない。
 *
 * @param error - `fetch` が投げたもの
 * @returns 失敗の語
 */
function failureOfThrown(error: unknown): LogSinkFailure {
  const name = error instanceof Error ? error.name : '';
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
}

/**
 * 1 回分(上限以内)の束を送る。
 *
 * @param url - 取り込みの URL
 * @param options - 設定
 * @param records - 送る行(上限以内)
 * @returns 結果(投げない)
 */
async function sendBatch(url: string, options: AxiomSinkOptions, records: readonly LogRecord[]): Promise<LogSinkResult> {
  const doFetch = options.fetch ?? safeFetch;
  try {
    const response = await doFetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/x-ndjson' },
      body: records.map((record) => JSON.stringify(record)).join('\n'),
      signal: AbortSignal.timeout(options.timeoutMs ?? AXIOM_DEFAULT_TIMEOUT_MS),
    });
    // 本文は読まない(中身を持ち出さない)。接続は返す。
    await response.body?.cancel().catch(() => undefined);
    const failure = failureOfStatus(response.status);
    return failure === null ? { ok: true } : { ok: false, reason: failure };
  } catch (error) {
    return { ok: false, reason: failureOfThrown(error) };
  }
}

/**
 * Axiom へ送る口を作る。
 *
 * @param options - トークン・データセット・(任意で)ホストと打ち切り時間
 * @returns 送り先(宛先の形が崩れていれば、送らずに `misconfigured` を返す口)
 */
export function createAxiomSink(options: AxiomSinkOptions): LogSink {
  const domain = options.domain ?? AXIOM_DEFAULT_DOMAIN;
  const valid = DOMAIN_SHAPE.test(domain) && DATASET_SHAPE.test(options.dataset) && options.token.trim() !== '';
  const url = `https://${domain}/v1/ingest/${options.dataset}`;
  return {
    send: async (records) => {
      if (!valid) return { ok: false, reason: 'misconfigured' };
      for (let start = 0; start < records.length; start += AXIOM_MAX_BATCH) {
        const result = await sendBatch(url, options, records.slice(start, start + AXIOM_MAX_BATCH));
        if (!result.ok) return result;
      }
      return { ok: true };
    },
  };
}

/** 製品の配線が環境から読んだ値(未設定は undefined)。 */
export interface AxiomEnvValues {
  /** API トークン。 */
  readonly token: string | undefined;
  /** データセット名。 */
  readonly dataset: string | undefined;
  /** 取り込みのホスト(省略可)。 */
  readonly domain: string | undefined;
}

/**
 * 環境から読んだ値で、送り先を作る(**オプトイン**)。
 *
 * トークンが空・未設定なら `null` を返す —— 送り先を持たず、これまでどおり標準出力だけで動く。トークンがあるのにデータセットが空の
 * ときは、黙って送らないのではなく `misconfigured` を返す口にする(設定の取り違えを失敗の 1 行で名指す)。
 *
 * @param values - 環境から読んだトークン・データセット・ホスト
 * @returns 送り先。トークンが無ければ null
 */
export function axiomSinkFromValues(values: AxiomEnvValues): LogSink | null {
  const token = values.token?.trim() ?? '';
  if (token === '') return null;
  const domain = values.domain?.trim();
  return createAxiomSink({
    token,
    dataset: values.dataset?.trim() ?? '',
    ...(domain === undefined || domain === '' ? {} : { domain }),
  });
}
