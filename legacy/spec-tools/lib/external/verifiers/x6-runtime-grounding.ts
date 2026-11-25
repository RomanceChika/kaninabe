/**
 * X6 実行時の約束の接地チェック(`timeout_ms` / `retry_max` / `idempotency_source`)。
 *
 * **なぜこの検査が要るのか。** この 3 軸は束 ⑳ 以前、パーサが形を見るだけで、以後どこも
 * 読んでいなかった(検査の漏れ探し 2026-09-12 §1 の実測: `timeout_ms: 5000 → 1` に書き換えても
 * `verify` はエラー 0 / 警告 25 のまま。`retry_max` の grep はパース 3 行だけ。
 * `idempotency` は自由文で、「outbox の job id を Webhook の冪等キーにする」と書いてあるのに
 * 実装は冪等キーを 1 度も相手へ渡していなかった)。宣言できるのに誰も見ない軸は、
 * **書いてあることが嘘でも緑**になる。
 *
 * 3 段で見る(どれも `app/` が実在する環境でだけ成立する。X1 と同じ扱い)。
 *
 *   (a) `timeout_ms` を持つ行のアダプタが、生成物(`external-expectations.ts`)から
 *       自分の行の待ち時間を読んでいること。生の数値で待ち時間を書いていないこと
 *       (`AbortSignal.timeout(5000)` のような直書きは error)。
 *   (b) `retry: inline` の行のアダプタが、同じ生成物から `retryMax` を読んでいること。
 *   (c) `idempotency_source` の値ごとに接地先が実在すること。
 *         - `external_key` … アダプタが冪等キーを受け取って相手へ渡している
 *           (`idempotencyKey` の識別子がアダプタに現れる)
 *         - `local_ledger` … こちら側に**送信済み / 処理済みを覚えている台帳**が実在する。
 *           inbound は `event_id_table`(= 外部イベント ID の一意制約)の宣言、outbound は
 *           **アダプタが台帳(`ledger`)を引いていること**。outbound の条件が
 *           「`retry: job`」でないのは、outbox の job 行が防ぐのは**同じ行を 2 つのワーカーが
 *           同時に掴むこと**までで、送信後にタイムアウトして失敗と記録された配信の**再送**は
 *           防がないからである(独立レビュー 束 ㉑ の 4-B)。`retry: job` を条件にすると、
 *           **二重反映を生む当の仕組みがあること**が「防いでいる」証拠になってしまう
 *         - `none` … 何も要求しない(`idempotency_reason` の必須は X0 = パーサ段が見る)
 *
 * **なぜアダプタのソースを文字列で見るのか。** K1(config の `process.env` 走査)・
 * A11(operation の閉世界)と同じ「実装のソースを読んで宣言と突き合わせる」形であり、
 * この体系で確立した接地のやり方である。型で縛る道(生成した型を実装が実装する)は
 * `timeout_ms` のような**値**には効かない —— 値は型の外側で写し間違えられる。
 *
 * **ソースは必ず `maskCode` を通してから見る**(独立レビュー 束 ㉑ の 4-A)。生のまま
 * `includes` すると**コメントの中の字面**が実装として数えられ、
 * `// 正は EXTERNAL_EXPECTATIONS.discord_webhook.timeoutMs` と書いて実装を生の数値に
 * 戻す、という抜けが実測された。この束が導入した書き方(doc コメントに正の住所を書く)
 * そのものが検査を無力化する形だったので、前処理を A16 と共有する。
 *
 * **生の数値の検出は下限である。** `RAW_TIMEOUT` が見るのは `AbortSignal.timeout(5000)` の
 * 形だけで、`setTimeout(() => controller.abort(), 5000)` のような書き方は見ていない。
 * (a) の本体は「生成物から読んでいること」の方であり、こちらは分かりやすい書き戻しを
 * 捕まえる補助である。
 */

import path from 'node:path';
import { appGrounded, isFile } from '../../io/paths.js';
import { tryReadText } from '../../io/read-text.js';
import { maskCode } from '../../io/mask-code.js';
import type { Finding } from '../../kernel/finding.js';
import type { ExternalCatalogSpec, IntegrationDecl } from '../../model/external/types.js';
import type { ProductRoots } from '../../model/product/types.js';
import { generatedModuleOf } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'X6';

/** X6 の指摘を組み立てる。 */
function x6(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** 生成物が export する期待表の名前(アダプタはこれを読む)。 */
const EXPECTATIONS_SYMBOL = 'EXTERNAL_EXPECTATIONS';

/** 冪等キーの受け渡しを表す実装側の識別子(`external_key` の接地先)。 */
const IDEMPOTENCY_KEY_SYMBOL = 'idempotencyKey';

/**
 * 送信済みを覚えている台帳を表す実装側の識別子(outbound の `local_ledger` の接地先)。
 *
 * 大文字小文字を無視した部分一致である(`deliveryLedger` / `sent_ledger` のどちらも拾う)。
 * 接地の判定は下限であり、「台帳という名前のものを引いている」ところまでしか見ない。
 */
const LEDGER_SYMBOL = /ledger/i;

/** 生の数値で待ち時間を書いている形(`AbortSignal.timeout(5000)` / `abortSignal: …(5_000)`)。 */
const RAW_TIMEOUT = /AbortSignal\s*\.\s*timeout\s*\(\s*[0-9][0-9_]*\s*\)/;

/** X6 の入力。 */
export interface RuntimeGroundingInput {
  /** 読み込み済みの外部連携カタログ。 */
  readonly catalog: ExternalCatalogSpec;
  /** リポジトリルートの絶対パス(アダプタの実装を読む)。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(実装の木の位置)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(提案の文面が示す、生成物の import の指定を引く。アプリの枠の後段が与える)。 */
  readonly layout: ProductLayout;
}

/**
 * 実行時の約束の接地を検証する。
 *
 * `app/` を読めない構成(仕様だけを持つリポジトリ)では 3 段そろって飛ばす
 * —— 仕様と実装の突合であり、仕様だけの検査ではない(X1 と同じ扱い)。
 *
 * @param input 外部連携カタログとリポジトリルート
 * @returns 違反のリスト
 */
export function verifyRuntimeGrounding(input: RuntimeGroundingInput): Finding[] {
  if (!appGrounded(input.repoRoot, input.roots.app)) return [];
  return input.catalog.integrations.flatMap((integration) =>
    checkIntegration(integration, input.repoRoot, expectationsImportOf(input)),
  );
}

/**
 * 提案の文面に載せる、期待表の import の言い方(生成物の指定は置き場の配置が決める。決められないときは生成物の名前で言う)。
 * 提案の文面だけに使い、判定には使わない。
 */
function expectationsImportOf(input: RuntimeGroundingInput): string {
  const module = generatedModuleOf(input.layout, input.roots, 'external-expectations');
  return module === null
    ? `生成物 external-expectations から \`${EXPECTATIONS_SYMBOL}\` を import`
    : `\`import { ${EXPECTATIONS_SYMBOL} } from '${module}'\``;
}

/** 連携 1 件の 3 段を見る。アダプタが読めない行は X1 の担当なので黙る。 */
function checkIntegration(integration: IntegrationDecl, repoRoot: string, importFrom: string): Finding[] {
  const source = readAdapter(integration, repoRoot);
  if (source === null) return checkIdempotency(integration, null);
  return [
    ...checkTimeout(integration, source, importFrom),
    ...checkRetryMax(integration, source),
    ...checkIdempotency(integration, source),
  ];
}

/**
 * アダプタの中身を読む。存在しない・読めない場合は null(実在は X1 が見る)。
 *
 * **コメントと文字列は潰してから返す** —— 接地は実装にだけ数える(4-A)。
 */
function readAdapter(integration: IntegrationDecl, repoRoot: string): string | null {
  const absolute = path.join(repoRoot, integration.adapter);
  if (!isFile(absolute)) return null;
  const text = tryReadText(absolute);
  return text === null ? null : maskCode(text);
}

/** その行の期待値をアダプタが生成物から読んでいるか。 */
function readsExpectation(source: string, integration: IntegrationDecl, field: string): boolean {
  return (
    source.includes(EXPECTATIONS_SYMBOL) &&
    source.includes(integration.id) &&
    source.includes(field)
  );
}

/** (a) 待ち時間の接地。 */
function checkTimeout(integration: IntegrationDecl, source: string, importFrom: string): Finding[] {
  if (integration.direction !== 'outbound' || integration.timeoutMs === undefined) return [];
  const findings: Finding[] = [];
  if (!readsExpectation(source, integration, 'timeoutMs')) {
    findings.push(
      x6({
        message:
          `連携 ${integration.id} の timeout_ms(${integration.timeoutMs}ms)を読んでいる実装がありません` +
          `(${integration.adapter} が ${EXPECTATIONS_SYMBOL} から読んでいない)`,
        location: integration.location,
        suggestion:
          `アダプタで ${importFrom} し、` +
          `\`${EXPECTATIONS_SYMBOL}.${integration.id}.timeoutMs\` を待ち時間に使う(同じ数値を実装へ書き写さない)`,
        counterexample: { integration: integration.id, adapter: integration.adapter },
      }),
    );
  }
  if (RAW_TIMEOUT.test(source)) {
    findings.push(
      x6({
        message: `${integration.adapter} が待ち時間を生の数値で書いています(宣言した timeout_ms が効かない)`,
        location: integration.location,
        suggestion: `数値を消し、\`${EXPECTATIONS_SYMBOL}.${integration.id}.timeoutMs\` を渡す`,
        counterexample: { integration: integration.id, adapter: integration.adapter },
      }),
    );
  }
  return findings;
}

/** (b) 有限回の再試行の上限の接地。 */
function checkRetryMax(integration: IntegrationDecl, source: string): Finding[] {
  if (integration.retryMax === undefined) return [];
  if (readsExpectation(source, integration, 'retryMax')) return [];
  return [
    x6({
      message:
        `連携 ${integration.id} の retry_max(${integration.retryMax} 回)を読んでいる実装がありません` +
        `(${integration.adapter} が ${EXPECTATIONS_SYMBOL} から読んでいない)`,
      location: integration.location,
      suggestion: `アダプタで \`${EXPECTATIONS_SYMBOL}.${integration.id}.retryMax\` を再試行の上限に使う`,
      counterexample: { integration: integration.id, adapter: integration.adapter },
    }),
  ];
}

/** (c) 二重反映を防ぐ源の接地。 */
function checkIdempotency(integration: IntegrationDecl, source: string | null): Finding[] {
  if (integration.idempotencySource === 'external_key') {
    if (source !== null && source.includes(IDEMPOTENCY_KEY_SYMBOL)) return [];
    return [
      x6({
        message:
          `連携 ${integration.id} は idempotency_source: external_key(相手に冪等キーを渡す)と宣言していますが、` +
          `${integration.adapter} に冪等キーの受け渡し(${IDEMPOTENCY_KEY_SYMBOL})がありません`,
        location: integration.location,
        suggestion:
          'アダプタが冪等キーを受け取って相手へ渡すようにするか、実態に合わせて ' +
          'idempotency_source を local_ledger / none に直す(none は理由が必須)',
        counterexample: { integration: integration.id, adapter: integration.adapter },
      }),
    ];
  }
  if (integration.idempotencySource === 'local_ledger') return checkLocalLedger(integration, source);
  return [];
}

/**
 * `local_ledger` の接地先(inbound = 外部イベント ID の表 / outbound = アダプタが引く台帳)。
 *
 * 受信の行は `event_id_table` を型で必ず持つ(読み込みの段が欠けた行を落とす)ので、ここで見るのは送信の行の台帳だけである。
 * 表の実在と一意索引は X5 が見る。
 */
function checkLocalLedger(integration: IntegrationDecl, source: string | null): Finding[] {
  if (integration.direction === 'inbound') return [];
  if (source !== null && LEDGER_SYMBOL.test(source)) return [];
  return [
    x6({
      message:
        `連携 ${integration.id} は idempotency_source: local_ledger ですが、${integration.adapter} に` +
        '送信済みを覚えている台帳(ledger)がありません' +
        '(outbox の job 行が防ぐのは同じ行の同時実行までで、失敗と記録された配信の再送は防がない)',
      location: integration.location,
      suggestion:
        '送信済みの鍵を残す台帳をアダプタが引く形にするか、実態に合わせて idempotency_source を ' +
        'external_key / none に直す(none は理由が必須。再送のある経路で none を選ぶなら、' +
        '同じ知らせが二度届きうることを idempotency_reason に書く)',
      counterexample: { integration: integration.id, adapter: integration.adapter, retry: integration.retry },
    }),
  ];
}
