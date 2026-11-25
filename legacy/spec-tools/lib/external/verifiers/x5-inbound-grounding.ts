/**
 * X5 受信の軸の接地(`direction: inbound` の行だけが対象)。
 *
 * 受信 Webhook は「外の誰かが、こちらの口を叩いてドメインイベントを起こす」経路である。
 * 宣言だけを増やさないために、それぞれの軸を**実在する別の宣言**に接地させる。
 *
 *   - (a) 記録と遷移が**1 つの RPC に接地する**こと —— `event_id_table` が実在し、外部イベント
 *     ID を載せる単一列の一意索引をちょうど 1 本持ち、その表の作成 RPC と `emits` の遷移 RPC の
 *     引数が宣言だけで決まること(接地の実体は `inbound-plan.ts`。生成器が同じ関数を使う)
 *   - (b) `emits` が `by` に `system` を含むこと —— 人の入口から実行できるイベントを外の誰かに
 *     実行させない
 *   - (c) 署名を検証する行(`signature != none`)は `degrade: refuse` であること ——
 *     鍵が無い環境で「縮退して受け付ける」は、署名検証を宣言している意味を消す
 *     (PRIN-0009。既定を閉じる側に倒す)
 *   - (d) `signature_key` が `config` に並んでいる id を指すこと —— 鍵は位置ではなく名前で
 *     決まる。ここが接地していないと、生成された受信口は存在しない環境変数を読んで**常に 401**
 *     になる(そして verify は緑のままである)
 *   - (e) `migration` が全連携で一意であること —— 2 本の受信が同じファイルを取り合わない
 *
 * **`emits` は第 3 の発火元である。** screen_spec の `emits`(人が押す)/ action_spec の
 * `scans`(時刻で起きる)と並び、「外から届いて起きる」をここが宣言する。A10(走査の網羅)は
 * この宣言をもって充足とみなす —— 意味の合わない器(`unscanned` の免除)を借りなくてよい。
 *
 * **action_spec は要求しない。** `by` が system だけのイベントは Server Action の入口を持たない
 * (action-spec-writing.md §system が起こすイベント / actions/README.md)。受信口は実行計画ではなく
 * 生成された受信の RPC を 1 回呼び出すので、計画の出どころも要らない。
 */

import type { SpecModel } from '../../model/types.js';
import { systemRoleId } from '../../model/role-hierarchy.js';
import type { DataTableSpecModel } from '../../model/data/types.js';
import type { Finding } from '../../kernel/finding.js';
import { inputValue, unusableOf, type CatalogInput, type InputGapNote } from '../../kernel/input-state.js';
import { planInbound } from '../../inbound/inbound-plan.js';
import type { ExternalCatalogSpec, InboundIntegrationDecl } from '../../model/external/types.js';
import { isInbound } from '../../model/external/types.js';
import type { ProductRoots } from '../../model/product/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'X5';

/** X5 の指摘を組み立てる。 */
function x5(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** X5 の入力。 */
export interface InboundGroundingInput {
  readonly domain: SpecModel;
  readonly catalog: ExternalCatalogSpec;
  /**
   * テーブル仕様の**入力の状態**((a) が RPC を引く。**必須**)。
   *
   * 受信の記録と遷移を 1 トランザクションで起こす RPC は data_table にしか無い。受信の連携があるのに `data_tables` を採っていない食い違いは、
   * 宣言の段で P2 が止める(`SPEC_KIND_REQUIREMENTS`)。**使えない(未選択も阻害も)とき (a) の判定を出さず**、
   * 見ていないことを `inboundGroundingGaps` が受信の連携を名指して返す(母集合は受信の連携で、data_table は裏づけを見る先なので、
   * 未選択も「見られない」)。(b)〜(e) は data_table に依らないので従来どおり。
   */
  readonly dataTables: CatalogInput<DataTableSpecModel>;
  /** 製品が宣言した根(道案内のパスを組み立てる)。 */
  readonly roots: ProductRoots;
}

/**
 * 受信の連携の軸が実在の宣言に接地しているかを検証する。
 *
 * @param input ドメインモデル・カタログ・data_table
 * @returns 違反のリスト
 */
export function verifyInboundGrounding(input: InboundGroundingInput): Finding[] {
  const inbound = input.catalog.integrations.filter(isInbound);
  return [
    ...inbound.flatMap((integration) => [
      ...checkPlan(integration, input),
      ...checkSystemRole(integration, input.domain),
      ...checkSignatureDegrade(integration),
      ...checkSignatureKey(integration),
    ]),
    ...checkMigrations(inbound),
  ];
}

/**
 * テーブル仕様が使えないために、(a) が判定を出さなかった受信の連携の記録(使えるとき・受信が 0 件のときは空)。
 *
 * @param input X5 の入力
 */
export function inboundGroundingGaps(input: InboundGroundingInput): readonly InputGapNote[] {
  const gap = unusableOf(input.dataTables, 'data_tables');
  const subjects = input.catalog.integrations.filter(isInbound).map((integration) => integration.id);
  if (gap === null || subjects.length === 0) return [];
  return [{ gap, consequence: '記録と遷移が 1 つの RPC に接地することは見ていません', subjects }];
}

/** (a) 記録と遷移が 1 つの RPC に接地すること(生成器と同じ導出で見る)。 */
function checkPlan(integration: InboundIntegrationDecl, input: InboundGroundingInput): Finding[] {
  const dataTables = inputValue(input.dataTables);
  if (dataTables === undefined) return [];
  const planned = planInbound(integration, { domain: input.domain, dataTables, roots: input.roots });
  if (planned.ok) return [];
  return planned.problems.map((problem) =>
    x5({
      message: problem.message,
      location: integration.location,
      suggestion: problem.suggestion,
      counterexample: problem.counterexample,
    }),
  );
}

/**
 * (b) `by` にシステムのロールが並んでいること(人の入口から実行できるイベントを外の誰かに起こさせない)。
 *
 * ロールの id は仕様が宣言する語なので、`kind: system` のロールを引いて使う
 * (仕組み側のコードに `'system'` と書かない —— W1)。宣言が無い体系では判定できないので飛ばす。
 */
function checkSystemRole(integration: InboundIntegrationDecl, domain: SpecModel): Finding[] {
  const emits = integration.emits;
  const systemRole = systemRoleId(domain.roles.roles);
  if (systemRole === undefined) return [];
  const [machineName = '', eventId = ''] = emits.split('.');
  for (const specs of domain.aggregates.values()) {
    for (const machine of specs.stateMachines) {
      if (machine.machine !== machineName) continue;
      const event = machine.events.find((candidate) => candidate.id === eventId);
      if (event === undefined || event.by.includes(systemRole)) continue;
      return [
        x5({
          message: `連携 ${integration.id} が emits する ${emits} の by に ${systemRole} がありません`,
          location: integration.location,
          suggestion:
            `states.md の ${emits} の by に ${systemRole} を足すか、外から起こしてよい別のイベントを emits に書く。` +
            '外から届く口には人のセッションが無いので、実行者はシステムのロールにしか解決されない',
          counterexample: { integration: integration.id, emits, by: event.by.join(', ') },
        }),
      ];
    }
  }
  return [];
}

/** (c) 署名を検証する行は、鍵が無い環境で口を閉じること。 */
function checkSignatureDegrade(integration: InboundIntegrationDecl): Finding[] {
  if (integration.signature === 'none') return [];
  if (integration.degrade === 'refuse') return [];
  return [
    x5({
      message: `連携 ${integration.id} は signature: ${integration.signature} なのに degrade: ${integration.degrade} です`,
      location: integration.location,
      suggestion:
        'degrade: refuse に直す(鍵が無い環境では受信口を閉じる)。鍵が無くても受け付けてよい口なら' +
        'signature: none と理由(signature_reason)を宣言する —— 「検証すると書いてあるのに鍵が無ければ素通し」が一番危ない',
      counterexample: { integration: integration.id, signature: integration.signature, degrade: integration.degrade },
    }),
  ];
}

/** (d) 署名の鍵は `config` に並んでいる id を**名前で**指すこと。 */
function checkSignatureKey(integration: InboundIntegrationDecl): Finding[] {
  if (integration.signature === 'none') return [];
  const key = integration.signatureKey;
  if (integration.config.includes(key)) return [];
  return [
    x5({
      message: `連携 ${integration.id} の signature_key ${key} が config に並んでいません`,
      location: integration.location,
      suggestion:
        `config に ${key} を足すか、signature_key を config の id(${integration.config.join(' / ') || '(空)'})の` +
        'いずれかに直す。接地していない鍵を宣言すると、生成された受信口は存在しない設定を読んで常に 401 になる',
      counterexample: { integration: integration.id, signature_key: key, config: integration.config.join(', ') },
    }),
  ];
}

/** (e) `migration` が全連携で一意であること(2 本の受信が同じファイルを取り合わない)。 */
function checkMigrations(inbound: readonly InboundIntegrationDecl[]): Finding[] {
  const seen = new Map<string, string>();
  const findings: Finding[] = [];
  for (const integration of inbound) {
    const migration = integration.migration;
    const first = seen.get(migration);
    if (first !== undefined) {
      findings.push(
        x5({
          message: `連携 ${integration.id} の migration ${migration} が ${first} と重複しています`,
          location: integration.location,
          suggestion: '受信 1 本につき migration 1 本にする(生成器は同じファイルを 2 度書けない)',
          counterexample: { integration: integration.id, migration, first },
        }),
      );
      continue;
    }
    seen.set(migration, integration.id);
  }
  return findings;
}
