/**
 * 通知仕様検証(N 群)の実行口。
 *
 * ローダー(N0)が構築したカタログを検証器(N1 / N2)に流すところまでをまとめる。
 * 配線(lib/compose/verify-pipeline.ts)はこの 1 関数だけを呼べばよく、検証器が増えてもここも CLI も変わらない
 * (規約: scripts-code-quality.md)。チェック内容の正は notification-spec-writing.md。
 */

import type { SpecModel } from '../model/types.js';
import type { Finding } from '../kernel/finding.js';
import type { CatalogInput } from '../kernel/input-state.js';
import type { JobCatalogSpec } from '../model/job/types.js';
import type { NotificationSpecModel } from '../model/notification/types.js';
import { NOTIFICATION_STEPS } from './checks.js';
import type { ProductRoots } from '../model/product/types.js';

/** runNotificationVerification の入力。 */
export interface NotificationRunInput {
  /** 構築済みのドメイン仕様モデル(effects の出どころ)。 */
  readonly domain: SpecModel;
  /** 読み込み済みの通知カタログ(N0 はローダーが済ませてある)。 */
  readonly notifications: NotificationSpecModel;
  /**
   * ジョブカタログの**入力の状態**(走査の `emits` = 通知の発火元の 3 つ目の出どころ)。未選択は走査が事実として無い・読込済みは走査の一覧。
   * **阻害**(採ったのに読めない・読めずに落とした job がある)のとき、走査の `emits` に依る判定(`schedule` の行を積む走査があるか・`emits` の突合・
   * `person_from` の走査の集約との一致)は出さない(欠けたモデルで「走査の emits がありません」と言うと偽の error になる。行は呼び手が言う)。
   * 任意の欄ではなく**必須**。
   */
  readonly jobs: CatalogInput<JobCatalogSpec>;
  /** 製品が宣言した根(道案内のパスを組み立てる)。 */
  readonly roots: ProductRoots;
}

/** runNotificationVerification の結果。 */
export interface NotificationRunResult {
  readonly findings: Finding[];
  /** カタログがあったか。false なら N1 は実行していない。 */
  readonly available: boolean;
  /** 読み込めた通知の件数(CLI のサマリ表示用)。 */
  readonly notificationCount: number;
}

/**
 * 通知カタログの検証(N1)を実行する。
 *
 * カタログが無い環境では検証をスキップし、その旨を報告できる形で返す
 * (通知仕様をまだ開設していないリポジトリでも壊れない)。
 *
 * @param input ドメインモデルと通知カタログ
 * @returns 全 Finding と、どこまで実行できたかの情報
 */
export function runNotificationVerification(input: NotificationRunInput): NotificationRunResult {
  if (!input.notifications.available) return { findings: [], available: false, notificationCount: 0 };
  return {
    findings: NOTIFICATION_STEPS.flatMap((step) => step.run(input)),
    available: true,
    notificationCount: input.notifications.catalog?.notifications.length ?? 0,
  };
}
