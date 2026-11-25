/**
 * **仕組みが自分で持つ表の設計図**(`jobs` = 副作用の outbox / `domain_events` = 監査ログ / `resend_digests` = 再送の要約)。
 *
 * ## なぜアプリの仕様から導けないのか
 *
 * ドメインの表は entity_spec が列の正を持つので、形を `ddl-plan.ts` が導ける。ところがこの
 * 2 表は**ドメイン仕様に現れない**(`internal: true`)—— 列の正がどこにも無いまま、アプリの
 * 手書き migration に埋まっていた。そこに埋まっているのは**アプリの判断ではなく仕組みの
 * 判断**である(定型 RPC の本文が `jobs` に積み `domain_events` に刻む列は `rpc-parts.ts` が
 * 決めている)。だから設計図は仕組みの側が持つ —— 新しいアプリを起こすたびに同じ 2 表を
 * 書き写す作業が消え、列を 1 つ足す判断も 1 か所で済む。
 *
 * ## `domain_events.entity` の値域だけが仕様から出る
 *
 * 「どの集約に起きたか」の値域は、アプリが持つ集約の全数である。これまでは**集約を足すたびに
 * 人が migration で 1 語足していた**(実際に 6 本の migration が 1 語ずつ足している)。値域が
 * ドメイン仕様から機械的に決まる以上、それは写し忘れが起きるだけの手作業であり、ここでは
 * `model.aggregates` の全数から作る。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない**(`entity` の値だけがモデル由来)。
 *
 * @oversize 設計図 3 枚(表の値域 `FRAMEWORK_TABLES` の要素ごとに 1 枚。3 枚目は `resend_digests`、点検 21 回目 A21-1)と、それを DDL の計画・
 * 列の名前・文言・実行者の列へ引く口が、「仕組みが持つ表の形」という 1 つの責務である。
 * @split-review 設計図を表ごとのファイルに割る案は採らない: 値域 `FRAMEWORK_TABLES` と `BLUEPRINTS` の鍵は同じ綴りの閉じた組で、割ると表を足す日に
 * 複数のファイルの綴りを突き合わせることになる(型は鍵の過不足を見るが、置き場は散る)。引く口だけを別ファイルにする案も、口が設計図の私的な形
 * (`FrameworkBlueprint`)を読むので型を公開に広げることになる。1 枚のまま置く。
 */

import type { DataTableSpec } from '../model/data/types.js';
import type { SpecModel } from '../model/types.js';
import { entityNameOfAggregate } from '../semantics/domain-index.js';
import { memberOf } from './ddl-checks.js';
import { foreignKeysIn, sequencesIn } from './ddl-placement.js';
import { frameworkTriggersOf } from './framework-guards.js';
import type { DdlCheck, DdlColumn, DdlForeignKey, DdlSequence, TableDdlPlan } from './ddl-plan.js';
import { KEY_COLUMN, tableDdlPlan } from './ddl-plan.js';

/** 設計図を持つ表の値域(data_table の `framework:` が名指す)。 */
export const FRAMEWORK_TABLES = ['jobs', 'domain_events', 'resend_digests'] as const;

/** 設計図を持つ表の名前。 */
export type FrameworkTableName = (typeof FRAMEWORK_TABLES)[number];

/**
 * この設計図の正(生成 DDL のヘッダが示すファイル)の**凍結したラベル**。パスではない。
 *
 * 適用済み migration のヘッダに入っているため綴りを凍結している(1 バイト変われば生成物の本文が
 * 変わり、再発行 = 新番号が要る。ddl-reissue-free-changes.md §1)。次にこの表の本文が本当に変わる日
 * (再発行の日)に、パッケージ相対の綴り(`lib/sql/framework-tables.ts`)へ直す。
 */
const BLUEPRINT_FILE_LABEL = 'docs/scripts/lib/sql/framework-tables.ts';

/**
 * 執行点(権限・改変を拒否するトリガ)の正の**凍結したラベル**。パスではない。
 * 凍結の理由は `BLUEPRINT_FILE_LABEL` と同じ。
 */
const GUARD_FILE_LABEL = 'docs/scripts/lib/sql/framework-guards.ts';

/** 集約の全数から値域が決まる列(`domain_events` のこの 1 列だけ)。 */
const AGGREGATE_ENUM_COLUMN = 'entity';

/** 1 表分の設計図(列と、名前も式も固定の CHECK と、本人の行を指す実行者の列)。 */
interface FrameworkBlueprint {
  readonly columns: readonly DdlColumn[];
  readonly checks: readonly DdlCheck[];
  /** 消去の本人へ届く実行者の列(外部キーは張らない。T24 が道に数える。監査ログは誰が書いたかを消去の後も残すので載せない)。 */
  readonly actorColumns?: readonly string[];
  /**
   * 保存点の**錨の行**(複合の作成が最初に作る行)の id を持つ列(外部キーは張らない。どの表の行かは保存点ごとに違う)。行の中身は錨の行と
   * その子の行(同行の参加者など)の入力から作るので、錨の行か子の行が消去の本人へ届けば、この列も本人へ届く道である(T24 が数える。点検 22 回目 A の O22-1)。
   * 錨の行が消えると道も消えるので、消去は錨の無い行も消す(期待は `usecase/resend-digest-cover.ts` の `digestAnchorsOf`。T24 と同じ導出 `digestCoverOf`。erase-parity が本文を見る。点検 23 回目 A23-2)。
   */
  readonly anchorColumns?: readonly string[];
}

/** 列 1 本を組み立てる(既定は「値が無くてよい・既定値なし・採番でない」)。 */
function column(
  name: string,
  type: string,
  comment: string,
  options: { readonly notNull?: boolean; readonly default?: string; readonly identity?: boolean } = {},
): DdlColumn {
  return {
    name,
    type,
    notNull: options.notNull ?? false,
    default: options.default ?? null,
    identity: options.identity ?? false,
    comment,
  };
}

/** CHECK 1 本を組み立てる(式は `pg_get_constraintdef` の印字に合わせた字面)。 */
function check(table: string, column: string, suffix: string, expression: string): DdlCheck {
  return { name: `${table}_${column}_${suffix}`, expression, invariant: null };
}

/** 副作用の outbox(ARCH-BE-0015)。 */
const JOBS: FrameworkBlueprint = {
  columns: [
    column(KEY_COLUMN, 'uuid', 'ジョブの識別子。', { notNull: true, default: 'gen_random_uuid()' }),
    column('type', 'text', 'ジョブ種別。state_spec の effects[].do の ID と一致させる。', { notNull: true }),
    column('payload', 'jsonb', '実行に必要な最小限の識別子のみ。業務データのスナップショットを持たない。', {
      notNull: true,
      default: "'{}'::jsonb",
    }),
    column('idempotency_key', 'text', '重複投入を DB で止める鍵。種別と対象から決定的に導く。', {
      notNull: true,
    }),
    column('status', 'text', '取り出しと再試行の状態。', { notNull: true, default: "'pending'::text" }),
    column('attempts', 'integer', 'これまでに試した回数。', { notNull: true, default: '0' }),
    column('max_attempts', 'integer', 'これ以上は試さない上限。超えたら打ち切る。', {
      notNull: true,
      default: '5',
    }),
    column('next_run_at', 'timestamptz', '次に取り出してよい時刻。再試行の待ちはここで表す。', {
      notNull: true,
      default: 'now()',
    }),
    column('last_error', 'text', '直近の失敗の理由。'),
    column('locked_at', 'timestamptz', '取り出した時刻。リースの起点である。'),
    column('locked_by', 'text', '取り出した実行者の名前。'),
    column('created_at', 'timestamptz', '積まれた時刻。', { notNull: true, default: 'now()' }),
    column('updated_at', 'timestamptz', '最後に動いた時刻。', { notNull: true, default: 'now()' }),
  ],
  checks: [
    check('jobs', 'type', 'length', '((char_length(type) >= 1) AND (char_length(type) <= 100))'),
    check('jobs', 'status', 'enum', memberOf('status', ['pending', 'running', 'succeeded', 'failed', 'dead'])),
    check('jobs', 'attempts', 'non_negative', '(attempts >= 0)'),
    check('jobs', 'max_attempts', 'positive', '(max_attempts >= 1)'),
  ],
};

/** 全書き込みの監査ログ(追記専用)。 */
const DOMAIN_EVENTS: FrameworkBlueprint = {
  columns: [
    column(KEY_COLUMN, 'bigint', '追記の順序そのもの。時系列に読むときの並びである。', {
      notNull: true,
      identity: true,
    }),
    column('occurred_at', 'timestamptz', '書き込みが起きた時刻。', { notNull: true, default: 'now()' }),
    column('event_id', 'text', 'ドメインイベント ID または予約 ID。呼び出し側は名乗れない。', {
      notNull: true,
    }),
    column(AGGREGATE_ENUM_COLUMN, 'text', '書き込んだ集約。値域はドメイン仕様の集約の全数である。', {
      notNull: true,
    }),
    column('entity_id', 'uuid', '書き込んだ行の識別子。', { notNull: true }),
    column('actor_id', 'uuid', '実行者。空は人間の実行者がいない経路を意味する。'),
    column('from_state', 'text', '遷移の前の状態。遷移のときだけ入る。'),
    column('to_state', 'text', '遷移の後の状態。遷移のときだけ入る。'),
    column('payload', 'jsonb', '作成なら入れた欄、編集なら変えた欄の新しい値。'),
  ],
  // entity の CHECK だけは値域がモデルから出るので、ここには置かない(`aggregateCheck`)。
  checks: [],
};

/** 保存点の再送の入力の要約(短命。保持の時間と実行者の消去で消える。点検 21 回目 A21-1。読み書きの本体は `rpc-resend-digest.ts`)。 */
const RESEND_DIGESTS: FrameworkBlueprint = {
  columns: [
    column(KEY_COLUMN, 'uuid', '行の識別子。', { notNull: true, default: 'gen_random_uuid()' }),
    column('event_id', 'text', 'どの保存点か(usecase:{ユースケース}.{保存点})。', { notNull: true }),
    column('entity_id', 'uuid', '保存点の冪等キー(最初に作る行の id)。', { notNull: true }),
    column('actor_id', 'uuid', '1 回目の実行者。空は未ログインの呼び出し。消去はこの列で行を消す。'),
    column('input_digest', 'text', '1 回目の入力の要約(正規化した入力の sha256)。', { notNull: true }),
    column('created_at', 'timestamptz', '1 回目の時刻。保持の時間はここから数える。', { notNull: true, default: 'now()' }),
  ],
  checks: [],
  actorColumns: ['actor_id'],
  anchorColumns: ['entity_id'],
};

/** 表の名前 → その設計図。 */
const BLUEPRINTS: Readonly<Record<FrameworkTableName, FrameworkBlueprint>> = {
  jobs: JOBS,
  domain_events: DOMAIN_EVENTS,
  resend_digests: RESEND_DIGESTS,
};

/**
 * その名前が設計図を持つか(`framework:` の値域の判定。T12 が使う)。
 *
 * @param name data_table が宣言した名前
 * @returns 設計図があれば true
 */
export function isFrameworkTable(name: string): name is FrameworkTableName {
  return (FRAMEWORK_TABLES as readonly string[]).includes(name);
}

/**
 * 集約の全数から決まる CHECK(`domain_events.entity` の値域)。
 *
 * 集約を 1 つ足したら `generate` で値域が追随する —— 人が migration に 1 語足す作業が消える。
 * 並びは集約名の昇順に固定する(生成物が実行のたびに揺れないため)。
 *
 * @param table その表の名前
 * @param domain ドメイン仕様(集約の全数の正)
 * @returns CHECK 1 本。その表に値域の列が無ければ空
 */
function aggregateChecks(table: FrameworkTableName, domain: SpecModel): readonly DdlCheck[] {
  const blueprint = BLUEPRINTS[table];
  const has = blueprint.columns.some((entry) => entry.name === AGGREGATE_ENUM_COLUMN);
  if (!has) return [];
  // 集約ディレクトリ名とエンティティ名は 1 対 1 とは限らない(引くのはエンティティ名なので、
  // 2 つの集約が同じ名前へ落ちると値域に同じ語が 2 度出る)。集合にしてから並べる。
  const names = [
    ...new Set([...domain.aggregates.keys()].map((aggregate) => entityNameOfAggregate(domain, aggregate))),
  ].sort((a, b) => a.localeCompare(b));
  if (names.length === 0) return [];
  return [check(table, AGGREGATE_ENUM_COLUMN, 'enum', memberOf(AGGREGATE_ENUM_COLUMN, names))];
}

/**
 * 仕組みが持つ表 1 枚の DDL の計画。
 *
 * 列と固定の CHECK は設計図が、値域がモデルから出る CHECK はドメイン仕様が、索引・外部キー・
 * 非導出 CHECK は data_table が正である(**同じことを 2 か所に書かない**)。索引をアプリ側の
 * 宣言に置いたままにしてあるのは、索引の閉世界を `data-table-parity` が双方向に見ているためで、
 * 設計図にも持たせると正が割れる。
 *
 * @param table その表の data_table(`framework:` を宣言している)
 * @param domain ドメイン仕様(集約の全数)
 * @param foreignKeys このファイルが出す外部キー(置き場の規則は `ddl-placement.ts`)
 * @param sequences このファイルが出す採番の器(置き場の規則は同じ)
 * @returns 計画。`framework:` が値域に無ければ null
 */
export function frameworkTableDdlPlan(
  table: DataTableSpec,
  domain: SpecModel,
  foreignKeys: readonly DdlForeignKey[],
  sequences: readonly DdlSequence[] = [],
): TableDdlPlan | null {
  const name = table.framework;
  if (name === undefined || !isFrameworkTable(name)) return null;
  const blueprint = BLUEPRINTS[name];
  return {
    table: table.table,
    entity: null,
    primaryKey: [KEY_COLUMN],
    columns: blueprint.columns,
    derivedChecks: [...blueprint.checks, ...aggregateChecks(name, domain)],
    declaredChecks: table.checks.map((entry) => ({
      name: entry.name,
      expression: entry.rule === undefined ? null : `(${entry.rule})`,
      invariant: entry.invariant ?? null,
    })),
    foreignKeys,
    indexes: table.indexes.map((index) => ({
      name: index.name,
      columns: [...index.on],
      unique: index.unique,
      where: index.where ?? null,
    })),
    exclusions: [],
    // 採番の器は data_table の宣言が正である(索引と同じ扱い。設計図に持たせると正が割れる)。
    sequences: sequences,
    // 執行点(改変を拒否するトリガ)の正も設計図の側である(`framework-guards.ts`)。
    // 権限は表の DDL に出ない —— どの表でも同じ 1 組なので系に 1 本へ寄せてある
    // (`grants-migration.ts`)。ポリシーを 1 本も持たないこの 2 表の surface のロールの剥奪も
    // あちらが出す(判定は「ポリシーの migration があるか」であり、設計図の分岐ではない)。
    triggers: frameworkTriggersOf(table),
    specFiles: [BLUEPRINT_FILE_LABEL, GUARD_FILE_LABEL, table.location.file],
  };
}

/**
 * その表の DDL の計画(仕組みが持つ表とドメインの表の**唯一の入口**)。
 *
 * 振り分けをここに置いてあるのは、`ddl-plan.ts` からこのファイルを呼ぶと**値の循環参照**に
 * なるからである(設計図は組み立ての時点で `KEY_COLUMN` を読む)。生成器も検査器も入口を
 * 1 つしか持たないので、「どちらの表か」の判定が 2 か所に散らない。
 *
 * @param table テーブル仕様
 * @param domain ドメイン仕様
 * @param tables 全 data_table(外部キーの置き場を決めるのに要る)
 * @returns 計画。どちらの道でも組み立てられなければ null
 */
export function ddlPlanOf(
  table: DataTableSpec,
  domain: SpecModel,
  tables: readonly DataTableSpec[] = [table],
): TableDdlPlan | null {
  if (table.framework === undefined) return tableDdlPlan(table, domain, tables);
  return frameworkTableDdlPlan(table, domain, foreignKeysIn(table, tables), sequencesIn(table, tables));
}

/**
 * 設計図が持つ表の**列の名前**(宣言順)。
 *
 * 外から届く surface のビュー(`api.{表}`)は列を全部並べて書く —— その並びの正は、ドメインの表では
 * entity_spec の `fields`、**この 2 表では設計図そのもの**である。だから surface の計画もここから
 * 引ける(列の正を 2 か所に置かない)。
 *
 * @param name 設計図を持つ表の名前
 * @returns 列の名前(宣言順)
 */
export function frameworkTableColumnNames(name: FrameworkTableName): readonly string[] {
  return BLUEPRINTS[name].columns.map((entry) => entry.name);
}

/**
 * 設計図を持つ表の、消去の本人へ届く実行者の列(T24 が外部キーの道と同じに数える。実行者の id = 消去の本人の行の id)。
 *
 * @param name data_table の `framework:` の値(値域の外なら空)
 * @returns 列の名前
 */
export function frameworkActorColumnsOf(name: string | undefined): readonly string[] {
  if (name === undefined || !isFrameworkTable(name)) return [];
  return BLUEPRINTS[name].actorColumns ?? [];
}

/**
 * 設計図を持つ表の、保存点の錨の行の id を持つ列(T24 が「錨の行か子の行が本人へ届く」ときに道に数える)。
 *
 * @param name data_table の `framework:` の値(値域の外なら空)
 * @returns 列の名前
 */
export function frameworkAnchorColumnsOf(name: string | undefined): readonly string[] {
  if (name === undefined || !isFrameworkTable(name)) return [];
  return BLUEPRINTS[name].anchorColumns ?? [];
}

/**
 * 設計図に書かれた**仕組みの文言**の全数(列の説明)。
 *
 * 期待表(`ddl-expectations.ts`)に写るので、出力側の目(`generated-wording.ts`)にはこれも
 * 「仕組みの文言」として見える。**表を 2 つ持たない**ため、ここでは宣言を引くだけにする
 * (`messages.ts` の `frameworkRoleWords` と同じ流儀)。
 *
 * @returns 列の説明の全数
 */
export function frameworkTableWords(): readonly string[] {
  return Object.values(BLUEPRINTS).flatMap((blueprint) =>
    blueprint.columns.map((entry) => entry.comment ?? ''),
  );
}
