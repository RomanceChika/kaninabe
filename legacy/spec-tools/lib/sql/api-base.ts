/**
 * **api スキーマの土台**の migration 1 枚(`{14 桁}_api_base.sql`)の組み立て。
 *
 * ## なぜこれが生成物なのか
 *
 * 外から届く surface を仕様の生成物だけにする(API スキーマ方式)には、その surface を置くスキーマと、
 * **呼び出し主体を解決する 2 本の関数**と、**ログインセッションがいまも生きているかを答える 1 本**(`session_alive`。
 * ログアウト・強制終了の後は、署名として有効なトークンでも偽を返し、RLS の制限ポリシーが全ての表で要求する)が先に要る。中身はプラットフォームの固有点(現在の実行者を返す式・
 * セッションの生死の式と DB ロールの名前。設定 `PlatformProfile` が与える)だけで決まり、**どのアプリでも同じ 1 枚**である —— にもかかわらず、
 * これまでは題材の製品のビューと同じ手書きの migration に埋まっていた。新しいアプリを起こす
 * たびに同じ 40 行を書き写す作業が残っていたということである。
 *
 * 仕様に現れるのは**書き出す先の名前**(`surface_base_migration`)だけで、中身に決める余地は無い。
 *
 * ## 冪等である
 *
 * `create schema if not exists` と `create or replace function` なので、既に土台のある DB に
 * 当てても何も変わらない(本文が同じなら `pg_proc` も動かない)。権限の `grant` / `revoke` も
 * 同じ状態への再宣言である。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { API_BASE_WORDS, DDL_WORDS } from '../messages/messages-ddl.js';
import { RPC_BODY_WORDS } from '../messages/messages.js';
import { sqlLiteral } from './guard-to-sql.js';
import type { PlatformProfile } from '../model/product/platform-profile.js';
import { callerRoles, endUserRoles } from './platform-sql.js';

/**
 * 土台の関数 1 本(名前・戻り値の型・本文・説明)。
 *
 * 期待表(`code-api-expectations.ts`)もこの宣言を読む —— 本文の字面が正であり、実 DB の
 * `pg_proc.prosrc` と md5 で突き合わせる(二重の正を作らない)。
 */
export interface BaseFunction {
  readonly name: string;
  readonly returns: string;
  readonly body: string;
  readonly comment: string;
  /**
   * 関数の持ち主の権限で実行するか(`security definer` + 空の `search_path`)。
   *
   * 呼び出し主体が読めない表(認証基盤のセッションの表)を読む関数だけが真である。期待表は定義の属性も
   * 実 DB の `pg_proc` と突き合わせる(属性が落ちれば、関数は持ち主の権限を失うか、呼び出し主体の
   * `search_path` で乗っ取られる)。
   */
  readonly definer: boolean;
}

/** 持ち主の権限で実行する土台の関数の `search_path`(空。本文はスキーマ修飾した綴りだけで書く)。 */
export const DEFINER_SEARCH_PATH = "''";

/** ログインセッションの生死を答える土台の関数の名前(RLS の制限ポリシーと隠し列の述語が呼ぶ)。 */
export const SESSION_ALIVE_FUNCTION = 'session_alive';

/**
 * 呼び出し主体を解決する 2 本と、セッションの生死を答える 1 本(プラットフォームの固有点は設定 `PlatformProfile` に閉じる)。
 *
 * @param profile プラットフォームの設定(現在の実行者を返す式・一般利用者のロール名)
 * @returns 土台の関数(宣言順)
 */
export function apiBaseFunctions(profile: PlatformProfile): readonly BaseFunction[] {
  return [
    {
      name: 'actor_id',
      returns: 'uuid',
      body: `select ${profile.currentActorExpr};`,
      comment: API_BASE_WORDS.actorId,
      definer: false,
    },
    {
      name: 'is_end_user',
      returns: 'boolean',
      body: `select current_user in (${endUserRoles(profile).map((role) => `'${role}'`).join(', ')});`,
      comment: API_BASE_WORDS.isEndUser,
      definer: false,
    },
    {
      name: SESSION_ALIVE_FUNCTION,
      returns: 'boolean',
      body: `select ${profile.sessionAliveExpr};`,
      comment: API_BASE_WORDS.sessionAlive,
      definer: true,
    },
  ];
}

/**
 * 土台の関数を呼べる DB ロール(`grant execute` の宛先。期待表もここを読む)。
 *
 * @param profile プラットフォームの設定
 * @returns ロール名の並び
 */
export function apiBaseGrantees(profile: PlatformProfile): readonly string[] {
  return callerRoles(profile);
}

/**
 * その関数の本文が実 DB の `pg_proc.prosrc` に載る字面(`$$` の内側そのまま)。
 *
 * DDL の組み立てと同じ 1 か所からこれを出すので、期待と生成 SQL が同時にずれない。
 *
 * @param fn 土台の関数 1 本
 * @returns prosrc と一致する字面
 */
export function apiBaseSource(fn: BaseFunction): string {
  return `\n    ${fn.body}\n`;
}

/**
 * api スキーマの土台の migration を組み立てる。
 *
 * @param profile プラットフォームの設定(外に出すスキーマ・ロール名・現在の実行者の式)
 * @returns SQL 1 枚(末尾に改行を含む)
 */
export function buildApiBaseMigration(profile: PlatformProfile): string {
  const schema = profile.exposedSchema;
  return [
    ...header(),
    '',
    `-- ${API_BASE_WORDS.schema}`,
    `create schema if not exists ${schema};`,
    `grant usage on schema ${schema} to ${callerRoles(profile).join(', ')};`,
    ...apiBaseFunctions(profile).flatMap((fn) => ['', `-- ${schema}.${fn.name}()`, ...declare(fn, profile)]),
    '',
  ].join('\n');
}

/** 先頭の AUTO-GENERATED ヘッダ(SQL コメント)。 */
function header(): readonly string[] {
  return [
    `-- ${RPC_BODY_WORDS.generatedHeader}`,
    '--',
    ...API_BASE_WORDS.generatedNote.map((line) => `-- ${line}`),
    '--',
    ...DDL_WORDS.migrationNote.map((line) => `-- ${line}`),
  ];
}

/** 関数 1 本の定義・説明・権限。 */
function declare(fn: BaseFunction, profile: PlatformProfile): readonly string[] {
  const signature = `${profile.exposedSchema}.${fn.name}()`;
  return [
    `create or replace function ${signature} returns ${fn.returns}`,
    'language sql',
    'stable',
    ...(fn.definer ? ['security definer', `set search_path = ${DEFINER_SEARCH_PATH}`] : []),
    'as $$',
    `    ${fn.body}`,
    '$$;',
    '',
    `comment on function ${signature} is ${sqlLiteral(fn.comment)};`,
    '',
    `revoke all on function ${signature} from public;`,
    `grant execute on function ${signature} to ${callerRoles(profile).join(', ')};`,
  ];
}
