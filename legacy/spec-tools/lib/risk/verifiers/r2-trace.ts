/**
 * R2 の**内部実行の入口の追跡**(`kind: system` のロールが役の根拠の欄を書くとき、誰の指示で何を書くかが仕様から追えるか)。
 *
 * 内部実行のロールは呼び手を問わない —— `by: [system]` は「仕組みの中のどこからでも起こせる」の宣言であり、それだけでは
 * 誰の指示で役が立つのかが仕様のどこにも無い。だから内部実行を許可の集合に**無条件では入れない**。追える入口は 3 つで閉じる。
 *
 * | 入口 | 誰の指示で | 何を | 宣言 |
 * |---|---|---|---|
 * | サインインの決定表 | サインインした本人(主語の軸)+ 主語以外の軸の条件(在籍確認などの外の事実) | `runs` のイベント | auth_spec の `sign_in[]` |
 * | 受信 Webhook | 外の相手(署名で確かめる) | `emits` のイベント・`event_id_table` の行 | external の `direction: inbound` |
 * | 時刻の走査 | 時計(発火時刻の供給元の欄) | `fires` のイベント | job_spec の `schedule.fires` + `due_from` |
 *
 * 主語の軸だけで役を立てる決定表の行(「サインインしただけで有効メンバー」)は追えるが、本人が自分に役を与える形なので追えたことにしない。
 * 時刻の走査は発火時刻の供給元(`due_from`)を宣言したものだけを数える —— 供給元の無い走査は、どの行に役を与えるかを
 * 実装だけが知っている。純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { subjectAxis, type AuthFlowSpec } from '../../model/auth/types.js';
import type { DataTableSpecModel } from '../../model/data/types.js';
import type { ExternalCatalogSpec } from '../../model/external/types.js';
import type { JobCatalogSpec } from '../../model/job/types.js';

/** 追跡の材料(使えないカタログは undefined)。 */
export interface TraceCatalogs {
  readonly auth: AuthFlowSpec | undefined;
  readonly external: ExternalCatalogSpec | undefined;
  readonly jobs: JobCatalogSpec | undefined;
  readonly dataTables: DataTableSpecModel | undefined;
}

/**
 * 内部実行が起こすイベントの、追える入口(人が読む 1 行ずつ。無ければ空)。
 *
 * @param catalogs 追跡の材料
 * @param eventId `{機械}.{イベント}`
 */
export function tracedSources(catalogs: TraceCatalogs, eventId: string): string[] {
  const sources: string[] = [];
  const flow = catalogs.auth;
  if (flow !== undefined) {
    const subject = subjectAxis(flow)?.id;
    for (const branch of flow.branches) {
      if (!branch.runs.includes(eventId)) continue;
      const gates = Object.keys(branch.values).filter((axis) => axis !== subject);
      if (gates.length > 0) sources.push(`サインインの決定表 ${branch.id}(${gates.join('・')} の条件)`);
    }
  }
  for (const integration of catalogs.external?.integrations ?? []) {
    if (integration.direction === 'inbound' && integration.emits === eventId) sources.push(`受信 ${integration.id}`);
  }
  for (const job of catalogs.jobs?.jobs ?? []) {
    if (job.schedule?.fires === eventId && job.schedule.dueFrom !== undefined) sources.push(`走査 ${job.id}(${job.schedule.dueFrom})`);
  }
  return sources;
}

/**
 * 内部実行が作る行の、追える入口(受信 Webhook が冪等の記録として作る表)。
 *
 * @param catalogs 追跡の材料
 * @param entity 作られる行の集約
 * @returns 入口の 1 行(無ければ null)
 */
export function tracedCreator(catalogs: TraceCatalogs, entity: string): string | null {
  for (const integration of catalogs.external?.integrations ?? []) {
    if (integration.direction !== 'inbound' || integration.eventIdTable === undefined) continue;
    const table = catalogs.dataTables?.tables.find((candidate) => candidate.id === integration.eventIdTable);
    if (table?.entity === entity) return `受信 ${integration.id} の記録の表`;
  }
  return null;
}
