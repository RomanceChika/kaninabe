/**
 * 権限の migration(`{14 桁}_grants.sql`)のうち、**関数の実行権限の閉世界**の節の字面。
 *
 * 計画(誰が呼べるか・誰の既定を閉じるか)は `function-acl.ts` が持ち、表の権限の節と migration 1 枚への組み立ては
 * `grants-migration.ts` が持つ。ここは計画を SQL の行に写すだけである —— 既存の関数の剥奪・作成主体ごとの既定の付与の閉鎖・
 * 事後条件(宣言の外の関数に面のロールと PUBLIC の実行権限が残っていれば止まる)の 3 つを 1 つの do ブロックに出す。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { GRANTS_WORDS } from '../messages/messages-ddl.js';
import { sqlLiteral } from './guard-to-sql.js';
import type { FunctionAclPlan } from './function-acl.js';

/** do ブロックの中の字下げ。 */
const INDENT = '    ';

/**
 * 関数の実行権限の閉世界(**宣言の外の関数から面のロールと PUBLIC の実行権限を外し、新しい関数の
 * 既定の付与も作成主体ごとに閉じる**)。
 *
 * ## 既存の関数
 *
 * 対象は計画のスキーマにある**種別を問わない全部の関数**(通常の関数・手続き・集約・ウィンドウ関数)のうち、
 * 拡張が持つものと宣言した関数を除く全部である。既定の権限の文の `functions` が手続きと集約も含む
 * ので、剥奪の対象もそれに揃える(通常の関数だけだと、手続きが開いたまま残る)。剥奪の文は種別を問わない
 * `routine` で出す。関数の一覧は**流す時点の DB から引く**ので、手書きの関数も、過去に別のスキーマから移した
 * 関数も漏れない(名前を仕様から写すと、仕様に載らない関数が閉世界の外に残る)。
 * 宣言は**署名まで含めて**当てる(`to_regprocedure` が引いた関数の oid)—— 名前だけで除外すると、
 * 同じ名前の別の overload が除外に紛れる。宣言が DB に無ければ何も除外しない(NULL を配列に
 * 入れて `<> all` にすると全件が不明になって何も剥奪されない形を避けるため、`not exists` で当てる)。
 *
 * ## 新しい関数(既定の付与)
 *
 * Postgres は新しい関数の実行権限を、**作った役の既定**から決める。既定は 2 層ある —— 全体の既定と、
 * スキーマごとの既定で、**どちらも作成主体(`for role`)ごとに別の行**であり、**加算で効く**
 * (片方から外しても、もう片方の付与は残る。`in schema` の文は全体の行を消さない)。だから作成主体ごとに、
 * 全体からも各スキーマからも、`PUBLIC` と面のロールの**両方**を外す(`for role` を省くと実行した役の行しか
 * 書き換わらない)。`routines` を別に書かないのは、既定の権限の文では `functions` が手続きも含むからである。
 *
 * 作成主体の扱いは設定が決める。**必須の役**(と、実行した接続の役)は、実在するのにメンバーでなければ
 * **止まる**(`raise exception`。通知で飛ばすと、開いたままの役が緑で通る)。実在しなければ飛ばす(作れない役は
 * 関数を作らない)。**外部の役**(プラットフォームが持つ役)には触れない —— 閉じられないことを理由つきで
 * コメントに名指しし、保証は流す時点の一覧の剥奪と、閉世界の突合(function-acl-parity)が持つ。
 *
 * @param plan 関数の実行権限の計画
 * @returns SQL の行(先頭に空行を含む)
 */
export function functionExecuteSection(plan: FunctionAclPlan): readonly string[] {
  const closed = ['public', ...plan.revokeFrom].join(', ');
  const schemas = plan.schemas.map(sqlLiteral).join(', ');
  // 作成主体の並びは、流した接続の役を末尾に足して空にならない(必須の役が無い構成で `array[, …]` を出さない)。
  const creators = [...plan.requiredCreators.map(sqlLiteral), 'current_user::text'].join(', ');
  const externals = plan.externalCreators.map((creator) => sqlLiteral(creator.role)).join(', ');
  const revoked = plan.revokeFrom.map(sqlLiteral).join(', ');
  const [one, two, three] = [INDENT, INDENT.repeat(2), INDENT.repeat(3)];
  /**
   * 宣言の外の関数だけを選ぶ条件(拡張が持つ関数と、宣言した関数を除く。剥奪と事後条件が同じ母集合を見る)。宣言の配列は空でも型が
   * 決まる `array[…]::text[]` で出す(呼べる側が空の構成で型の無い `array[]` を出すと、要素の型が決まらず止まる)。
   */
  const outsideDeclaration = (indent: string): readonly string[] => [
    // `classid` も縛る: pg_depend の objid は別のカタログ(型・表など)の oid と同じ値になりうるので、関数のカタログに限らないと
    // 「拡張が持つ別の物」と oid が重なった関数が、剥奪と事後条件の母集合から黙って外れる。
    `${indent}and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')`,
    `${indent}and not exists (`,
    `${indent}${one}select 1`,
    `${indent}${one}  from unnest(array[`,
    ...plan.callable.map((fn, at) => `${indent}${INDENT.repeat(3)}${sqlLiteral(fn.identity)}${at < plan.callable.length - 1 ? ',' : ''}`),
    `${indent}${one}  ]::text[]) as declared(identity)`,
    `${indent}${one} where to_regprocedure(declared.identity)::oid = p.oid`,
    `${indent})`,
  ];
  /** 作成主体 1 つの既定を、全体と各スキーマから外す文(`creator` と `schema_name` が変数)。 */
  const closeDefaults = (indent: string): readonly string[] => [
    `${indent}execute format('alter default privileges for role %I revoke execute on functions from ${closed}', creator);`,
    `${indent}foreach schema_name in array array[${schemas}] loop`,
    `${indent}${one}if to_regnamespace(schema_name) is not null then`,
    `${indent}${two}execute format('alter default privileges for role %I in schema %I revoke execute on functions from ${closed}', creator, schema_name);`,
    `${indent}${one}end if;`,
    `${indent}end loop;`,
  ];
  const externalLoop =
    plan.externalCreators.length === 0
      ? []
      : [
          '',
          ...GRANTS_WORDS.functionExternalBestEffort.map((line) => `${one}-- ${line}`),
          `${one}for creator in select unnest(array[${externals}]::text[]) loop`,
          `${two}if exists (select 1 from pg_roles where rolname = creator)`,
          `${three}and pg_has_role(current_user, creator::name, 'MEMBER') then`,
          ...closeDefaults(three),
          `${two}end if;`,
          `${one}end loop;`,
        ];
  return [
    '',
    ...GRANTS_WORDS.functionGrants.map((line) => `-- ${line}`),
    ...externalNotes(plan.externalCreators),
    'do $$',
    'declare',
    `${one}fn record;`,
    `${one}creator text;`,
    `${one}schema_name text;`,
    `${one}leftovers text;`,
    'begin',
    `${one}for fn in`,
    `${two}select p.oid::regprocedure as signature`,
    `${two}  from pg_proc p`,
    `${two}  join pg_namespace n on n.oid = p.pronamespace`,
    `${two} where n.nspname in (${schemas})`,
    ...outsideDeclaration(`${two}   `),
    `${one}loop`,
    `${two}execute format('revoke all on routine %s from ${closed}', fn.signature);`,
    `${one}end loop;`,
    '',
    ...GRANTS_WORDS.functionDefaults.map((line) => `${one}-- ${line}`),
    `${one}for creator in select distinct unnest(array[${creators}]::text[]) loop`,
    `${two}if not exists (select 1 from pg_roles where rolname = creator) then`,
    `${three}continue;`,
    `${two}end if;`,
    `${two}if not pg_has_role(current_user, creator::name, 'MEMBER') then`,
    `${three}raise exception '${GRANTS_WORDS.blockedCreator}', creator using errcode = '42501';`,
    `${two}end if;`,
    ...closeDefaults(two),
    `${one}end loop;`,
    ...externalLoop,
    '',
    ...GRANTS_WORDS.functionPostcondition.map((line) => `${one}-- ${line}`),
    `${one}select string_agg(format('%s → %s', q.signature, q.grantee), ', ' order by q.signature, q.grantee)`,
    `${two}into leftovers`,
    `${one}  from (`,
    `${two}select p.oid::regprocedure::text as signature,`,
    `${two}       (case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end) as grantee`,
    `${two}  from pg_proc p`,
    `${two}  join pg_namespace n on n.oid = p.pronamespace`,
    `${two}  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a`,
    `${two} where n.nspname in (${schemas})`,
    ...outsideDeclaration(`${two}   `),
    `${two}   and a.privilege_type = 'EXECUTE'`,
    `${two}   and (a.grantee = 0 or pg_get_userbyid(a.grantee)::text = any(array[${revoked}]::text[]))`,
    `${one}) q;`,
    `${one}if leftovers is not null then`,
    `${two}raise exception '${GRANTS_WORDS.leftoverRoutines}', leftovers using errcode = '42501';`,
    `${one}end if;`,
    'end',
    '$$;',
  ];
}

/** SQL の行コメントに入れる文字列を 1 行にする(改行で行コメントが終わって後ろが SQL として読まれる形を避ける)。 */
function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * 外部の作成主体(migration から既定を閉じられない役)を名指しするコメント(無ければ出さない)。
 * 閉じていないことを黙らせない —— 保証が誰にあるかを生成物に残す。
 */
function externalNotes(externals: FunctionAclPlan['externalCreators']): readonly string[] {
  if (externals.length === 0) return [];
  return [
    '--',
    ...GRANTS_WORDS.externalCreators.map((line) => `-- ${line}`),
    ...externals.map((creator) => `--   ${oneLine(creator.role)}: ${oneLine(creator.reason)}`),
  ];
}
