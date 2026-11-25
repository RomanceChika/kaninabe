/**
 * 操作の属性の導出が読む、ドメイン仕様の外側のカタログ(意味解析の層の入力)。
 *
 * 操作の属性(`deriveOperationAttributes`)は state_spec / access_spec / role_spec だけでは決まらず、
 * 「この遷移が呼ぶジョブは何者か(job_spec)」「その通知はどこへ出るか(notification_spec)」
 * 「同じトランザクションで他の表も書くか(data_table)」を要る。検証(Y5)も生成(画面・文書)も
 * **同じカタログを同じ形で**渡すために、ここで入力の形を 1 つに決める。`GenerateContext` は
 * この形を満たす(欄の名前と型が同じ)ので、生成側はそのまま渡せる。
 *
 * 欄はどれも省略できる。**採っていない**(`available: false`。置き場が無い)は事実として扱い、その事実だけが
 * 見えなくなる(外へ出る効果)。**見えない事実を別の近似で補わない**。ただし連鎖(同じトランザクションで他の行に
 * 及ぶ書き込み)は安全の表示の材料なので、**省略(渡されない)・読めない**ときは「無い」と読まず、未検査として
 * 破壊的とみなす(`operation-cascade.ts`。根拠の行に未検査の理由が名指しで出る)。
 *
 * **省略は「採っていない」と「採ったのに読めない」を区別しない**ので、この型を渡す呼び手(検査の配線)は、カタログの入力の状態
 * (未選択 / 阻害 / 読込済み)を別に持ち、阻害を検査ごとに名指す(`verify/operation-input-notes.ts`)。読めた分で導出する。
 */

import type { DataTableSpecModel } from '../model/data/types.js';
import type { JobDecl, JobSpecModel } from '../model/job/types.js';
import type { NotificationSpecModel } from '../model/notification/types.js';

/** 操作の属性の導出に渡す、カタログ 3 種。 */
export interface OperationCatalogs {
  /** テーブル仕様(複合 RPC の `also_writes` = 連鎖の材料)。 */
  readonly dataTables?: DataTableSpecModel;
  /** 通知カタログ(宛先の種別 = 外へ出る効果の材料)。 */
  readonly notifications?: NotificationSpecModel;
  /** ジョブカタログ(ジョブの種類 = 書き込みと同じトランザクションか)。 */
  readonly jobs?: JobSpecModel;
}

/**
 * そのジョブは書き込みと同じトランザクションで実現される(キューに積まれない)種類か。
 *
 * 当たるのは、`kind` の語が **`in_transaction` を宣言している行**(`JobDecl.inTransaction`。語の宣言を
 * パーサーが行へ写したもの)と、**匿名化する効果の宣言(`anonymizes`)・セッションを終える効果の宣言(`ends_sessions`)を持つ行**である。いずれも
 * **語を比べない** —— 機械が読む軸は宣言であり、語(「同一トランザクションで実現済み」「匿名化」の呼び名)は
 * カタログが持つ(語と宣言のずれは J5 が見る)。連鎖(複合 RPC の `also_writes`)を辿る入口の判定と、
 * 操作の実行計画の組み立てが共有する。
 *
 * @param job カタログの行(カタログに無い ID は `undefined`)
 * @returns 同一トランザクションで実現される種類なら true
 */
export function isInTransactionJob(job: JobDecl | undefined): boolean {
  return job !== undefined && (job.inTransaction === true || job.anonymizes !== undefined || job.endsSessions !== undefined);
}
