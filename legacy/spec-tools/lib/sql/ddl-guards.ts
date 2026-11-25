/**
 * 表の DDL のうち、**表の形ではなく「誰が何をできるか」を決める部分**の計画と字面。
 *
 * ## なぜ形と分けるのか
 *
 * 列・CHECK・索引は「その表がどういう形か」であり、間違っていれば読み書きが失敗する。
 * それに対して**権限**(`revoke` / `grant`)と**追記専用の執行**(改変を拒否するトリガ)は、
 * 間違っていても読み書きは成功する —— 失敗の代わりに「本来できてはいけないことができる」に
 * なる。監査ログが特権から書き換え放題であることは、どのテストも落とさないまま成立する。
 *
 * だから執行点は**設計図の側が持つ**(`framework-guards.ts`)。新しいアプリを空の DB から
 * 起こしたときに、形は生成されるのに執行点だけ手書き待ちで欠ける、という穴を閉じるためである。
 *
 * **権限そのものは表の DDL に出ない。** どの表でも同じ 1 組である以上、表ごとのファイルに
 * 複製すると「仕組みの 1 行を変える日」のコストが表数に比例する(実測 16 本 / 差分は表ごと
 * 4 行)。だから権限は**系に 1 本の `grants_migration`**(`grants-migration.ts`)が出し、ここに
 * 残るのは「誰に何を与えるか」の語彙(ロール・権限の 1 組・2 行の字面)だけである
 * (`docs/design/ddl-reissue-free-changes.md` §4 の C′)。
 *
 * ## 冪等である
 *
 * `revoke` / `grant` は同じ状態への再宣言であり、トリガ関数は `create or replace`、トリガ本体は
 * **存在ガード**(`pg_trigger` を見てから作る)である —— `drop` → `create` にしないのは、
 * その間に改変が通るからで、既に宣言どおりの DB に当てて「何も起きない」性質も失われる。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { sqlLiteral } from './guard-to-sql.js';

/**
 * 特権ロールに与える権限(**どの表でも同じ 1 組**)。
 *
 * `truncate` / `references` / `trigger` / `maintain` は**与えない** —— Supabase は
 * `postgres` が `public` に作る表に既定でそれらを与えているので、「与えない」は
 * **剥奪してから与え直す**ことでしか成り立たない。`truncate` を外すのは特に意味があり、
 * 行トリガを発火しないので追記専用を執行するトリガには見えない(台帳を丸ごと空にする
 * 操作だけが執行の外に出る)。
 */
export const PRIVILEGED_PRIVILEGES: readonly string[] = ['select', 'insert', 'update', 'delete'];

/**
 * 表 1 枚ぶんの権限の計画。
 *
 * 「surface から外す」(`revoke`)と「特権にだけ開ける」(`grant`)の 2 つで 1 組である —— 片方だけを
 * 宣言できる形にすると、剥奪だけして与え忘れた表(誰も書けない台帳)を作れてしまう。
 */
export interface DdlGrant {
  /**
   * 既定権限を剥奪するロール(この migration が剥奪するもの)。
   *
   * **実際に剥奪されるのはここ + `to` である** —— `grantStatements` が付与先からも
   * 先に剥奪してから与え直す(Supabase は `public` の新しい表に既定で `Dxtm` を与えるので、
   * そうしないと宣言が「そのロールが何をできるか」の全部にならない)。
   *
   * **空になるのは、surface のロールの権限を別の生成物が持つときである** —— ポリシーを持つ表では
   * ポリシーの migration が `revoke all … from anon, authenticated` → `grant select` まで
   * 出すので、権限の migration は特権ロールだけを触る(`table-acl.ts` §執行者は分かれる)。
   */
  readonly revokeFrom: readonly string[];
  /** 与える権限(SQL の語。例: `select`)。 */
  readonly privileges: readonly string[];
  /** 権限を与える宛先のロール。 */
  readonly to: string;
}

/** トリガが実行する関数 1 本(本文つき)。 */
export interface DdlTriggerFunction {
  /** 関数名(`public` に置く)。 */
  readonly name: string;
  /** `comment on function` に載せる説明。 */
  readonly comment: string;
  /** plpgsql の本文(`begin` … `end;` の内側の行)。 */
  readonly body: readonly string[];
  /**
   * **呼び出し主体の権限ではなく定義者の権限で実行するか**(`security definer`)。
   *
   * 本文が**自分の表を読み直す**トリガはこれが要る —— RLS が効いた接続から実行されると
   * 読み直しが 0 行になり、条件を確かめずに素通りする(コミット時評価の制約トリガがまさに
   * その形である。ARCH-SP-BE-0001 §コミット時に評価する不変条件の MUST)。`new` だけを
   * 見るトリガは何も読まないので要らない。
   */
  readonly securityDefiner?: boolean;
}

/** 呼び出し主体の権限で実行することを**字面に残す**(`create or replace` の既定と同じ値)。 */
const SECURITY_INVOKER = 'security invoker';

/** トリガ 1 本の計画。 */
export interface DdlTrigger {
  /** トリガ名(DB の実名)。 */
  readonly name: string;
  /** 発火の節(例: `before update or delete`。`when (…)` を含まない —— 条件は `condition`)。 */
  readonly fires: string;
  /** `for each row` の後に置く `when (…)` の括弧の中(無ければ欄が無い。宣言の読みは `trigger-fires.ts` の `triggerFires` / `firesClause`)。 */
  readonly condition?: string;
  /**
   * **コミット時に評価する制約トリガか**(`create constraint trigger … deferrable initially deferred`)。
   *
   * 複数の手順にまたがって満たす不変条件は、保存点の内側の途中状態に課してはならない
   * (ARCH-SP-BE-0001 §コミット時に評価する不変条件)。省略は普通のトリガである。
   */
  readonly deferred?: boolean;
  /** 実行する関数。 */
  readonly function: DdlTriggerFunction;
}

/**
 * 条件つきの do ブロック(何度流しても同じ結果になる)。
 *
 * @param exists `exists (…)` の中身(1 行ずつ)
 * @param statements 条件を満たしたときに流す文
 * @param whenPresent true なら「**在るときだけ**」、既定は「まだ無いときだけ」
 * @returns SQL の行
 */
export function guarded(
  exists: readonly string[],
  statements: readonly string[],
  whenPresent = false,
): readonly string[] {
  return [
    'do $$',
    'begin',
    `    if ${whenPresent ? 'exists' : 'not exists'} (`,
    ...exists.map((line) => `        ${line}`),
    '    ) then',
    ...statements.map((line) => `        ${line}`),
    '    end if;',
    'end',
    '$$;',
  ];
}

/**
 * **表がまだ無いかもしれない**ところで流す文(存在を確かめてから、条件を確かめて流す)。
 *
 * 表をまたぐものを両側のファイルに出す(`ddl-placement.ts`)と、**先に当たる側では相手の表が
 * まだ無い**。`'public.{表}'::regclass` は表が無ければその場で `undefined_table` を上げるので、
 * `pg_constraint` を引く条件式より**外側**で存在を確かめなければならない。
 *
 * **`and` で 1 つの条件にまとめられない。** SQL は `and` の評価順を約束しないので、
 * `to_regclass(…) is not null and exists (… '…'::regclass …)` は右が先に評価されて落ちうる。
 * plpgsql の `if` の入れ子は制御構造なので、外側が偽なら内側は評価されない —— だから
 * **2 段の `if`** にする。
 *
 * @param present 在ることを確かめる対象(スキーマ修飾された表名)
 * @param exists 内側の `not exists (…)` の中身(1 行ずつ)
 * @param statements どちらの条件も満たしたときに流す文
 * @returns SQL の行
 */
export function guardedWhenPresent(
  present: readonly string[],
  exists: readonly string[],
  statements: readonly string[],
): readonly string[] {
  return whenTablesPresent(present, [
    'if not exists (',
    ...exists.map((line) => `    ${line}`),
    ') then',
    ...statements.map((line) => `    ${line}`),
    'end if;',
  ]);
}

/**
 * **表が在るときだけ**流す文(条件は表の存在だけ)。
 *
 * `guardedWhenPresent` の外側半分である —— 中身が冪等で「まだ無いときだけ」の判定を要らない
 * もの(権限の `revoke` / `grant`)はこちらを使う。表がまだ無い DB に当たっても
 * `undefined_table` を上げずに通り過ぎ、その表を作る migration の後で当たった回に効く。
 *
 * **`'…'::regclass` ではなく `to_regclass`** を使うのは、前者が表が無いとその場で落ちるためである
 * (だから存在の確認は条件式の外側に置く。理由の全文は `guardedWhenPresent`)。
 *
 * @param present 在ることを確かめる対象(スキーマ修飾された表名)
 * @param statements 表が在るときに流す文
 * @returns SQL の行
 */
export function whenTablesPresent(
  present: readonly string[],
  statements: readonly string[],
): readonly string[] {
  const conditions = present.map((target) => `to_regclass('${target}') is not null`);
  return [
    'do $$',
    'begin',
    `    if ${conditions.join(' and ')} then`,
    ...statements.map((line) => `        ${line}`),
    '    end if;',
    'end',
    '$$;',
  ];
}

/**
 * 権限の 2 行(全部剥奪して、宣言した分だけ与える)。
 *
 * **付与先からも先に剥奪する。** Supabase は `public` に作られる表に対して
 * `alter default privileges … grant all on tables to … service_role` を効かせているので、
 * 表を作った時点で特権のロールは `truncate` まで持っている —— 実測すると
 * `TRUNCATE` / `REFERENCES` / `TRIGGER` が付いていた。`truncate` は**行トリガを発火しない**ので、
 * 追記専用を執行しているトリガはそれを見られない(= 監査ログを丸ごと空にできる)。
 * 剥奪してから与え直すことで、宣言が「その表で誰が何をできるか」の全部になる。
 *
 * @param grant その表の権限の計画
 * @param target スキーマ修飾された表名
 * @returns SQL の行
 */
export function grantStatements(grant: DdlGrant, target: string): readonly string[] {
  return [
    `revoke all on ${target} from ${[...grant.revokeFrom, grant.to].join(', ')};`,
    `grant ${grant.privileges.join(', ')} on ${target} to ${grant.to};`,
  ];
}

/**
 * トリガ関数の本文が **`pg_proc.prosrc` に載る字面**(`$$` の内側そのまま)。
 *
 * 突合(`data-table-parity`)は実 DB の `md5(prosrc)` と比べる —— 生成した本文が実 DB に
 * 当たっていない(古い migration のまま・手で書き換えた)ことを、名前の実在だけでは保証できない
 * (定型 RPC の本文を `rpc-parity` が見ているのと同じ粒度である)。
 *
 * @param fn トリガ関数の計画
 * @returns `prosrc` の字面(前後に改行が付く)
 */
export function triggerBodySource(fn: DdlTriggerFunction): string {
  return `\nbegin\n${fn.body.map((line) => `    ${line}`).join('\n')}\nend;\n`;
}

/**
 * トリガ 1 本と、その関数(`create or replace`)と説明。
 *
 * 関数は `public` に置く —— `kind: trigger` の関数の持ち場は `public` であり、その閉世界は
 * `data-table-parity` が見る(ARCH-SP-BE-0001 §テーブル仕様)。
 *
 * @param trigger トリガの計画
 * @param target スキーマ修飾された表名
 * @returns SQL の行
 */
export function triggerStatements(trigger: DdlTrigger, target: string): readonly string[] {
  const signature = `public.${trigger.function.name}()`;
  return [
    `create or replace function ${signature} returns trigger`,
    'language plpgsql',
    // **既定と同じ値でも書く。** `create or replace function` は指定しなかった属性を既定に
    // 戻すので、`security invoker` は書かなくても同じ結果になる —— だが手書きの
    // `security definer` を生成物に差し替えた日に**静かに落ちる**性質でもある(束 §17 で
    // 実際に 2 本落ちた)。字面に残せば、生成物を読む人と `prosecdef` を突き合わせる
    // `data-table-parity` の両方に「これは意図である」と読める。
    ...(trigger.function.securityDefiner === true
      ? ['security definer', 'set search_path = public']
      : [SECURITY_INVOKER]),
    'as $$',
    // `$$` の内側は `pg_proc.prosrc` に載る字面そのものである(突合は md5 で行う)ので、
    // 組み立ては 1 本(`triggerBodySource`)に持たせる —— 2 か所で作ると片方だけが動く。
    ...triggerBodySource(trigger.function).split('\n').slice(1, -1),
    '$$;',
    '',
    `comment on function ${signature} is ${sqlLiteral(trigger.function.comment)};`,
    '',
    ...guarded(
      [
        `select 1 from pg_trigger t`,
        `where t.tgrelid = '${target}'::regclass and t.tgname = ${sqlLiteral(trigger.name)}`,
        `  and not t.tgisinternal`,
      ],
      [
        `create ${trigger.deferred === true ? 'constraint ' : ''}trigger ${trigger.name}`,
        `    ${trigger.fires} on ${target}`,
        ...(trigger.deferred === true ? ['    deferrable initially deferred'] : []),
        '    for each row',
        // 発火の条件は `for each row` の後(点検 21 回目 C21-5。宣言の `when (…)` を捨てずに出す。置き場はここ 1 か所)。
        ...(trigger.condition === undefined ? [] : [`    when (${trigger.condition})`]),
        `    execute function ${signature};`,
      ],
    ),
  ];
}

