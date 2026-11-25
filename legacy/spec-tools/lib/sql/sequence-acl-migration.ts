/**
 * 権限の migration(`{14 桁}_grants.sql`)のうち、**sequence の権限の閉世界**の節の字面(点検 3 回目 A3-6)。
 *
 * sequence は表と別の物であり、表の `revoke all` は sequence に効かない。プラットフォームの既定の付与(作成主体ごとの
 * 既定の権限の `S`)は面のロールに `usage` / `select` / `update` を与えるので、採番の器(`nextval` / `setval`)を面のロールが
 * 動かせる形が残っていた(`setval` で採番を巻き戻すと一意の衝突で妨害できる)。面のロールは表へ直に書かない(書き込みは全部
 * security definer の RPC を通る)ので、sequence の権限を 1 つも要らない。
 *
 * 計画は関数の閉世界と同じもの(スキーマ・面のロール・作成主体)を使い、既存の sequence の剥奪・作成主体ごとの既定の付与の閉鎖・
 * 事後条件(面のロールか PUBLIC の権限が残っていれば止まる)の 3 つを 1 つの do ブロックに出す。外部の作成主体(プラットフォームが
 * 持つ役)は関数の節と同じく、メンバーのときだけ閉じる。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { GRANTS_WORDS } from '../messages/messages-ddl.js';
import { sqlLiteral } from './guard-to-sql.js';
import type { FunctionAclPlan } from './function-acl.js';

/** do ブロックの中の字下げ。 */
const INDENT = '    ';

/**
 * sequence の権限の閉世界(計画のスキーマの全 sequence から面のロールと PUBLIC の権限を外し、新しい sequence の既定の付与も
 * 作成主体ごとに閉じる)。拡張が持つ sequence は除く(関数の節と同じ母集合の取り方)。
 *
 * @param plan 関数の実行権限の計画(スキーマ・面のロール・作成主体を共有する)
 * @returns SQL の行(先頭に空行を含む)
 */
export function sequenceSection(plan: FunctionAclPlan): readonly string[] {
  const closed = ['public', ...plan.revokeFrom].join(', ');
  const schemas = plan.schemas.map(sqlLiteral).join(', ');
  const creators = [...plan.requiredCreators.map(sqlLiteral), 'current_user::text'].join(', ');
  const externals = plan.externalCreators.map((creator) => sqlLiteral(creator.role)).join(', ');
  const revoked = plan.revokeFrom.map(sqlLiteral).join(', ');
  const [one, two, three] = [INDENT, INDENT.repeat(2), INDENT.repeat(3)];
  /** 計画のスキーマの sequence(拡張が持つものを除く)を選ぶ条件。 */
  const sequences = (indent: string, join?: string): readonly string[] => [
    `${indent}  from pg_class c`,
    `${indent}  join pg_namespace n on n.oid = c.relnamespace`,
    ...(join === undefined ? [] : [join]),
    `${indent} where c.relkind = 'S'`,
    `${indent}   and n.nspname in (${schemas})`,
    `${indent}   and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')`,
  ];
  /** 作成主体 1 つの既定を、全体と各スキーマから外す文(`creator` と `schema_name` が変数)。 */
  const closeDefaults = (indent: string): readonly string[] => [
    `${indent}execute format('alter default privileges for role %I revoke all on sequences from ${closed}', creator);`,
    `${indent}foreach schema_name in array array[${schemas}] loop`,
    `${indent}${one}if to_regnamespace(schema_name) is not null then`,
    `${indent}${two}execute format('alter default privileges for role %I in schema %I revoke all on sequences from ${closed}', creator, schema_name);`,
    `${indent}${one}end if;`,
    `${indent}end loop;`,
  ];
  const externalLoop =
    plan.externalCreators.length === 0
      ? []
      : [
          `${one}for creator in select unnest(array[${externals}]::text[]) loop`,
          `${two}if exists (select 1 from pg_roles where rolname = creator)`,
          `${three}and pg_has_role(current_user, creator::name, 'MEMBER') then`,
          ...closeDefaults(three),
          `${two}end if;`,
          `${one}end loop;`,
        ];
  return [
    '',
    ...GRANTS_WORDS.sequenceGrants.map((line) => `-- ${line}`),
    'do $$',
    'declare',
    `${one}seq record;`,
    `${one}creator text;`,
    `${one}schema_name text;`,
    `${one}leftovers text;`,
    'begin',
    `${one}for seq in`,
    `${two}select c.oid::regclass as name`,
    ...sequences(two),
    `${one}loop`,
    `${two}execute format('revoke all on sequence %s from ${closed}', seq.name);`,
    `${one}end loop;`,
    '',
    `${one}for creator in select distinct unnest(array[${creators}]::text[]) loop`,
    `${two}if not exists (select 1 from pg_roles where rolname = creator) then`,
    `${three}continue;`,
    `${two}end if;`,
    `${two}if not pg_has_role(current_user, creator::name, 'MEMBER') then`,
    `${three}raise exception '${GRANTS_WORDS.blockedSequenceCreator}', creator using errcode = '42501';`,
    `${two}end if;`,
    ...closeDefaults(two),
    `${one}end loop;`,
    ...externalLoop,
    '',
    `${one}select string_agg(format('%s → %s', q.name, q.grantee), ', ' order by q.name, q.grantee)`,
    `${two}into leftovers`,
    `${one}  from (`,
    `${two}select c.oid::regclass::text as name,`,
    `${two}       (case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end) as grantee`,
    ...sequences(two, `${two}  cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a`),
    `${two}   and (a.grantee = 0 or pg_get_userbyid(a.grantee)::text = any(array[${revoked}]::text[]))`,
    `${one}) q;`,
    `${one}if leftovers is not null then`,
    `${two}raise exception '${GRANTS_WORDS.leftoverSequences}', leftovers using errcode = '42501';`,
    `${one}end if;`,
    'end',
    '$$;',
  ];
}
