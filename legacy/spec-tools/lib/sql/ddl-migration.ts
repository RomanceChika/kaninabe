/**
 * 表の DDL の migration 1 枚(`{14 桁}_ddl_{表}.sql`)の組み立て。
 *
 * ## なぜ「冪等な DDL」なのか
 *
 * migration は追記専用の歴史であり、既に適用済みの DB に当てても壊れてはならない。そこで
 * 出すのは**宣言どおりの形へ寄せる冪等な DDL** である —— `create table if not exists` /
 * `add column if not exists` / 導出 CHECK の `drop constraint if exists` → `add constraint` /
 * `create index if not exists`(部分索引は定義を比べて作り直す)。何度流しても結果が同じで、既に宣言どおりの DB に当てれば
 * 何も変わらない。
 *
 * **列は足すだけで、落とさない・型は変えない。** データに触る判断は人が手で書く migration の
 * 仕事であり、食い違いは突合(ddl-parity)が error で名指す。外部キーと排他制約も同じ線引きで、
 * **既にあるものには触れない**(名前が規約と違う古い制約・`deferrable` のような宣言に
 * 現れない性質を、生成器が黙って作り替えないため)。CHECK も**定義が食い違うときだけ**
 * 置き換える —— `add constraint … check` は ACCESS EXCLUSIVE ロック + 全行検証なので、
 * 宣言どおりの DB に当てるたびに全表スキャンが走るのは冪等とは呼べない。
 *
 * **権限(`revoke` / `grant`)はここに出ない。** どの表でも同じ 1 組なので系に 1 本へ
 * 切り出してある(`grants-migration.ts`)—— 表ごとに複製すると、仕組みの 1 行を変える日の
 * コストが表数に比例する。
 *
 * **1 ファイルは 1 トランザクションで当てる前提**である(`supabase migration up` がそうする)。
 * CHECK の `drop` → `add` の間には制約が無い時間帯があり、1 文ずつ autocommit で当てるとそこを
 * 違反行が通れる(規約: migrations.md §生成 migration)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { sqlCommentText } from '../kernel/safe-text.js';
import { DDL_WORDS } from '../messages/messages-ddl.js';
import { RPC_BODY_WORDS } from '../messages/messages.js';
import { checkBody } from './ddl-checks.js';
import { comments } from './ddl-comments.js';
import { guarded, guardedWhenPresent, triggerStatements } from './ddl-guards.js';
import { sqlLiteral } from './guard-to-sql.js';
import { primaryKeyName } from './ddl-plan.js';
import type {
  DdlCheck,
  DdlColumn,
  DdlExclusion,
  DdlForeignKey,
  DdlIndex,
  DdlSequence,
  TableDdlPlan,
} from './ddl-plan.js';

/** 表を置くスキーマ(ドメインの表は全部ここ)。 */
const SCHEMA = 'public';

/** 排他制約が要求する拡張。 */
const GIST_EXTENSION = 'btree_gist';

/**
 * 拡張を置くスキーマ(点検 7 回目 A7-4)。**スキーマを指定しないと** migration の役の search_path
 * (`"$user", public, extensions`)で `public` に入り、Supabase の既定の付与で anon / authenticated が
 * 拡張の関数を実行でき、「`public` / `api` に拡張の持ち物が 0 件」の閉世界(catalog-kinds-closed-world)
 * とぶつかる。排他制約の `gist` の既定の演算子クラスは search_path に依らず型で引かれるので、
 * `extensions` に置いても `exclude using gist (… with =, …)` はそのまま解ける(実 DB で確認・samples:db の rooms)。
 * 手書きの migration の同じ規則は C23 の ③(`lib/gates/migration-extensions.ts`)が見る。
 */
const EXTENSION_SCHEMA = 'extensions';

/** 区間の型(端の扱いは半開区間に固定。ARCH-SP-BE-0001 §排他制約)。 */
const RANGE_CONSTRUCTOR = 'tstzrange';

/** DB が採番する列の書き方(既定値では書けない唯一の供給の機構)。 */
const IDENTITY = 'generated always as identity';

/**
 * 1 表分の DDL の migration を組み立てる。
 *
 * @param plan その表の DDL の計画
 * @returns SQL 1 枚(末尾に改行を含む)
 */
export function buildDdlMigration(plan: TableDdlPlan): string {
  const target = `${SCHEMA}.${plan.table}`;
  return [
    ...header(plan.specFiles),
    ...(plan.exclusions.length === 0
      ? []
      : ['', `-- ${DDL_WORDS.extension}`, `create extension if not exists ${GIST_EXTENSION} with schema ${EXTENSION_SCHEMA};`]),
    // **表より前に出す。** 表の既定値がこの器を呼ぶので、後ろに置くと表そのものが作れない。
    ...section(DDL_WORDS.sequences, plan.sequences.map((sequence) => createSequence(sequence))),
    '',
    `-- ${DDL_WORDS.table}`,
    ...createTable(plan, target),
    '',
    `-- ${DDL_WORDS.columns}`,
    ...plan.columns.map((column) => addColumn(column, target)),
    ...section(DDL_WORDS.derivedChecks, plan.derivedChecks.flatMap((check) => replaceCheck(check, target))),
    ...section(
      DDL_WORDS.declaredChecks,
      plan.declaredChecks.flatMap((check) => replaceCheck(check, target)),
    ),
    ...section(DDL_WORDS.foreignKeys, plan.foreignKeys.flatMap((fk) => addForeignKey(fk))),
    ...section(DDL_WORDS.indexes, plan.indexes.flatMap((index) => createIndex(index, target))),
    ...section(
      DDL_WORDS.exclusions,
      plan.exclusions.flatMap((exclusion) => addExclusion(exclusion, plan.table, target)),
    ),
    '',
    `-- ${DDL_WORDS.enableRls}`,
    `alter table ${target} enable row level security;`,
    ...section(
      DDL_WORDS.guardTriggers,
      plan.triggers.flatMap((trigger) => triggerStatements(trigger, target)),
    ),
    ...section(DDL_WORDS.comments, comments(plan, target)),
    '',
  ].join('\n');
}

/** 見出しつきの 1 節(中身が無ければ節ごと出さない)。 */
function section(title: string, lines: readonly string[]): readonly string[] {
  return lines.length === 0 ? [] : ['', `-- ${title}`, ...lines];
}

/** 先頭の AUTO-GENERATED ヘッダ(SQL コメント)。 */
function header(specFiles: readonly string[]): readonly string[] {
  return [
    `-- ${RPC_BODY_WORDS.generatedHeader}`,
    '--',
    ...RPC_BODY_WORDS.generatedNote.map((line) => `-- ${line}`),
    ...specFiles.map((file) => `--   - ${sqlCommentText(file)}`),
    '--',
    ...DDL_WORDS.migrationNote.map((line) => `-- ${line}`),
    '--',
    ...DDL_WORDS.additiveNote.map((line) => `-- ${line}`),
  ];
}

/** 表そのもの(無ければ全列と主キーつきで作る)。 */
function createTable(plan: TableDdlPlan, target: string): readonly string[] {
  const body = [
    ...plan.columns.map((column) => `    ${columnDefinition(column)},`),
    `    constraint ${primaryKeyName(plan.table)} primary key (${plan.primaryKey.join(', ')})`,
  ];
  return [`create table if not exists ${target} (`, ...body, ');'];
}

/**
 * 列 1 つの定義(型・採番 / NOT NULL・既定値)。
 *
 * `generated always as identity` は NOT NULL と既定値を**自分で含む**ので、両方とも書かない
 * (`not null` を重ねても意味は変わらないが、`pg_get_expr` に既定値が現れないため期待側と
 * 字面を揃える意味でも 1 つの書き方に寄せる)。
 */
function columnDefinition(column: DdlColumn): string {
  if (column.identity) return `${column.name} ${column.type} ${IDENTITY}`;
  return [
    `${column.name} ${column.type}`,
    ...(column.notNull ? ['not null'] : []),
    ...(column.default === null ? [] : [`default ${column.default}`]),
  ].join(' ');
}

/**
 * 既にある表に列を足す 1 行。
 *
 * **NOT NULL は付けない。** 行のある表に NOT NULL の列を足すのはデータに触る判断であり、
 * 既定値の有無と既存行の中身を見て人が決める(食い違いは ddl-parity が名指す)。
 */
function addColumn(column: DdlColumn, target: string): string {
  const definition = column.identity
    ? `${column.name} ${column.type} ${IDENTITY}`
    : [
        `${column.name} ${column.type}`,
        ...(column.default === null ? [] : [`default ${column.default}`]),
      ].join(' ');
  return `alter table ${target} add column if not exists ${definition};`;
}

/**
 * CHECK 1 本を、**定義が違うときだけ**置き換える(式が仕様に無いものは作れないので飛ばす)。
 *
 * 無条件の `drop` → `add` にしないのは、`add constraint … check (…)` が
 * **ACCESS EXCLUSIVE ロック + 全行検証**だからである。結果は同じでも、宣言どおりの DB に
 * 当てるたびに表の数だけ全表スキャンが走る。`pg_get_constraintdef` の正準表記と突き合わせ、
 * 一致していれば何もしない —— FK・排他と同じ流儀である。
 *
 * `drop` と `add` の間には**制約が無い時間帯**がある(CHECK は落とすと緩む方向)。問題に
 * ならないのは **1 ファイルを 1 トランザクションで当てる**前提に立っているからである。
 */
function replaceCheck(check: DdlCheck, target: string): readonly string[] {
  if (check.expression === null) return [];
  const body = checkBody(check.expression);
  return guarded(
    [
      `select 1 from pg_constraint c`,
      `where c.conrelid = '${target}'::regclass and c.conname = ${sqlLiteral(check.name)}`,
      `  and pg_get_constraintdef(c.oid) = ${sqlLiteral(`CHECK (${check.expression})`)}`,
    ],
    [
      `alter table ${target} drop constraint if exists ${check.name};`,
      `alter table ${target} add constraint ${check.name} check ${body};`,
    ],
  );
}

/**
 * 外部キー 1 本を、**両方の表が在って、まだ無いときだけ**足す。
 *
 * 同じ列の外部キーが別の名前で既にあることがある(列名を変えた歴史の残骸)ので、判定は
 * 名前ではなく**定義の先頭(どの列に掛かっているか)**で行う。
 *
 * **このブロックは両側の表のファイルに出る**(`ddl-placement.ts`)ので、**2 つの表の存在を
 * 先に確かめる** —— 先に当たる側では相手の表がまだ無く、`'…'::regclass` はその場で落ちる
 * (確認を条件式の外側に置く理由は `guardedWhenPresent` にある)。引き換えの「参照先が
 * 現れなければ黙って張らない」経路は `data-table-parity` の外部キーの双方向突合が見る。
 * **制約を張る表は `fk.table`** であり、このファイルの表とは限らない(`ddl-plan.ts`)。
 */
function addForeignKey(fk: DdlForeignKey): readonly string[] {
  const target = `${SCHEMA}.${fk.table}`;
  const references = fk.references.includes('.') ? fk.references : `${SCHEMA}.${fk.references}`;
  return guardedWhenPresent(
    [...new Set([target, references])],
    [
      `select 1 from pg_constraint c`,
      `where c.conrelid = '${target}'::regclass and c.contype = 'f'`,
      `  and pg_get_constraintdef(c.oid) like ${sqlLiteral(`FOREIGN KEY (${fk.column})%`)}`,
    ],
    [
      `alter table ${target} add constraint ${fk.name}`,
      `    foreign key (${fk.column}) references ${references} (id) on delete ${fk.onDelete};`,
    ],
  );
}

/**
 * 採番の器 1 本(まだ無いときだけ作る)。
 *
 * 所有者(`owned by`)は付けない —— 表を落とさない方針なので器も落とさず、`ddl-parity` の
 * 閉世界が「宣言にあって DB に無い / DB にあって宣言に無い」を両方向で見る。
 */
function createSequence(sequence: DdlSequence): string {
  const tail = sequence.start === null ? '' : ` start with ${sequence.start}`;
  return `create sequence if not exists ${SCHEMA}.${sequence.name}${tail};`;
}

/**
 * 索引 1 本(部分索引は述語つき)。
 *
 * **部分索引は定義を比べて収束させる**(点検 14 回目 A14-3)。`if not exists` は名前しか見ないので、同じ名前のまま `where` を変えた DDL は黙って無視され、
 * 実 DB は古い条件のまま残る。述語の正準の印字は書いた形から予測できない(`pg_get_indexdef` が型の注釈や `any (array[…])` に書き直す)ので、
 * **空の一時表に同じ定義の索引を作り、Postgres の印字どうしを比べる**(行は読まない。同じなら何も起きない)。違えば落として作り直す ——
 * 既存の行が新しい条件に反すれば一意の作成が失敗して migration が止まる。それが正しい。
 *
 * 部分でない索引は `if not exists` のままである。`on` / `unique` の食い違いは data-table-parity が赤にする。
 */
function createIndex(index: DdlIndex, target: string): readonly string[] {
  const unique = index.unique ? 'unique ' : '';
  const where = index.where === null ? '' : ` where (${index.where})`;
  const shape = `(${index.columns.join(', ')})${where}`;
  const create = `create ${unique}index if not exists ${index.name} on ${target} ${shape};`;
  if (index.where === null) return [create];
  const qualified = `${SCHEMA}.${index.name}`;
  const probe = 'declared_index_probe';
  return [
    'do $$',
    'begin',
    `    if to_regclass(${sqlLiteral(qualified)}) is not null then`,
    `        create temp table ${probe} (like ${target}) on commit drop;`,
    `        create ${unique}index ${probe}_idx on pg_temp.${probe} ${shape};`,
    `        if split_part(pg_get_indexdef('pg_temp.${probe}_idx'::regclass), ' USING ', 2) <> split_part(pg_get_indexdef(${sqlLiteral(qualified)}::regclass), ' USING ', 2)`,
    `            or (select indisunique from pg_index where indexrelid = 'pg_temp.${probe}_idx'::regclass) <> (select indisunique from pg_index where indexrelid = ${sqlLiteral(qualified)}::regclass) then`,
    `            drop index ${qualified};`,
    '        end if;',
    `        drop table pg_temp.${probe};`,
    '    end if;',
    'end;',
    '$$;',
    create,
  ];
}

/**
 * 排他制約 1 本を、**まだ無いときだけ**足す。
 *
 * 置き換えにしないのは、`drop` → `add` が gist 索引を作り直すからである(意味は変わらないが、
 * 既に宣言どおりの DB に当てて「何も起きない」という性質が失われる)。
 */
function addExclusion(exclusion: DdlExclusion, table: string, target: string): readonly string[] {
  const [start, end] = exclusion.range;
  const where = exclusion.where === null ? '' : ` where (${exclusion.where})`;
  return guarded(
    [
      `select 1 from pg_constraint c`,
      `where c.conrelid = '${target}'::regclass and c.contype = 'x'`,
      `  and c.conname = ${sqlLiteral(exclusion.name)}`,
    ],
    [
      `alter table ${target} add constraint ${exclusion.name}`,
      `    exclude using gist (`,
      ...exclusion.keys.map((key) => `        ${key} with =,`),
      `        ${RANGE_CONSTRUCTOR}(${start}, ${end}, '[)') with &&`,
      `    )${where};`,
    ],
  );
}
