/**
 * 複合 RPC の SQL 断片(式・手順・再送の読み直し)の組み立て。
 *
 * code-usecase-rpc.ts が「ファイル 1 枚の骨格」を、ここが「1 手順ぶんの字面」を持つ
 * (どちらも「保存点 → plpgsql」という 1 つの写像の一部である)。
 *
 * **アプリの語彙は 1 語も持たない。** 表名・列名・状態名はすべて引数で渡された解決結果
 * (param-source.ts の `ParamSource`)から来る。
 */

import { sqlStringLiteral } from '../../kernel/safe-text.js';
import type { FieldDef } from '../../model/types.js';
import type { ResolvedParam } from '../../usecase/param-source.js';
import type { CompositeParamSource, CompositeResolvedParam } from '../../usecase/save-renderable.js';
import type { ReadbackQuery, RowId, RowNarrow } from '../../usecase/save-readback.js';
import { readbackPlans } from '../../usecase/save-readback.js';
import type { ResendPolicy } from '../../usecase/resend-policy.js';
import type { PlanProblem, SavePlan, SaveStepPlan } from '../../usecase/step-plan.js';
import type { PlatformProfile } from '../../model/product/platform-profile.js';
import { exposed } from '../../sql/platform-sql.js';
import { raiseRefusal } from '../../sql/refusal-codes.js';
import { columnExpression, JSON_TEXT_TYPE } from '../../sql/sql-types.js';

/** SQL の文字列リテラル(単引用符のエスケープ込み)。 */
export function sqlString(value: string): string {
  return sqlStringLiteral(value);
}

/** その手順の入力の根(繰り返しなら配列の 1 要素、そうでなければ `p_input` の別名のキー)。 */
function inputRoot(step: SaveStepPlan): string {
  return step.repeat ? 'v_element' : `p_input -> ${sqlString(step.alias)}`;
}

/** 入力から 1 欄を取り出す式(型どおりに cast する。写像は `sql-types.ts` の 1 本)。 */
function fieldExpression(step: SaveStepPlan, field: string, type: FieldDef['type']): string {
  return columnExpression(`${inputRoot(step)} ->> ${sqlString(field)}`, JSON_TEXT_TYPE, type);
}

/**
 * 引数 1 本に渡す式を組み立てる。
 *
 * @param step その手順
 * @param source 解決済みの供給元(**複合 RPC に写せる形に絞られている**。計算値
 *   (`computes`)と編集の副作用はここに来ない —— 型で除いてあるので既定の枝が要らず、
 *   「前提が破れたら throw する」枝を持たずに網羅できる。絞り込みは
 *   `usecase/save-renderable.ts` が、絞れなかったときの 3 点セット(`unreadbackable`)は
 *   `usecase/save-readback.ts` が持ち、検査 Y12 が同じ関数で先に止める)
 * @param variables 手順番号 → 行変数名
 * @param indent 折り返す式(jsonb_build_object)の継続行に付ける字下げ
 * @returns SQL の式
 */
function paramExpression(
  step: SaveStepPlan,
  source: CompositeParamSource,
  variables: ReadonlyMap<number, string>,
  indent: string,
): string {
  switch (source.kind) {
    case 'idempotency_key':
      return 'p_id';
    case 'new_id':
      return 'gen_random_uuid()';
    case 'actor':
      return 'p_actor_id';
    case 'actor_roles':
      return 'p_actor_roles';
    case 'expected_state':
      return source.literal === null
        ? `p_expected ->> ${sqlString(`${source.entity}.${source.field}`)}`
        : sqlString(source.literal);
    case 'next_state':
      return sqlString(source.state);
    case 'effects':
      return source.effects.length === 0
        ? 'array[]::text[]'
        : `array[${source.effects.map(sqlString).join(', ')}]::text[]`;
    case 'event_id':
      return sqlString(source.event);
    case 'step_result_id':
      return `${variables.get(source.step) ?? 'null'}.id`;
    case 'input_field':
      return fieldExpression(step, source.field, source.type);
    case 'not_written':
      // 遷移が自分で決めない列(A6-1)。空を渡し、「触れない / 空にする」は遷移の RPC の本文が
      // 宣言(`clears`)どおりに扱う —— 単発の経路と同じ値・同じ契約である(rpc-parity が本文を見る)。
      return 'null';
    case 'input_target_id':
      return `(${inputRoot(step)} ->> 'id')::uuid`;
    case 'input_values':
    case 'input_changes':
      return valuesExpression(step, source.fields, indent);
  }
}

/** `p_values` に渡す jsonb(入力欄のうち他の引数が受け取っていない残り)。 */
function valuesExpression(step: SaveStepPlan, fields: readonly FieldDef[], indent: string): string {
  if (fields.length === 0) return "'{}'::jsonb";
  const root = inputRoot(step);
  const pairs = fields.map((field) => `${indent}    ${sqlString(field.name)}, ${root} -> ${sqlString(field.name)}`);
  return `jsonb_build_object(\n${pairs.join(',\n')}\n${indent})`;
}

/** 手順 1 つの RPC 呼び出し(名前付き記法。RPC の置き場は設定の外に出すスキーマ)。 */
export function callStatement(
  step: SaveStepPlan,
  params: readonly CompositeResolvedParam[],
  variables: ReadonlyMap<number, string>,
  indent: string,
  platform: PlatformProfile,
): string {
  const args = params.map(
    (param) => `${indent}    ${param.name} => ${paramExpression(step, param.source, variables, `${indent}    `)}`,
  );
  const target = variables.get(step.index) ?? 'v_row';
  return [
    `${indent}select * into ${target} from ${exposed(platform, step.fn.name)}(`,
    args.join(',\n'),
    `${indent});`,
    `${indent}if not found then`,
    raiseRefusal('conflict', step.op, `${indent}    `),
    `${indent}end if;`,
  ].join('\n');
}

/** 再送(冪等)のときに 1 手順の結果を読み直す SQL 式(別名つき)。 */
export interface ReadbackEntry {
  /** 手順の別名(返す jsonb の鍵)。 */
  readonly alias: string;
  /** その行を既存の行から読み直す式(plpgsql の字面)。 */
  readonly expression: string;
}

/** 再送の読み直しの結果。`anchor` が null なら冪等の錨が無い(再送の節を持たない)。`resend` は錨の表の方針。 */
export type ReadbackResult =
  | {
      readonly ok: true;
      readonly anchor: SaveStepPlan | null;
      readonly resend: ResendPolicy | null;
      readonly entries: readonly ReadbackEntry[];
    }
  | { readonly ok: false; readonly problems: readonly PlanProblem[] };

/** 行 1 つの id を返す式(最初に作る行は再送のキー `p_id`、ほかは鎖で引く副問い合わせ)。 */
function rowIdExpression(id: RowId): string {
  if (id.kind === 'first') return 'p_id';
  return (
    `(select t.id from public.${id.table} t ` +
    `where t.${id.column} = ${rowIdExpression(id.parent)}${narrowExpression(id.narrow)} limit 1)`
  );
}

/** 行を 1 つに定める追加の条件(不要なら空文字)。 */
function narrowExpression(narrow: RowNarrow): string {
  switch (narrow.kind) {
    case 'none':
      return '';
    case 'actor_column':
      return ` and t.${narrow.column} = p_actor_id`;
    case 'excluding':
      return narrow.ids.map((id) => ` and t.id <> ${rowIdExpression(id)}`).join('');
  }
}

/**
 * 読み直しの問い合わせの構造を、`select ...` の丸括弧つき式にする。
 *
 * 繰り返しの手順は配列(id 順で安定させる)、そうでなければ 1 行。
 *
 * @param query 導出の層(`usecase/save-readback.ts`)が返した問い合わせの構造
 * @returns plpgsql の式
 */
function readbackExpression(query: ReadbackQuery): string {
  if (query.kind === 'by_id') {
    return `(select to_jsonb(t) from public.${query.table} t where t.id = ${rowIdExpression(query.id)})`;
  }
  const where = `where t.${query.column} = ${rowIdExpression(query.parent)}${narrowExpression(query.narrow)}`;
  if (query.repeat) {
    return (
      `(select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) ` +
      `from public.${query.table} t ${where})`
    );
  }
  return `(select to_jsonb(t) from public.${query.table} t ${where} limit 1)`;
}

/**
 * 再送(冪等)のときに全手順の結果を既存の行から読み直す式を組む。
 *
 * **判定は `readbackPlans`(導出の層。検査 Y12 と共有)が 1 度だけ行う** —— ここは返ってきた
 * 問い合わせの構造を SQL の字面にするだけで、読み直せるかどうかの判定を持たない。生成器が同じ判定を
 * もう一度回すと、条件がずれた瞬間に `jsonb_build_object('alias', )` のような空の式が migration に
 * 出て、壊れるのは DB に当てたときになる(束 ⑲-1 のレビュー)。
 *
 * @param plan 接地済みの保存点
 * @param steps 手順ごとの解決済み引数(宣言順)
 * @returns 錨と読み直しの式、または読み直せない手順の問題(3 点セット)
 */
export function readbackEntries(
  plan: SavePlan,
  steps: readonly (readonly ResolvedParam[])[],
): ReadbackResult {
  const planned = readbackPlans(plan, steps);
  if (!planned.ok) return planned;
  return {
    ok: true,
    anchor: planned.anchor,
    resend: planned.resend,
    entries: planned.entries.map((entry) => ({ alias: entry.alias, expression: readbackExpression(entry.query) })),
  };
}
