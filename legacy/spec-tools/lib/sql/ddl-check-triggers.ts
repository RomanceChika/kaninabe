/**
 * **条件を課すトリガ**の本文を、不変条件の `formal` から組み立てる。
 *
 * ## なぜ本文が生成物になるのか
 *
 * `ddl-copy-triggers.ts` は「**値の決め方が宣言から完全に読める**ものだけ本文を生成する」と
 * いう線を引いた(祖先の列の写し)。同じ線は**条件の確かめ方**の側にも引ける ——
 * `formal.type: check` の式は `check-expression.ts` が正準表記の SQL 式に写し、写せなければ
 * 理由を報告する(T16)。トリガの本文はその式を `if not (…) then raise exception using …` で包むだけで
 * あり、文面も `invariant.statement` から出る —— **文面は `using message` で渡す**(第 1 引数に
 * 置くと plpgsql の書式文字列になり、自由な日本語に `%` が 1 つ入るだけで発火時に落ちる)。
 *
 * ## 出さない発火
 *
 * `fires` が **`delete` を含む**宣言では本文を出さない(BEFORE DELETE では `NEW` が空で、
 * `return new` がその削除を取り消す)。`deferred: true` で timing が `after` でない宣言も
 * 出さない(Postgres が before の制約トリガを拒否する)。どちらも「生成できない理由」として
 * 宣言するので、T17 が `handwritten` を要求する。
 *
 * ## 2 つの形しかない
 *
 * | 宣言 | 本文 | なぜ |
 * |---|---|---|
 * | `deferred: false` | `new` の欄を見て `if not (…) then raise` | その文が作ろうとしている行そのものを見る |
 * | `deferred: true` | **いまの行を読み直して**見る(`exists (select 1 from {表} t where t.id = new.id and not (…))`) | 遅延トリガはコミット時に発火するので `new` は「その文の時点の姿」でしかない。読み直して行が無ければ何も課さない(ARCH-SP-BE-0001 の MUST) |
 *
 * 読み直す形は**定義者の権限で実行する**(`security definer`)—— RLS が効いた接続から実行されると
 * 読み直しが 0 行になり、条件を確かめずに素通りするからである。
 *
 * ## 反映されないもの
 *
 * `cardinality`・集合や単調性を見るもの・`formal` を持たないもの・`now` を含むものは
 * 反映されない。**参照の欄が指す行の列を定数と比べる式**(`check` と `state_dependency`)は、その行を読む BEFORE の本文になる
 * (判定は `model/data/ref-check-shape.ts`・本文は `ddl-ref-check-body.ts`。fix25s)。**別の集約の欄を見る式**は、2 つの集約の一致(参照の欄 1 段・required・両端に 1 本ずつ)なら
 * 結合した 2 つの行を読む本文になる(`cross-check-plan.ts` が読み方と同時実行の約束を持つ)。それ以外は反映されない。**理由は `check-expression.ts` が既に報告している
 * 文言そのまま**なので、新しい語彙は要らない。値を**供給する**トリガ(`supplies`)はこちらの
 * 担当ではない(写しの生成が受け持つ)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { EntitySpec, InvariantDef, SpecModel } from '../model/types.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import type { DataTableSpec, DataTriggerDecl } from '../model/data/types.js';
import { DDL_WORDS } from '../messages/messages-ddl.js';
import { checkExpressionOf } from './check-expression.js';
import { HOST_ALIAS, OTHER_ALIAS, crossCheckOf } from './cross-check-plan.js';
import { crossBodyOf, refusalLines } from './ddl-cross-check-body.js';
import { watchedColumnsOf } from '../model/data/cross-check-shape.js';
import { columnsOfRoot, refCheckOf, type RefCheckPlan } from '../model/data/ref-check-shape.js';
import { formalExpr } from '../model/formal-expr.js';
import { collectPaths } from '../guard/services.js';
import { refCheckBodyOf } from './ddl-ref-check-body.js';
import { impliedLocksOf } from '../model/data/check-trigger-locks.js';
import type { LockStrength } from '../model/data/types-locks.js';
import type { DdlTrigger } from './ddl-guards.js';
import { firesClause, parseFires, updatedColumnsOf } from '../model/trigger-fires.js';

/** 全テーブルが持つ主キー列(読み直すときの鍵)。 */
const KEY = 'id';

/** 遅延トリガが読み直す行に付ける別名。 */
const ALIAS = 't';

/**
 * 本文を出せる発火のイベント(**`delete` は出さない**)。
 *
 * BEFORE DELETE の行トリガでは `NEW` が空であり、`return new` は **その削除の取り消し**に
 * なる(遅延の側も `new.id` が空になって読み直しが空振りする)。`tg_op` で分岐する形も書けるが、
 * **「削除を条件で弾く」実例が 1 つも無い**ので出さないほうが正直である(要る日が来たら、
 * その実例と一緒に買う)。
 */
const WRITABLE_EVENTS: ReadonlySet<string> = new Set(['insert', 'update']);

/** 本文を組み立てられなかったときの結果(理由は Finding の字面になる)。 */
export type CheckTriggerResult =
  | { readonly ok: true; readonly trigger: DdlTrigger }
  | { readonly ok: false; readonly reason: string };

/**
 * その表のトリガのうち、**条件を課す本文を生成できるもの**の計画。
 *
 * @param table テーブル仕様
 * @param domain ドメイン仕様(不変条件と欄を引く)
 * @returns 生成するトリガ(宣言順)。1 本も無ければ空
 */
export function checkTriggersIn(
  table: DataTableSpec,
  domain: SpecModel,
  tables: readonly DataTableSpec[] = [],
): readonly DdlTrigger[] {
  const planned: DdlTrigger[] = [];
  for (const trigger of table.triggers) {
    const built = checkTriggerOf(trigger, table, domain, tables);
    if (built.ok) planned.push(built.trigger);
  }
  return planned;
}

/**
 * トリガ 1 本の本文を組み立てる(組み立てられなければ理由を返す)。
 *
 * **判定は 1 本である** —— 生成する側(`checkTriggersIn`)と、生成できないことを宣言する側
 * (T 群)が同じ関数を呼ぶ。2 か所に書くと片方だけが直る。
 *
 * @param trigger トリガの宣言
 * @param table テーブル仕様
 * @param domain ドメイン仕様
 * @param tables 全 data_table(別の集約の列との等式で、相手の物理テーブル名を引く。省略時は空)
 * @returns 計画、または生成できない理由
 */
export function checkTriggerOf(
  trigger: DataTriggerDecl,
  table: DataTableSpec,
  domain: SpecModel,
  tables: readonly DataTableSpec[] = [],
): CheckTriggerResult {
  if (trigger.supplies.length > 0) {
    return { ok: false, reason: '値を供給するトリガである(本文の生成は「祖先の列の写し」が受け持つ)' };
  }
  const entity = table.entity === undefined ? null : findEntitySpec(domain, table.entity);
  if (entity === null) {
    return { ok: false, reason: `表 ${table.table} は entity を持たないので、列の正がどこにも無い` };
  }
  const invariantId = trigger.invariant;
  if (invariantId === undefined) {
    return { ok: false, reason: '不変条件を宣言していない(条件式の出どころが宣言のどこにも無い)' };
  }
  // 参照の欄が指す行の列を見る条件は、その行を読む BEFORE の本文になる(`model/data/ref-check-shape.ts`。fix25s)。
  const ref = refCheckOf(trigger, table, domain, tables);
  if (ref.kind === 'refused') return { ok: false, reason: ref.reason };
  if (ref.kind === 'ok') {
    const missing = unwatchedColumns(trigger, table, entity, domain);
    if (missing !== null) return { ok: false, reason: missing };
    return refCheckTrigger(trigger, entity, domain, invariantId, ref.plan, impliedLocksOf(trigger, table, domain, tables));
  }
  // 別の集約の列との等式は、結合した 2 つの行を読む本文になる(`cross-check-plan.ts`)。
  const cross = crossCheckOf(trigger, table, domain, tables);
  if (cross.kind === 'refused') return { ok: false, reason: cross.reason };
  const crossPlan = cross.kind === 'ok' ? cross.plan : null;
  const written =
    crossPlan === null
      ? checkExpressionOf(invariantId, entity, domain, { alias: trigger.deferred ? ALIAS : 'new' })
      : checkExpressionOf(invariantId, crossPlan.host.entity, domain, {
          alias: HOST_ALIAS,
          related: { entity: crossPlan.other.entity, alias: OTHER_ALIAS },
        });
  if (!written.ok) return { ok: false, reason: written.reason };
  const clause = firesClause(trigger.fires ?? '');
  if (clause === null) {
    return {
      ok: false,
      reason: 'fires の宣言からいつ・何で実行するかを読めない(流せる発火の節を組み立てられない)',
    };
  }
  if (crossPlan === null) {
    const missing = unwatchedColumns(trigger, table, entity, domain);
    if (missing !== null) return { ok: false, reason: missing };
  }
  const fires = parseFires(trigger.fires ?? '');
  const unwritable = fires.events.filter((event) => !WRITABLE_EVENTS.has(event));
  if (unwritable.length > 0) {
    return {
      ok: false,
      reason:
        `条件を課すトリガの本文は insert / update にしか出せない(fires が ${unwritable.join(' / ')} を含む)` +
        ' —— 削除では NEW が空で、行を返す形がその削除を取り消してしまう',
    };
  }
  if (trigger.deferred && fires.timing !== 'after') {
    return {
      ok: false,
      reason:
        'コミット時評価の制約トリガは after でなければならない' +
        `(fires の timing が ${fires.timing ?? '読めない'} である)—— Postgres は before の制約トリガを拒否する`,
    };
  }
  const invariant = findInvariant(invariantId, domain);
  return {
    ok: true,
    trigger: {
      name: trigger.name,
      ...clause,
      ...(trigger.deferred ? { deferred: true } : {}),
      function: {
        name: trigger.functionName,
        comment: `${DDL_WORDS.checkTrigger}(${invariantId})`,
        body:
          crossPlan === null
            ? bodyOf(trigger, table, written.expression, invariant)
            : crossBodyOf(crossPlan, trigger.name, written.expression),
        ...(trigger.deferred ? { securityDefiner: true } : {}),
      },
    },
  };
}

/** 参照の欄が指す行を読む条件のトリガ(判定が通った計画から本文を組む)。 */
function refCheckTrigger(
  trigger: DataTriggerDecl,
  entity: EntitySpec,
  domain: SpecModel,
  invariantId: string,
  plan: RefCheckPlan,
  strengths: Readonly<Record<string, LockStrength>>,
): CheckTriggerResult {
  const written = checkExpressionOf(invariantId, entity, domain, {
    alias: 'new',
    related: plan.rows.map((row) => ({ entity: row.entity, alias: row.variable })),
    implication: true,
  });
  if (!written.ok) return { ok: false, reason: written.reason };
  const clause = firesClause(trigger.fires ?? '');
  if (clause === null) return { ok: false, reason: 'fires の宣言からいつ・何で実行するかを読めない(流せる発火の節を組み立てられない)' };
  const refusal = refusalLines(trigger.name, invariantId, plan.invariant.statement);
  return {
    ok: true,
    trigger: {
      name: trigger.name,
      ...clause,
      // 定義者の権限で読む(RLS や表の権限の効いた接続から挿入されると、参照の欄の行が読めず条件を確かめられない。相手の端と同じ)。
      function: { name: trigger.functionName, comment: `${DDL_WORDS.checkTrigger}(${invariantId})`, body: refCheckBodyOf(plan, written.expression, refusal, strengths), securityDefiner: true },
    },
  };
}

/**
 * `fires` の `update of` が、**本文が読む自表の列の全部**(式が読む自表の列に、それらを書き換える別トリガの発火列を足したもの =
 * `watchedColumnsOf`)を見ているか(見ていなければ理由。fix25s)。参照の欄(別の集約の行を指す列)の付け替えの端は、全部の不変条件の
 * 書き込みの端の覆い(`ddl-ref-check-edges.ts`)と製品の理由つきの受け入れの表が見る(付け替える口が無い欄を受け入れられる)。
 *
 * `update of {列}` は SET に書かれた列でしか発火しない。式が読む列を 1 つでも落とすと、その列の更新で条件が破れても誰も確かめない
 * (題材の製品の「消し込み済みの項目に後から連動を付ける」)。見る列は宣言から導けるので、宣言の列はそれを落とせない。`update` を含まない
 * 発火(挿入だけ)・列を名指さない `update` は列を絞っていないのでここでは見ない(更新の端の覆いは `ddl-ref-check-edges.ts`)。
 * 2 つの集約の一致の形は `cross-check-plan.ts` が同じことを見る。
 */
function unwatchedColumns(trigger: DataTriggerDecl, table: DataTableSpec, entity: EntitySpec, domain: SpecModel): string | null {
  const updated = updatedColumnsOf(trigger.fires ?? '');
  const invariant = trigger.invariant === undefined ? null : findInvariant(trigger.invariant, domain);
  const formal = invariant?.formal;
  if (updated === null || updated === 'all' || (formal?.kind !== 'check' && formal?.kind !== 'state_dependency')) return null;
  const parsed = formalExpr(formal);
  if (!parsed.ok) return null;
  const names = new Set([entity.entity, ...[...domain.aggregates].filter(([, specs]) => specs.entity?.entity === entity.entity).map(([name]) => name)]);
  const watched = watchedColumnsOf(table, columnsOfRoot(collectPaths(parsed.expr), names));
  if (watched === 'all') return 'この表の列を書き換える別のトリガが全部の更新で発火するので、列を絞れない(fires の update に列を名指さない)';
  const missing = watched.filter((column) => !updated.includes(column)).sort();
  return missing.length === 0
    ? null
    : `fires の update of が ${missing.join(' / ')} を見ていない(本文が読む列の更新で条件が破れても発火しない。式が読む自表の列と、` +
        'それを別のトリガが書き換える場合のそのトリガの発火列を並べる)';
}

/** 不変条件 1 本を引く(どの集約に住んでいるかは問わない)。 */
function findInvariant(id: string, domain: SpecModel): InvariantDef | null {
  for (const specs of domain.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      if (invariant.id === id) return invariant;
    }
  }
  return null;
}

/**
 * plpgsql の本文。
 *
 * `raise exception` の本文に**トリガ名(= 制約名)**を載せる —— 呼び出し側の写像
 * (制約名 → 不変条件 ID)は PostgREST が落とす `constraint` フィールドの代わりに
 * メッセージ本文から名前を拾う(ARCH-SP-BE-0001 の MUST)。
 */
function bodyOf(
  trigger: DataTriggerDecl,
  table: DataTableSpec,
  expression: string,
  invariant: InvariantDef | null,
): readonly string[] {
  const raise = refusalLines(trigger.name, trigger.invariant ?? '', invariant?.statement ?? '');
  if (trigger.deferred) {
    // コミット時に発火するので `new` は「その文の時点の姿」でしかない。いまの行を読み直し、
    // 行が無ければ何も課さない(コミットまでに消えた行は不変条件の対象ではない)。
    return [
      'if exists (',
      `    select 1 from public.${table.table} ${ALIAS}`,
      `    where ${ALIAS}.${KEY} = new.${KEY} and not (${expression})`,
      ') then',
      ...raise,
      'end if;',
      'return null;',
    ];
  }
  return [`if not (${expression}) then`, ...raise, 'end if;', 'return new;'];
}
