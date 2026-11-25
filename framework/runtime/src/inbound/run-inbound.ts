/**
 * **受信 Webhook の段取り**（生成された受信口が呼ぶ唯一の関数）。
 *
 * 仕様: docs/specs/backend/external.md（`direction: inbound` の行）
 * 規約: docs/rules/architecture/system/backend/ARCH-BE-0014-external-integration.md
 *       docs/rules/process/backend/specification/standards/external-spec-writing.md
 *       docs/rules/decisions/common/ADR-0011-usecase-layer-two-origins.md §4
 *
 * ## 判断はここに 1 つも無い
 *
 * 受信の並びは連携によらず同じである —— 本文を**上限までのバイト列のまま**読む → 署名を検証する →
 * 本文を解釈する → **記録と遷移を 1 回の RPC で起こす** → 結果を応答に写す。どの鍵で検証し、どの RPC を呼び出し、状態が合わなかった
 * ときに何を返すかは宣言（`signature` / `signature_key` / `emits` / `on_conflict`）から決まり、
 * 生成された配線（`src/composition/inbound/{連携}.ts`）が運んでくる。
 *
 * ## 署名はバイト列のまま検証する
 *
 * 相手が署名するのは送ったバイト列そのものである。文字列に復号してから検証すると、本文に不正な UTF-8 や BOM が
 * あるとき復号で中身が変わり、正しい署名が永久に合わない。だから検証はバイト列に対して行い、本文の解釈
 * （UTF-8 として読む）は検証が通ったあとにする。本文は上限（宣言の `max_body_bytes`）までしか読まない。
 *
 * ## 記録と遷移は同じトランザクションにある
 *
 * 受信で起きることは 2 つ —— 外部イベント ID を冪等に記録し、写像されたドメインイベントへ
 * 遷移する —— であり、この 2 つは**同じトランザクションでなければならない**。記録だけが成功
 * して遷移が落ちると、相手が再送しても記録済みのイベント ID が「反映済み」と判定されて
 * no-op になり、その通知は永久に失われるからである。生成された RPC
 * （`api.inbound_{連携}`、ADR-0011 §4 と同じ形）がその 1 トランザクションであり、この関数は
 * それを 1 回実行するだけである。
 *
 * ## 返す状態の決め方
 *
 * | 何が起きたか | 返す | なぜ |
 * |---|---|---|
 * | 本文が上限（`maxBodyBytes`）を超える | **413** | 署名を検証する前に閉じる（全部を読み切らない）。上限は宣言の値で、緩めるのは宣言だけ |
 * | 署名が合わない | **401** | 相手が誰か分からない。再送されても結果は変わらない |
 * | 本文を読めない | **400** | 契約違反であり、再送しても直らない |
 * | 記録も遷移も起こせた | **200** | |
 * | 同じ外部イベント ID が既にある | **200**（no-op） | 相手の再送は正常な動作である。2 度反映しない |
 * | 遷移が拒否された（状態が合わない） | **宣言どおり**（`on_conflict`） | 下記 |
 * | 不変条件に当たった | **500** | こちらのデータが宣言と食い違っている。黙って 2xx にしない |
 * | 通信の失敗・想定外の失敗 | **500**(`DbInfrastructureError` を投げる) | 書けたかどうかが分からない(`commit` が例外に残る)。相手の再送が再試行になり、記録と遷移は 1 トランザクションなので二重には起きない。単発・複合の実行器と同じ `settle` を通す |
 *
 * **遷移が拒否されたときの返し方だけは体系が決めない。** 相手に再送させたい（先に別の通知を
 * 処理しているだけで、いずれ整合する見込みがある）か、2xx で閉じたい（対象がすでにその状態へ
 * 進んでおり、再送しても結果が変わらない）かは、相手の再送の契約でしか決まらないためである。
 * 既定を持たず、`on_conflict` の宣言を必須にしてある。どちらの場合もトランザクションは
 * 丸ごと戻っているので、**外部イベント ID も記録されていない** —— 再送はそのまま再試行になる。
 */

import type { CommitOutcome, RpcReturn } from '../operation/ports';
import { settle } from '../operation/ports';
import { jsonResponse } from '../http/response.js';

/** 受信した本文から読み取れた中身（アダプタが本文の形を知っている唯一の場所）。 */
export interface InboundPayload {
  /** 相手が付けた外部イベント ID（冪等の鍵。記録先の一意制約に載る）。 */
  readonly eventId: string;
  /**
   * 受信の RPC に渡す本文（`{ record: {…}, target_id: "…" }`）。
   *
   * `record` は記録先の表に入れる欄、`target_id` は遷移の対象の id である。外部イベント ID の
   * 列は RPC が `p_event_id` から埋めるので、`record` に書かない（どの列かは宣言が決める）。
   */
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * 連携ごとのアダプタが実装する口（`external_spec` の `port`）。
 *
 * ここに残るのは**相手の本文の形**に依存する 2 つだけである —— 署名が載るヘッダの名前と、
 * 本文の読み取り。それ以外（鍵・起こすイベント・書き込み・HTTP の状態）は宣言から生成される。
 * **アダプタは 1 行も書き込まない** —— 書き込みは宣言された RPC 1 本だけを通る。
 */
export interface InboundReceiver {
  /** 署名が載るヘッダ名（相手の仕様。例: `x-signature`）。 */
  readonly signatureHeader: string;
  /**
   * 署名検証済みの本文を読む。
   *
   * @param body - 署名検証済みの本文を UTF-8 として読んだ文字列（先頭の BOM は落ち、不正なバイトは U+FFFD に置き換わる）
   * @returns 外部イベント ID と RPC に渡す本文。読めなければ null（400 になる）
   */
  read(body: string): InboundPayload | null;
  /**
   * 相手の SDK で署名を検証する（`signature: provider_sdk` の連携だけが実装する）。
   *
   * @param rawBody - 受信した本文のバイト列そのもの（復号する前）
   * @param presented - 相手が送ってきた署名
   * @returns 検証できたら true
   */
  verifySignature?(rawBody: Uint8Array, presented: string | null): boolean;
}

/** 遷移が拒否されたときの返し方（`external_spec` の `on_conflict`）。 */
export type InboundConflictReply = 'retry' | 'ack';

/** 生成された配線が組み立てる、この受信口 1 本分の宣言。 */
export interface InboundRoute {
  /** 連携 ID（`external_spec` の `id`。応答と例外に名前を残す）。 */
  readonly integration: string;
  /** 写像されたドメインイベント（`emits`）。 */
  readonly emits: string;
  /** 遷移が拒否されたときに相手へ返す形（`on_conflict`）。 */
  readonly onConflict: InboundConflictReply;
  /** 受け取る本文の大きさの上限（バイト。`external_spec` の `max_body_bytes`、宣言が無ければ小さめの既定）。 */
  readonly maxBodyBytes: number;
  /** 署名の検証（宣言された方式と鍵で閉じた関数。本文は受信したバイト列のまま渡る）。 */
  readonly verify: (rawBody: Uint8Array, presented: string | null) => boolean;
  /** 本文の読み取り（アダプタ）。 */
  readonly receiver: InboundReceiver;
  /** 記録と遷移を 1 トランザクションで起こす（生成された RPC を 1 回）。 */
  readonly apply: (
    eventId: string,
    payload: Readonly<Record<string, unknown>>,
  ) => Promise<CommitOutcome<RpcReturn>>;
}

/** 受信が起こせたときの結果(記録も遷移も起きた `applied` / 同じ外部イベント ID が既にあった `duplicate`)。 */
export type InboundApplied = 'applied' | 'duplicate';

/** 受信口が返す本文（相手のログに残るので、何が起きたかを語で残す）。 */
interface InboundBody {
  readonly status: InboundApplied | 'ignored';
  readonly integration: string;
  readonly emits: string;
}

/** 記録が一意制約に当たったことを RPC が返す語（生成された plpgsql と対の 1 語）。 */
const DUPLICATE = 'duplicate';

/**
 * 受信した 1 本を処理する。
 *
 * @param request - 受信口に届いたリクエスト（本文とヘッダだけを見る）
 * @param route - 宣言から生成された配線
 * @returns 413 / 401 / 400 / 200 / 5xx のいずれか（表は上の doc コメント）
 */
export async function runInbound(request: Request, route: InboundRoute): Promise<Response> {
  const rawBody = await readBounded(request, route.maxBodyBytes);
  if (rawBody === null) {
    return jsonResponse({ error: 'body_too_large', integration: route.integration }, { status: 413 });
  }
  const presented = request.headers.get(route.receiver.signatureHeader);
  if (!route.verify(rawBody, presented)) {
    return jsonResponse({ error: 'invalid_signature', integration: route.integration }, { status: 401 });
  }
  // 本文の解釈は検証が通ったあとだけ。先頭の BOM は落とし、不正なバイトは置き換える（読めるかはアダプタが決める）。
  const payload = route.receiver.read(new TextDecoder('utf-8').decode(rawBody));
  if (payload === null) {
    return jsonResponse({ error: 'unreadable_body', integration: route.integration }, { status: 400 });
  }
  const outcome = settle(route.integration, await route.apply(payload.eventId, payload.payload));
  if (outcome.kind === 'saved') return accepted(route, appliedOf(outcome.receipt.returned));
  if (outcome.kind === 'invariant_violated') {
    return jsonResponse(
      { error: 'invariant_violated', invariant: outcome.invariant, integration: route.integration },
      { status: 500 },
    );
  }
  // 状態が合わなかった。トランザクションは丸ごと戻っており、外部イベント ID も残っていない。
  if (route.onConflict === 'ack') return accepted(route, 'ignored');
  return jsonResponse({ error: 'conflict', integration: route.integration, emits: route.emits }, { status: 503 });
}

/**
 * 本文を上限までバイト列のまま読む。
 *
 * 宣言された長さ（`Content-Length`）が上限を超えていれば読まずに断り、宣言が無い・偽る相手には読みながら数えて
 * 上限を超えた時点で読むのをやめる（大きな本文を全部メモリに載せない）。
 *
 * @param request - 受信口に届いたリクエスト
 * @param limit - 受け取る本文の上限（バイト）
 * @returns 本文のバイト列。上限を超えたら null
 */
async function readBounded(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) return null;
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * RPC が返した本文を、受信の結果(`applied` / `duplicate`)に写す。
 *
 * 本文は文書 1 つ(`{ status: … }`)で、`status` が `duplicate` のときだけ重複である。
 * 読めない形(行の列・`status` の無い文書)は、記録も遷移も起きた `applied` として扱う ——
 * 型なしの読み取りを 1 か所に閉じ、HTTP の状態は変えない。
 *
 * @param rpcReturn - RPC が返した値(受領の戻り値の欄)
 * @returns 記録が一意制約に当たっていれば重複、そうでなければ反映済み
 */
function appliedOf(rpcReturn: RpcReturn): InboundApplied {
  if (rpcReturn.shape !== 'document') return 'applied';
  const document = rpcReturn.document;
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return 'applied';
  const status = (document as { readonly [key: string]: unknown })['status'];
  return status === DUPLICATE ? DUPLICATE : 'applied';
}

/**
 * 受け取り切ったことを 200 で返す。
 *
 * @param route - この受信口の宣言
 * @param status - 何が起きたか
 * @returns 200 の JSON 応答（中間のキャッシュに残させない）
 */
function accepted(route: InboundRoute, status: InboundBody['status']): Response {
  const body: InboundBody = { status, integration: route.integration, emits: route.emits };
  return jsonResponse(body, { headers: { 'Cache-Control': 'no-store' } });
}
