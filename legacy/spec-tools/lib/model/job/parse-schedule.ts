/**
 * `source: schedule` の行の読み取り(J0 の一部)。
 *
 * parse-jobs.ts が呼ぶ下位の部品で、読む軸が違う —
 * **時刻で起きるジョブだけが持つキーの塊**であり、outbox の行はここを 1 つも通らない。
 * 「軸ごとに書けるキーが違う」という J0 の要求が、モジュールの分かれ目としても現れている。
 */

import type { SpecReporter } from '../parse-common.js';
import type { YamlReader } from '../yaml-reader.js';
import type { JobScheduleDecl, JobScheduler } from './types.js';
import { JOB_SCHEDULERS } from './types.js';
import { codeNameField } from '../sql-fields.js';
import { routePathProblem } from '../code-names.js';

/** 通知 ID(`emits` の要素)の形。通知カタログの ID と同じスネークケースである(実在は N1 / J2 が見る)。 */
const SNAKE = /^[a-z][a-z0-9_]*$/;

/** `source: schedule` の行だけが書けるキー(outbox の行に現れたら軸の取り違え)。 */
export const SCHEDULE_ONLY_KEYS = [
  'schedule',
  'not_scheduled_reason',
  'endpoint',
  'implementation',
  'fires',
  'due_from',
  'scheduler',
  'emits',
] as const;

/**
 * 時刻で起きるジョブの宣言を読む。
 *
 * `schedule`(cron 式)と `not_scheduled_reason` は**排他で、必ずどちらか**である。
 * 両方無いと「いつ起きるか誰も知らない」が黙って通り、それこそがこのカタログを
 * 作った理由(暗黙の挙動の禁止)に反する。
 */
export function parseSchedule(
  item: YamlReader,
  id: string,
  reporter: SpecReporter,
): JobScheduleDecl | null {
  const implementation = item.requiredString(
    'implementation',
    'implementation に走査・ワーカーの実装モジュール(リポジトリルート相対)を書く',
  );
  if (implementation === null) return null;

  const cron = item.optionalString('schedule', 'schedule に cron 式を書く(Cron の登録と一致させる)');
  const reason = item.optionalString(
    'not_scheduled_reason',
    'not_scheduled_reason に「なぜまだ Cron に登録していないか」を書く',
  );
  if (cron === undefined && reason === undefined) {
    reporter.error(
      item.pointer('schedule'),
      `ジョブ ${id} に schedule も not_scheduled_reason もありません`,
      'cron 式を書くか、まだ結線していないなら not_scheduled_reason に理由を書く(「いつ起きるか」が仕様のどこにも無い状態を作らない)',
      { job: id },
    );
    return null;
  }
  if (cron !== undefined && reason !== undefined) {
    reporter.error(
      item.pointer('not_scheduled_reason'),
      `ジョブ ${id} に schedule と not_scheduled_reason の両方があります`,
      '登録済みなら not_scheduled_reason を消す(免除は「登録していない」ことの宣言である)',
      { job: id },
    );
    return null;
  }
  // 口の経路は生成されるテストの import の指定子に置かれるので、文法で閉じる(R17)。
  const rawEndpoint = item.optionalString('endpoint', 'endpoint に Cron が叩く口(/api/...)を書く');
  const endpoint = rawEndpoint === undefined ? undefined : (codeNameField(item, reporter, 'endpoint', rawEndpoint, routePathProblem) ?? undefined);
  if (rawEndpoint !== undefined && endpoint === undefined) return null;
  if (cron !== undefined && endpoint === undefined) {
    reporter.error(
      item.pointer('endpoint'),
      `ジョブ ${id} に endpoint がありません`,
      'Cron の登録と突き合わせる先なので、schedule を持つジョブには endpoint が要る',
      { job: id },
    );
    return null;
  }
  const scheduler = parseScheduler(item, id, reporter);
  if (scheduler === null) return null;
  const emits = parseEmits(item, id, reporter);
  if (emits === null) return null;
  return {
    ...(cron === undefined ? {} : { cron }),
    ...(reason === undefined ? {} : { notScheduledReason: reason }),
    ...(endpoint === undefined ? {} : { endpoint }),
    implementation,
    ...optionalRef(item, 'fires', 'fires'),
    ...optionalRef(item, 'due_from', 'dueFrom'),
    scheduler,
    ...(emits === undefined ? {} : { emits }),
  };
}

/**
 * `emits`(この走査が outbox に積む通知の ID の一覧)を読む。
 *
 * 書くなら 1 件以上・スネークケース・重複なし(空の宣言は「何も積まない」ことを積むと書くのと同じで、
 * キーの有無が機械の読む軸なので書かせない)。実在(通知カタログ・outbox の行)は N1 / J2 が見る。
 * キーが無ければ `undefined`、読めなければ違反を報告して `null`(行ごと落とす)。
 */
function parseEmits(item: YamlReader, id: string, reporter: SpecReporter): readonly string[] | undefined | null {
  if (!item.has('emits')) return undefined;
  const suggestion = 'emits に、この走査が積む通知の ID(notify_…)を 1 件以上のリストで書く';
  const ids = item.requiredStringList('emits', suggestion, false);
  if (ids === null) return null;
  const seen = new Set<string>();
  for (const emitted of ids) {
    if (!SNAKE.test(emitted)) {
      reporter.error(item.pointer('emits'), `ジョブ ${id} の emits ${emitted} がスネークケースではありません`, suggestion, { job: id, emits: emitted });
      return null;
    }
    if (seen.has(emitted)) {
      reporter.error(item.pointer('emits'), `ジョブ ${id} の emits ${emitted} が重複しています`, '重複した要素を削除する', { job: id, emits: emitted });
      return null;
    }
    seen.add(emitted);
  }
  return ids;
}

/**
 * 旧い値(スタックの名前)と、書き直し先の対応。二重には受けず、名指して error にする。
 * 引くのは自前の `Map` だけ(オブジェクトの添字で引くと `constructor` 等の継承されたプロパティを拾う)。
 */
const RETIRED_SCHEDULER_VALUES: ReadonlyMap<string, JobScheduler> = new Map<string, JobScheduler>([
  ['vercel_cron', 'host'],
  ['pg_cron', 'database'],
]);

/** 旧いキー `runner` と旧い値を書き直す先を名指す対処(文面は schedule の行と schedule 以外の行で共通)。 */
export const RENAME_HINT = '`scheduler: host | database` に書き直す。`vercel_cron` → `host`・`pg_cron` → `database`';

/**
 * `scheduler`(鳴る場所)を値域から読む。`source: schedule` の行はすべて持つ(未結線でも持つ) —
 * 「時計がホストで鳴るのか DB の中で鳴るのか」は結線前から決まっている設計判断であり、
 * 結線した瞬間に初めて決めるものではない。
 *
 * 旧いキー `runner` と旧い値(`vercel_cron` / `pg_cron`)は受けない(キーも値も書き直しを名指して error)。
 */
function parseScheduler(item: YamlReader, id: string, reporter: SpecReporter): JobScheduler | null {
  if (item.has('runner')) {
    reporter.error(
      item.pointer('runner'),
      `ジョブ ${id} の runner は廃止されました(鳴る場所は scheduler で書きます)`,
      RENAME_HINT,
      { job: id },
    );
    return null;
  }
  const scheduler = item.requiredString('scheduler', `scheduler を ${JOB_SCHEDULERS.join(' / ')} から書く`);
  if (scheduler === null) return null;
  if (!(JOB_SCHEDULERS as readonly string[]).includes(scheduler)) {
    const renamed = RETIRED_SCHEDULER_VALUES.get(scheduler);
    reporter.error(
      item.pointer('scheduler'),
      `ジョブ ${id} の scheduler ${scheduler} は値域(${JOB_SCHEDULERS.join(' / ')})にありません`,
      renamed === undefined
        ? 'host(アプリを動かす場所の Cron が叩く。頻度に上限がありうる)/ database(DB 内のスケジューラが叩く。' +
            '10 分間隔等の高頻度向け)のどちらかに直す'
        : `${RENAME_HINT}(${scheduler} は ${renamed} に)`,
      { job: id, scheduler },
    );
    return null;
  }
  return scheduler as JobScheduler;
}

/** 任意の参照(`fires` / `due_from`)をキー名を変えて写す。実在の検査は J2 が行う。 */
function optionalRef(
  item: YamlReader,
  key: 'fires' | 'due_from',
  field: 'fires' | 'dueFrom',
): Record<string, string> {
  const suggestion =
    key === 'fires'
      ? 'fires に実行するドメインイベント ID({machine}.{event})を書く'
      : 'due_from に発火時刻の供給元({entity}.{field})を書く';
  const value = item.optionalString(key, suggestion);
  return value === undefined ? {} : { [field]: value };
}
