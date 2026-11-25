/**
 * **外から届く surface**の migration 1 枚(`{14 桁}_api_view_{表}.sql`)の組み立て。
 *
 * 中身は 3 つで、上から順に依存している。
 *
 *   1. 隠し列の述語(`create or replace function api.can_see_{表}_{列}`。security invoker —— 点検 3 回目 A3-5)
 *   2. ビュー本体(`drop view if exists` → `create view … with (security_invoker = true)`)
 *   3. 権限(読みだけを一般の呼び出し主体へ)
 *
 * 計画(`api-views.ts`)が決めた列と述語を SQL の字面に写すだけであり、ここに判断は無い。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { sqlCommentText } from '../kernel/safe-text.js';
import { API_VIEW_WORDS } from '../messages/messages-api.js';
import { RPC_BODY_WORDS } from '../messages/messages.js';
import { MASK_ROW_ALIAS, type ApiMaskPlan, type ApiViewPlan } from './api-views.js';
import type { PlatformProfile } from '../model/product/platform-profile.js';
import { callerRoles, endUserRoles, privilegedRole } from './platform-sql.js';

/** 元の表が置かれているスキーマ。 */
const BASE_SCHEMA = 'public';

/** ビューの中で元の行に付ける別名。 */
const ROW_ALIAS = 't';

/*
 * 宛先のロール名(読みだけを開ける一般利用者・内部実行・隠し列の述語を実行できる全ロール)の正は
 * プラットフォームの設定(`platform-sql.ts` が引く)にある —— **同じ 1 組から SQL と期待
 * (`api-acl.ts`)の両方が出る**(片方だけを直す非対称を作らない。`api-parity` がこの `grant` を
 * 閉世界で突き合わせる)。ロール名の字面をこのファイルに残すと、surface のロールが増えた日に
 * `grant select` の側だけが直る(片方だけが古くなる)。
 */

/** ビューの migration の組み立てに要る入力。 */
export interface ApiViewMigrationInput {
  /** そのビューの計画。 */
  readonly plan: ApiViewPlan;
  /**
   * **内部テーブルのビューか**(surface のロールに何も与えない側)。
   *
   * 宛先の 1 ビットは `api-acl.ts` が持つ判断と同じものであり、ここは SQL の字面に写すだけで
   * ある —— 内部テーブルの surface は「ジョブの実行者が特権ロールで読み書きする経路」のためだけに
   * あり、`anon` / `authenticated` に `select` を与えると**surface から完全に消える**という性質が
   * その場で崩れる。
   */
  readonly internal: boolean;
  /** この SQL の正になる仕様ファイル(リポジトリルート相対)。 */
  readonly specFiles: readonly string[];
  /** プラットフォームの設定(surface を置くスキーマ・ロール名の写像)。 */
  readonly platform: PlatformProfile;
}

/**
 * 1 テーブル分の surface(隠し列の述語・ビュー・権限)の migration を組み立てる。
 *
 * @param input ビューの計画と正の所在
 * @returns SQL 1 枚(末尾に改行を含む)
 */
export function buildApiViewMigration(input: ApiViewMigrationInput): string {
  const view = `${input.platform.exposedSchema}.${input.plan.table}`;
  return [
    ...header(input.specFiles),
    ...(input.plan.masks.length === 0
      ? []
      : ['', ...comment(API_VIEW_WORDS.maskSection), ...input.plan.masks.flatMap((mask) => maskFunction(mask, input.plan.table, input.platform))]),
    '',
    ...comment(API_VIEW_WORDS.viewSection),
    ...comment(API_VIEW_WORDS.replaceView),
    ...(input.plan.masks.length === 0 ? [] : comment(API_VIEW_WORDS.maskCase)),
    `drop view if exists ${view};`,
    '',
    `create view ${view} with (security_invoker = true) as`,
    'select',
    ...input.plan.columns.map((column, index) => {
      const expression =
        column.mask === null ? plain(column.name) : masked(column.name, column.mask, input.platform.exposedSchema);
      return `    ${expression}${index === input.plan.columns.length - 1 ? '' : ','}`;
    }),
    `from ${BASE_SCHEMA}.${input.plan.table} ${ROW_ALIAS};`,
    '',
    ...comment(input.internal ? API_VIEW_WORDS.internalGrants(endUserRoles(input.platform)) : API_VIEW_WORDS.grants),
    ...(input.internal ? [] : [`grant select on ${view} to ${endUserRoles(input.platform).join(', ')};`]),
    `grant all on ${view} to ${privilegedRole(input.platform)};`,
    '',
  ].join('\n');
}

/** 素の列(元の行をそのまま通す)。 */
function plain(column: string): string {
  return `${ROW_ALIAS}.${column}`;
}

/** 隠し列(述語が解けたときだけ値を通す)。 */
function masked(column: string, mask: ApiMaskPlan, schema: string): string {
  return (
    `case when not ${schema}.is_end_user() or ${schema}.${mask.name}(${ROW_ALIAS}) ` +
    `then ${ROW_ALIAS}.${column} else null end as ${column}`
  );
}

/** 隠し列の述語 1 本(由来のコメント + 定義 + 権限)。 */
function maskFunction(mask: ApiMaskPlan, table: string, platform: PlatformProfile): readonly string[] {
  const schema = platform.exposedSchema;
  const signature = `${schema}.${mask.name}(${BASE_SCHEMA}.${table})`;
  return [
    '',
    `-- ${API_VIEW_WORDS.maskOrigin(mask.column, mask.visibleTo)}`,
    `create or replace function ${schema}.${mask.name}(${MASK_ROW_ALIAS} ${BASE_SCHEMA}.${table}) returns boolean`,
    'language sql',
    'stable',
    // 呼び出した人の権限で評価する(A3-5)。面のロールは述語を直接呼べる(ビューは security_invoker なので、述語の実行権限を
    // 外すとビューを読めなくなる)ので、定義者の権限で評価すると RLS で見えない親の状態を 1 ビットずつ探れる口になる。
    // 述語はその表の RLS のポリシーと同じ式であり、ポリシーも呼び出した人の権限で評価される(実行者の解決は definer の補助関数)。
    'security invoker',
    `set search_path = ${BASE_SCHEMA}`,
    'as $$',
    `    select ${mask.predicate};`,
    '$$;',
    '',
    `revoke all on function ${signature} from public;`,
    `grant execute on function ${signature} to ${callerRoles(platform).join(', ')};`,
  ];
}

/** 何行かの説明を SQL コメントにする。 */
function comment(lines: readonly string[]): readonly string[] {
  return lines.map((line) => `-- ${line}`);
}

/** 先頭の AUTO-GENERATED ヘッダ(SQL コメント)。 */
function header(specFiles: readonly string[]): readonly string[] {
  return [
    `-- ${RPC_BODY_WORDS.generatedHeader}`,
    '--',
    ...RPC_BODY_WORDS.generatedNote.map((line) => `-- ${line}`),
    ...specFiles.map((file) => `--   - ${sqlCommentText(file)}`),
    '--',
    ...API_VIEW_WORDS.migrationNote.map((line) => `-- ${line}`),
  ];
}
