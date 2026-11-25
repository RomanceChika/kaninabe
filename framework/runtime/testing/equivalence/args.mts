import type { RunParam, RunPlan } from '@kaninabe/runtime/plan';
import type { EqSelection, EqSubject } from './world.mjs';

/**
 * engine ⇔ RPC の一致の証明が **RPC に渡す引数**の組み立て(束 ⑳-5a)。生成物ではなく、
 * 仕組み側に 1 回だけ手で書く。
 *
 * 引数名も供給元も**実行計画が運んでいる**(`operation-plans.ts` の `call.params`)。ここが
 * するのは、その供給元を「world のどこから取るか」に写すことだけである —— 実行器
 * (`_template/run-plan-args.ts`)が session と入力から取るところを、テストは world の行と
 * 組み合わせの選択から取る。**供給元の値域はどちらも同じ 1 つ**(`RunParamSource`)であり、
 * 新しい供給元が増えればここも型で落ちる。
 *
 * 副作用(`p_effects`)は**空で渡す**。積まれた副作用が outbox に載ることは別の保証
 * (`effects_reach_outbox`)が見ており、ここが見たいのは「実行できたか / どの理由で落ちたか」
 * だけである。
 *
 * **アプリの語彙は 1 語も持たない。**
 */

/** 副作用は積まない(一致の証明が見るのは可否だけである)。 */
const NO_EFFECTS: readonly string[] = [];

/**
 * その組み合わせで RPC に渡す名前付き引数を組み立てる。
 *
 * @param plan その操作の実行計画(生成物)
 * @param selection 実行する組み合わせ
 * @param subject 実行する相手(行の id と、置き直したあとの値)
 * @returns 引数名 → 値
 */
export function eqArgs(
  plan: RunPlan,
  selection: EqSelection,
  subject: EqSubject,
): Readonly<Record<string, unknown>> {
  if (plan.call.kind !== 'named') return {};
  const args: Record<string, unknown> = {};
  for (const param of plan.call.params) args[param.name] = valueOf(param, selection, subject);
  return args;
}

/** 引数 1 本の値(供給元の値域ごとに 1 行)。 */
function valueOf(param: RunParam, selection: EqSelection, subject: EqSubject): unknown {
  const source = param.source;
  switch (source.kind) {
    case 'idempotency_key':
      return selection.newId;
    case 'actor':
      return subject.actorId;
    case 'actor_roles':
      return [...selection.array.roles];
    case 'expected_state':
      return valueAt(subject, source.ref);
    case 'next_state':
      return source.state;
    case 'effects':
    case 'write_effects':
      return [...NO_EFFECTS];
    case 'event_id':
      return source.event;
    case 'input_field':
      return subject.input[source.field] ?? null;
    case 'input_target_id':
      return subject.targetId;
    case 'input_values':
      return pick(subject, source.fields);
    case 'input_changes':
      return changesOf(selection, subject, source.fields);
    default:
      // `not_written`(その遷移が自分で決めない列)と、実行時に純関数が決める値。
      // どちらもテストは空を渡す —— 前者は契約そのもの、後者は計画に乗る操作には現れない。
      return null;
  }
}

/** `{集約}.{列}` の値(置き直したあとの値)。 */
function valueAt(subject: EqSubject, ref: string): unknown {
  const dot = ref.indexOf('.');
  if (dot < 0) return null;
  return subject.values.get(ref.slice(0, dot))?.[ref.slice(dot + 1)] ?? null;
}

/** 並べた欄を全部入れる(作成)。 */
function pick(subject: EqSubject, fields: readonly string[]): Readonly<Record<string, unknown>> {
  const values: Record<string, unknown> = {};
  for (const field of fields) values[field] = subject.input[field] ?? null;
  return values;
}

/**
 * 送られた鍵だけを入れる(編集)。
 *
 * 編集の判定(`canWrite`)も RPC の述語も**欄ごと**なので、1 回の呼び出しで動かす欄は 1 つに
 * 絞る —— 複数まとめて送ると、どの欄の規則で落ちたのかが結末から読めなくなる。
 */
function changesOf(
  selection: EqSelection,
  subject: EqSubject,
  fields: readonly string[],
): Readonly<Record<string, unknown>> {
  const field = selection.field;
  if (field === null || !fields.includes(field)) return {};
  return { [field]: subject.input[field] ?? null };
}
