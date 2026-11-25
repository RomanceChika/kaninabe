/**
 * ハンドブック(製品の仕様書)の「自動で起きるか」の判定 — 遷移ごとの発火元と、そこから決まる自動の種類。
 *
 * 設計メモ `docs/design/book-as-spec/plan-generator.md` §4。判定は遷移の事実に 1 度だけ持ち、本文・図の辺・
 * 図の説明・灰色の行・できることのシステムの行が全部これを読む(試作は時刻起点のジョブしか見ておらず、
 * サインイン時の実行と受信 Webhook を取りこぼしていた)。
 *
 * 人の操作なしに遷移を起こす**発火元は 3 種類**で、新しい宣言は要らない:
 *
 * | 発火元 | 宣言の場所 |
 * |---|---|
 * | 時刻起点のジョブ | ジョブのカタログの `schedule.fires` |
 * | サインイン時の実行 | 認証フローの `sign_in[].runs` |
 * | 受信 Webhook | 外部連携のカタログの `direction: inbound` の `emits` |
 *
 * outbox のジョブと手で起こすジョブは遷移を起こさない(遷移の結果として「同時に起きること」)ので数えない。
 * 画面の `emits` は人の操作なので発火元ではない。
 *
 * | `by` に system | 発火元 | 判定 |
 * |---|---|---|
 * | なし | なし | `manual` |
 * | なし | あり | `origin-without-permission`(矛盾。読む側が灰色の行と指摘に出す) |
 * | あり(system だけ) | あり | `auto-only` |
 * | あり(人の役もいる) | あり | `auto-or-manual` |
 * | あり | なし | `system-unwired`(「自動」と書かない) |
 * | あり | 読めなかった種類がある・結線済みの発火元が無い | `unverified`(「自動」とも「未結線」とも言わない) |
 *
 * 「発火元あり」に数えるのは**結線済み**の発火元だけである: Cron に結線していない時刻起点のジョブ(`scheduled: false`)は
 * 宣言の候補として持つが、それだけでは「自動」にしない(`system-unwired`)。by に system が無いときの矛盾の判定は、
 * 未結線のジョブも含めて見る(宣言どうしの食い違いなので)。判定は**宣言の上の結線**であって、実際に発火すること・
 * 届くこと・本番に配備されていることは保証しない(外部レビュー の P2 / Q4)。
 *
 * 発火元の並びは入力の順に依らない(種類の順 → ID の昇順)。純粋関数だけ。**アプリの語彙は 1 語も持たない。**
 */

import type { AuthFlowSpec } from '../../model/auth/types.js';
import type { IntegrationDecl } from '../../model/external/types.js';
import type { JobDecl } from '../../model/job/types.js';
import { systemRoleId } from '../../model/role-hierarchy.js';
import type { SpecModel } from '../../model/types.js';

/** 状態機械をまたいで遷移を指すキー `{状態機械}.{イベント}`(集約名ではない。1 つの集約が 2 本の状態機械を持ちうる)。 */
export type EventKey = string;

/** 遷移のキーを作る。 */
export function eventKey(machine: string, event: string): EventKey {
  return `${machine}.${event}`;
}

/** 発火元 1 つ。 */
export type EventOrigin =
  /** 時刻起点のジョブ。`scheduled` は Cron に結線済みか(偽 = `cron` の代わりに理由を持つ)。 */
  | { readonly kind: 'job'; readonly id: string; readonly scheduled: boolean }
  /** サインイン時の分岐の行。 */
  | { readonly kind: 'sign_in'; readonly id: string }
  /** 受信 Webhook の連携。 */
  | { readonly kind: 'inbound'; readonly id: string };

/** 遷移が自動で起きるかの判定。表は冒頭の JSDoc。 */
export type Autonomy = 'manual' | 'auto-only' | 'auto-or-manual' | 'system-unwired' | 'origin-without-permission' | 'unverified';

/** 発火元の宣言の種類。 */
export type OriginSource = 'jobs' | 'auth' | 'external';

/**
 * 発火元を集める入力。採っていない種類は空で渡す。**採ったのに読めなかった種類**は `unread` に名指す
 * (空の配列に落とすと、発火元が無いのか見ていないのかを区別できない)。
 */
export interface EventOriginsInput {
  readonly jobs: readonly JobDecl[];
  readonly auth: AuthFlowSpec | null;
  readonly integrations: readonly IntegrationDecl[];
  readonly unread: readonly OriginSource[];
}

/** 発火元の集計: 遷移のキー → 発火元(種類の順 → ID の昇順)と、実在しない遷移を名指した発火元。 */
export interface EventOrigins {
  readonly byEvent: ReadonlyMap<EventKey, readonly EventOrigin[]>;
  /** 名指した遷移がモデルに無い発火元(キーの昇順)。 */
  readonly dangling: readonly { readonly key: EventKey; readonly origin: EventOrigin }[];
  /** 読めなかった発火元の宣言の種類(入力のまま。昇順)。空でなければ「発火元が無い」とは言えない。 */
  readonly unread: readonly OriginSource[];
}

const KIND_ORDER: Readonly<Record<EventOrigin['kind'], number>> = { job: 0, sign_in: 1, inbound: 2 };

function compareOrigins(a: EventOrigin, b: EventOrigin): number {
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** 宣言から (遷移のキー, 発火元) の対を全部挙げる。 */
function originPairs(input: EventOriginsInput): { key: EventKey; origin: EventOrigin }[] {
  const pairs: { key: EventKey; origin: EventOrigin }[] = [];
  for (const job of input.jobs) {
    const fires = job.schedule?.fires;
    if (fires !== undefined) pairs.push({ key: fires, origin: { kind: 'job', id: job.id, scheduled: job.schedule?.cron !== undefined } });
  }
  for (const branch of input.auth?.branches ?? []) {
    // 1 つの行が同じ遷移を 2 度名指しても発火元は 1 つ。
    for (const key of new Set(branch.runs)) pairs.push({ key, origin: { kind: 'sign_in', id: branch.id } });
  }
  for (const integration of input.integrations) {
    if (integration.direction === 'inbound') pairs.push({ key: integration.emits, origin: { kind: 'inbound', id: integration.id } });
  }
  return pairs;
}

/** モデルに実在する遷移のキーの全数。 */
function knownEvents(model: SpecModel): ReadonlySet<EventKey> {
  const keys = new Set<EventKey>();
  for (const specs of model.aggregates.values()) {
    for (const machine of specs.stateMachines) for (const event of machine.events) keys.add(eventKey(machine.machine, event.id));
  }
  return keys;
}

/** 遷移ごとの発火元を集める。 */
export function collectEventOrigins(model: SpecModel, input: EventOriginsInput): EventOrigins {
  const known = knownEvents(model);
  const byEvent = new Map<EventKey, EventOrigin[]>();
  const dangling: { key: EventKey; origin: EventOrigin }[] = [];
  for (const pair of originPairs(input)) {
    if (!known.has(pair.key)) {
      dangling.push(pair);
      continue;
    }
    const list = byEvent.get(pair.key) ?? [];
    list.push(pair.origin);
    byEvent.set(pair.key, list);
  }
  for (const list of byEvent.values()) list.sort(compareOrigins);
  dangling.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : compareOrigins(a.origin, b.origin)));
  return { byEvent, dangling, unread: [...new Set(input.unread)].sort() };
}

/** 「自動」の根拠になる、結線済みの発火元か(Cron に結線していないジョブは候補にとどまる)。 */
function isWired(origin: EventOrigin): boolean {
  return origin.kind !== 'job' || origin.scheduled;
}

/**
 * 遷移 1 本の自動の判定。`by` は遷移の実行を許す役、`origins` はその遷移の発火元(`collectEventOrigins` の結果)、
 * `unread` は読めなかった発火元の宣言の種類。
 */
export function judgeAutonomy(
  model: SpecModel,
  by: readonly string[],
  origins: readonly EventOrigin[],
  unread: readonly OriginSource[] = [],
): Autonomy {
  const system = systemRoleId(model.roles.roles);
  const bySystem = system !== undefined && by.includes(system);
  if (!bySystem) return origins.length === 0 ? 'manual' : 'origin-without-permission';
  if (origins.some(isWired)) return by.every((role) => role === system) ? 'auto-only' : 'auto-or-manual';
  return unread.length > 0 ? 'unverified' : 'system-unwired';
}
