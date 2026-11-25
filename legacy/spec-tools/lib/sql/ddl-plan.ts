/**
 * data_table + entity_spec + state_spec → **表の DDL の計画**(`TableDdlPlan`)。
 *
 * ## なぜ表の形が生成物になるのか
 *
 * 列・型・NOT NULL・フィールド制約の正は entity_spec であり(ARCH-SP-BE-0001 §テーブル仕様)、
 * 索引・外部キーの ON DELETE・排他制約・列の既定値の正は data_table である。**どちらにも
 * 「決める余地」は残っていない**のに、そこから落ちる DDL は 1 行ずつ手で書き写されていた ——
 * 写し間違いを見張る機械が別に要る状態である(ADR-0012「DB を権威にする」の続き)。
 *
 * この計画は「その表はどういう形であるべきか」を**名前つきで**並べたものであり、SQL の字面は
 * 持たない。字面を作るのは `ddl-migration.ts`、実 DB と突き合わせるのは統合テスト
 * (ddl-parity)であり、どちらもこの 1 つの計画を読む(二重の正を作らない)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef, SpecModel, StateMachineSpec } from '../model/types.js';
import { isSystemSupplied } from '../model/types.js';
import { allMachines } from '../model/types.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import type { DataTableSpec } from '../model/data/types.js';
import { foreignKeysIn, sequencesIn } from './ddl-placement.js';
import { type DdlTrigger } from './ddl-guards.js';
import { generatedTriggers } from './ddl-triggers.js';
import { sqlLiteral } from './guard-to-sql.js';
import { derivedChecks, planDeclaredCheck } from './ddl-checks.js';
import { columnType } from './sql-types.js';

/** 全テーブルが持つ主キー列(表の規約。ARCH-SP-BE-0001)。 */
export const KEY_COLUMN = 'id';

/**
 * 主キーの制約名(**自動命名の規約**。`{表}_pkey`)。
 *
 * DDL が名前を付けるし、不変条件が `enforced_by: db_constraint` でその名前を指すこともある。
 * 規約を 2 か所に書かないよう、名前の正はここ 1 つに置く(引く側は DDL の組み立てと T16)。
 *
 * @param table 表の名前
 * @returns 制約名
 */
export function primaryKeyName(table: string): string {
  return `${table}_pkey`;
}

/**
 * 導出 CHECK の名前の接尾辞(**この 4 語に固定**)。
 *
 * 名前が「どの列のどの制約か」から機械的に決まることが、突合を双方向にできる条件である ——
 * 自由に名付けられると「DB にあって宣言に無い制約」と「名前だけ違う同じ制約」が区別できない。
 *
 * `enum([...])` と `state(機械)` は**どちらも「値の値域」**なので同じ `_enum` を使う
 * (値の出どころが entity_spec か state_spec かの違いしかなく、DB に出る制約は同じ形である。
 * 分けると `{表}_state_state` のように同じ語が 2 度出る名前になる)。
 */
export const CHECK_SUFFIXES = ['max_length', 'range', 'enum', 'pattern'] as const;

/** 導出 CHECK の接尾辞。 */
export type CheckSuffix = (typeof CHECK_SUFFIXES)[number];

/** 1 列の計画。 */
export interface DdlColumn {
  /** 列名(entity_spec の欄名そのまま)。 */
  readonly name: string;
  /** 列の型(pg_catalog の型名。正は `sql-types.ts` の `columnType`)。 */
  readonly type: string;
  /** 行で必ず値があるか(`not null`)。 */
  readonly notNull: boolean;
  /** 列の既定値(SQL の式。`pg_get_expr` の出力に合わせた字面)。無ければ null。 */
  readonly default: string | null;
  /**
   * DB が採番する列か(`generated always as identity`)。
   *
   * 既定値では書けない唯一の供給の機構であり、仕組みが持つ表の追記専用の台帳
   * (`framework-tables.ts` の監査ログ)がこれを使う。entity_spec から導く列には現れない
   * (採番の正は `auto` + `uuid` であり、既定値で書ける)。
   */
  readonly identity: boolean;
  /** `comment on column` に載せる説明(entity_spec の `description` の写し)。無ければ null。 */
  readonly comment: string | null;
}

/** CHECK 制約 1 本の計画。 */
export interface DdlCheck {
  /** 制約名(DB の実名)。 */
  readonly name: string;
  /**
   * 条件式(`pg_get_constraintdef` が `CHECK (…)` の内側に印字する字面に合わせる)。
   *
   * **ほとんどの形は丸括弧で始まる**(`(a < b)` / `((A) AND (B)))。素の式
   * (`used_count >= 0`)をそのまま運ぶと期待の側が `pg_get_constraintdef` の印字
   * (`CHECK ((used_count >= 0))`)と一致しないので、**計画の段で包む**。例外は全域化の
   * `COALESCE(…, false)` だけで、Postgres がこれを括弧で包まずに印字するため式も包まない
   * (`check` の後ろに置くときだけ `ddl-migration.ts` が包み直す)。
   *
   * 式が `null` になるのは、`checks[]` が `rule` も導ける `formal` も持たない行
   * (手書きの migration が持つと宣言した行を含む)である —— その場合 DDL は制約を作らず、
   * 突合は「名前が宣言にある」ことだけを見る(片方向。既存の線引きと同じ)。
   */
  readonly expression: string | null;
  /** `comment on constraint` に載せる不変条件 ID。無ければ null。 */
  readonly invariant: string | null;
}

/**
 * 外部キー 1 本の計画(制約名は `{表}_{列}_fkey` に固定)。
 *
 * **`table`(制約を張る表)を持つのは、外部キーが自表のファイルに出るとは限らないからである。**
 * 張れるのは両方の表が揃ってからなので、**両側の表のファイル**(自表と参照先)に出し、
 * 「両方の表が在って、その列にまだ外部キーが無いとき」だけ張る —— 先に当たった側は
 * 通り過ぎ、後から当たった側で張られる。**相互参照**(どちらを先にしても片方が後ろを向く)も
 * これで解け、置き場が連番に依らないので表を再発行しても隣の表のファイルが動かない
 * (`ddl-placement.ts`)。
 */
export interface DdlForeignKey {
  readonly name: string;
  /** 制約を張る表(このファイルの表とは限らない)。 */
  readonly table: string;
  readonly column: string;
  /** 参照先(public 以外はスキーマ修飾された名前のまま)。 */
  readonly references: string;
  /** ON DELETE の挙動(SQL の語。例: `no action`)。 */
  readonly onDelete: string;
}

/** 索引 1 本の計画。 */
export interface DdlIndex {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
  readonly where: string | null;
}

/** 採番の器 1 本の計画(`create sequence`)。 */
export interface DdlSequence {
  readonly name: string;
  /** 最初の値(宣言が無ければ null = SQL の既定)。 */
  readonly start: number | null;
}

/** 排他制約 1 本の計画。 */
export interface DdlExclusion {
  readonly name: string;
  readonly keys: readonly string[];
  readonly range: readonly [string, string];
  readonly where: string | null;
  readonly invariant: string | null;
}

/** 1 表分の DDL の計画(字面は持たない)。 */
export interface TableDdlPlan {
  readonly table: string;
  /** 対応する集約(仕組みが自分で持つ表には無いので null)。 */
  readonly entity: string | null;
  /** 主キーの列(いまは `id` 固定)。 */
  readonly primaryKey: readonly string[];
  readonly columns: readonly DdlColumn[];
  /** entity_spec から導出した CHECK(名前も式も決まる。突合は**双方向**)。 */
  readonly derivedChecks: readonly DdlCheck[];
  /** data_table が宣言した非導出 CHECK(式は `rule` か、不変条件の `formal` から反映できたとき)。 */
  readonly declaredChecks: readonly DdlCheck[];
  /** **このファイルが出す**外部キー(自表のものとは限らない。`DdlForeignKey` の docstring)。 */
  readonly foreignKeys: readonly DdlForeignKey[];
  readonly indexes: readonly DdlIndex[];
  readonly exclusions: readonly DdlExclusion[];
  /**
   * 列の既定値が採番に使うシーケンス(`create sequence` は表より**前**に出る)。
   *
   * 表の DDL が既定値の式ごと出すので、器が無いと空の DB では表そのものが作れない ——
   * 名指しと宣言の突合は T13、実 DB との閉世界は ddl-parity が見る。
   */
  readonly sequences: readonly DdlSequence[];
  /**
   * このファイルが出すトリガ(関数の本文つき)。2 種類ある。
   *
   * - **改変を拒否するトリガ**(追記専用の執行点)。正は設計図の側(`framework-guards.ts`)。
   * - **祖先の列の写しを埋めるトリガ**。値の決め方が宣言から完全に読める形だけを出す
   *   (`ddl-copy-triggers.ts`)—— 生成物だけで立ち上げる系では、これが無いと
   *   `supplied_by: db` の列を誰も埋めない。
   */
  readonly triggers: readonly DdlTrigger[];
  /** この DDL の正になる仕様ファイル(リポジトリルート相対)。 */
  readonly specFiles: readonly string[];
}

/**
 * 1 表分の DDL の計画を組み立てる。
 *
 * `entity` を持たない表(`internal: true`)には計画が無い —— ドメイン仕様に現れない台帳は
 * 列の正を entity_spec に持たないので、形を導出できない(据え置き)。
 *
 * @param table テーブル仕様
 * @param domain ドメイン仕様(列・型・制約・状態機械の正)
 * @param tables 全 data_table(外部キーの置き場を決めるのに要る)
 * @returns 計画。`entity` が無い / 引けない表では null
 */
export function tableDdlPlan(
  table: DataTableSpec,
  domain: SpecModel,
  tables: readonly DataTableSpec[] = [table],
): TableDdlPlan | null {
  if (table.entity === undefined) return null;
  const entity = findEntitySpec(domain, table.entity);
  if (entity === null) return null;
  const machines = machineIndex(domain);
  return {
    table: table.table,
    entity: entity.entity,
    primaryKey: [KEY_COLUMN],
    columns: entity.fields.map((field) => planColumn(field, table, machines)),
    derivedChecks: entity.fields.flatMap((field) => derivedChecks(field, table.table, machines)),
    declaredChecks: table.checks.map((check) => planDeclaredCheck(check, entity, domain)),
    foreignKeys: foreignKeysIn(table, tables),
    indexes: table.indexes.map((index) => ({
      name: index.name,
      columns: [...index.on],
      unique: index.unique,
      where: index.where ?? null,
    })),
    exclusions: table.exclusions.map((exclusion) => ({
      name: exclusion.name,
      keys: [...exclusion.keys],
      range: exclusion.range,
      where: exclusion.where ?? null,
      invariant: exclusion.invariant ?? null,
    })),
    sequences: sequencesIn(table, tables),
    triggers: generatedTriggers(table, domain, tables),
    specFiles: [entity.location.file, table.location.file],
  };
}

/** 機械名 → その状態機械(state 型の列の既定値と値域を引く)。 */
function machineIndex(domain: SpecModel): ReadonlyMap<string, StateMachineSpec> {
  return new Map(allMachines(domain).map((ref) => [ref.machine.machine, ref.machine]));
}

/**
 * 1 欄 → 1 列の計画。
 *
 * **NOT NULL の正は「行で必ず値があるか」**であり、判定は行(row)のスキーマ(`code-zod.ts` の
 * `absenceInRow` = `isSystemSupplied` + `required`)と**ほぼ同じ**である。**差は `defaults` の項
 * 1 つ**で、列の既定値を宣言した欄はここでだけ NOT NULL になる(既定値がある列は入力が無くても
 * 行に値が入るが、row のスキーマは `.nullable()` のまま —— nullable は非 null を通すので
 * 両者は食い違わない)。
 *
 * **`supplied_by: db` はそれ自体では NOT NULL にしない。** 供給するトリガが空を書くことが
 * あるからで、写しの欄(元が空なら空のまま入る)がその実例である。
 */
function planColumn(
  field: FieldDef,
  table: DataTableSpec,
  machines: ReadonlyMap<string, StateMachineSpec>,
): DdlColumn {
  const declared = table.defaults[field.name];
  return {
    name: field.name,
    type: columnType(field.type),
    notNull: isSystemSupplied(field) || field.required || declared !== undefined,
    default: declared ?? derivedDefault(field, machines),
    identity: false,
    comment: field.description ?? null,
  };
}

/**
 * 宣言の無い列の既定値(entity_spec からの導出)。
 *
 * 3 通りしかない —— 採番の `uuid`・作成時刻の `datetime`・状態機械の初期状態である。
 * それ以外(DB が決める値の機構)は data_table の `defaults` が宣言する。
 */
function derivedDefault(field: FieldDef, machines: ReadonlyMap<string, StateMachineSpec>): string | null {
  if (field.type.kind === 'state') {
    const initial = machines.get(field.type.machine)?.initial;
    return initial === undefined ? null : `${sqlLiteral(initial)}::text`;
  }
  if (!field.auto) return null;
  if (field.type.kind === 'uuid') return 'gen_random_uuid()';
  return field.type.kind === 'datetime' ? 'now()' : null;
}
