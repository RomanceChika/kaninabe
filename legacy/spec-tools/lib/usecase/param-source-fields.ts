/**
 * **欄を指す引数**(`p_{フィールド名}` / `p_{集約}_id` / `p_values` / `p_changes`)の解決
 * (param-source.ts が使う)。
 *
 * 引数名 → 供給元の規約は 2 種類の名前でできている。**意味が固定された名前**(`p_id` ・`p_actor_id` ・
 * `p_next_state` など。名前だけで供給元が決まる)の判定は param-source.ts が持ち、**欄を指す名前**
 * (どの欄・どの集約を指すかは、手順の集約のフィールドと突き合わせて初めて決まる)の解決がここである。
 * 後者は手順の集約の欄や「保存点の中で作った集約か」を引く必要があり、名前だけで決まる前者とは
 * 読む材料が違う。
 */

import type { FieldDef, SpecModel } from '../model/types.js';
import { findField } from '../semantics/domain-index.js';
import type { NotWrittenContract, ParamSource } from './param-source.js';
import type { PlanProblem, SavePlan, SaveStepPlan, StepKind, StepRunner } from './step-plan.js';
import { actorEntity, at, createdRef, entityOf, repeatOnlyReference } from './param-source-facts.js';

/** 引数名の前置(param-source.ts の PREFIX と同じ規約)。 */
const PREFIX = 'p_';

/** `{集約}_id`(他の集約への参照)。 */
const REF_ID_SUFFIX = /^(.+)_id$/;

/**
 * `p_{フィールド名}` / `p_{集約}_id` を解決する(§2 の下 4 行)。
 *
 * 手順のエンティティのフィールド名として読める名前を先に見る —— その欄の値の出どころは
 * 手順の形 × 経路 × runner の許可表(`FIELD_ORIGINS`)が決める。
 */
export function refOrFieldSource(
  name: string,
  plan: SavePlan,
  step: SaveStepPlan,
  domain: SpecModel,
  problems: PlanProblem[],
): ParamSource | null {
  const rest = name.slice(PREFIX.length);
  const field = findField(domain, step.entity, rest);
  if (field !== null) return fieldSource(field, plan, step, domain, problems);
  const ref = REF_ID_SUFFIX.exec(rest);
  const target = ref === null ? null : entityOf(domain, ref[1] ?? '');
  if (target !== null) {
    const created = createdRef(plan, step, target);
    if (created.kind === 'repeatOnly') {
      problems.push(repeatOnlyReference(plan, step, target, created));
      return null;
    }
    if (target === step.entity) {
      return created.kind === 'none'
        ? { kind: 'input_target_id' }
        : { kind: 'step_result_id', step: created.index, column: 'id' };
    }
    if (created.kind === 'step') return { kind: 'step_result_id', step: created.index, column: rest };
  }
  problems.push({
    message: `${step.fn.name} の引数 ${name} の供給元が規約から決まりません`,
    suggestion:
      '引数名 → 供給元の規約(usecase-spec-writing.md §引数名 → 供給元)に載る形だけが使える。' +
      'entity_spec のフィールド名にするか、規約側にその形を足すかを決める',
    counterexample: { ...at(plan, step), function: step.fn.name, param: name },
  });
  return null;
}

/**
 * 欄の値の**出どころ**(許可表の語彙)。
 *
 * 欄を指す引数の供給元は、ここに並ぶ出どころのどれか 1 つからしか決まらない。どれが使えるかは
 * 手順の形 × 経路 × runner の許可表(`FIELD_ORIGINS`)が丸ごと決め、表に無い出どころは
 * **当てはまっても使わない**(以前は分岐の継ぎ足しで、作成のための規則が遷移にも効き、保存点の
 * 作成だけが入力に落ちていた。点検 7 回目 A7-1 / A7-2)。
 */
export type FieldOrigin =
  /** 保存点の中で先に作った行の id(参照欄)。 */
  | 'created_ref'
  /** `defaults.self`(作成の手順で、実行者を指す欄を実行者そのもので埋める)。 */
  | 'self'
  /**
   * `defaults.self` が**入力に宣言された欄を自分に絞る**(遷移の手順)。
   * 単発の同じ遷移が利用者に選ばせる値を実行者 1 人に狭めるだけで、書ける列は増えない。
   */
  | 'self_narrowing'
  /**
   * 作成の action_spec が `owner: {集約}.{欄}` で**明示した**持ち主の欄 = 作成者(作成の手順だけ)。
   * 「必須で入力に無い実行者への参照は作成者」の推測はしない(点検 9 回目 A9-1。宣言の接地は V18 の下位検査 `v18-owner.ts`)。
   */
  | 'owner'
  /** state_spec の `records_actor`(その遷移が実行者を書き留めると宣言した列)。 */
  | 'records_actor'
  /** action_spec の `input` に宣言された欄(利用者の入力から読むのはこれだけ)。 */
  | 'input'
  /** action_spec の `computes`(実行時に純関数が決める)。 */
  | 'computed'
  /** 遷移が自分で決めない列(`transition_writes` / 遷移の `computes`。空を渡す)。 */
  | 'not_written';

/** 経路(単発の操作か、保存点の複合 RPC か)。 */
export type StepRoute = 'single' | 'save';

/** 出どころを試す順(先に当てはまったものが勝つ。実行者の宣言は利用者の入力より先)。 */
export const ORIGIN_ORDER: readonly FieldOrigin[] = [
  'created_ref',
  'self',
  'self_narrowing',
  'owner',
  'records_actor',
  'input',
  'computed',
  'not_written',
];

/** 作成: 新しい行の持ち主は作る人(実行者)で、残りは宣言された入力と計算値だけ。 */
const CREATE_ORIGINS: readonly FieldOrigin[] = ['created_ref', 'self', 'owner', 'input', 'computed'];
/**
 * 遷移: **既存の他人の行**を書くので、作成のための自動補完(`self` / `owner`)は効かせない。
 * 実行者を書くのは `records_actor` だけ(`defaults.self` は入力に宣言された欄を絞るだけ)。
 */
const TRANSITION_ORIGINS: readonly FieldOrigin[] = ['created_ref', 'self_narrowing', 'records_actor', 'input', 'computed', 'not_written'];
/** 編集・削除: 既存の行を書くので、実行者の自動補完は無い。 */
const EDIT_ORIGINS: readonly FieldOrigin[] = ['created_ref', 'input', 'computed'];

/** 経路にも runner にもよらない 1 行(どの組み合わせでも同じ出どころしか許さない)。 */
function sameEverywhere(origins: readonly FieldOrigin[]): Readonly<Record<StepRoute, Readonly<Record<StepRunner, readonly FieldOrigin[]>>>> {
  return { single: { auto: origins, manual: origins }, save: { auto: origins, manual: origins } };
}

/**
 * 許可表: 手順の形 × 経路 × runner → 使ってよい出どころ。
 *
 * **全ての組み合わせを書き下す**(既定の行・継ぎ足しの分岐を持たない)。経路と runner で
 * 出どころが広がる行は 1 つも無い —— 保存点だけ入力に落とす・manual だけ別の判定にする、を
 * 許すと、単発の安全網(A15)が外れた経路から仕様に無い欄を利用者が書けた(A7-2)。
 * 表を広げるときは、その出どころが**誰の行の・どの列を・誰が決めるか**を書いてから足す。
 */
export const FIELD_ORIGINS: Readonly<Record<StepKind, Readonly<Record<StepRoute, Readonly<Record<StepRunner, readonly FieldOrigin[]>>>>>> = {
  create: sameEverywhere(CREATE_ORIGINS),
  transition: sameEverywhere(TRANSITION_ORIGINS),
  update: sameEverywhere(EDIT_ORIGINS),
  delete: sameEverywhere(EDIT_ORIGINS),
};

/** その手順で使ってよい出どころ(許可表の 1 マス)。 */
export function allowedOrigins(plan: SavePlan, step: SaveStepPlan): readonly FieldOrigin[] {
  return FIELD_ORIGINS[step.kind][plan.single ? 'single' : 'save'][step.runner];
}

/** エンティティのフィールドを指す引数の供給元。決まらなければ problems に積んで null を返す。 */
function fieldSource(
  field: FieldDef,
  plan: SavePlan,
  step: SaveStepPlan,
  domain: SpecModel,
  problems: PlanProblem[],
): ParamSource | null {
  if (field.type.kind === 'ref') {
    const created = createdRef(plan, step, field.type.entity);
    if (created.kind === 'repeatOnly') {
      problems.push(repeatOnlyReference(plan, step, field.type.entity, created));
      return null;
    }
  }
  const allowed = allowedOrigins(plan, step);
  for (const origin of ORIGIN_ORDER) {
    if (!allowed.includes(origin)) continue;
    const source = originSource(origin, field, plan, step, domain);
    if (source !== null) return source;
  }
  problems.push(undecidedField(field, plan, step, domain));
  return null;
}

/**
 * 1 つの出どころが、この欄に当てはまるときの供給元(当てはまらなければ null)。
 *
 * 許可表を見るのは呼び手である —— ここは「当てはまるか」だけを答え、使ってよいかは決めない。
 * (`defaults.self` の検査 Y8 と二重の柵なので、1 つずつ確かめられるように公開する。)
 */
export function originSource(origin: FieldOrigin, field: FieldDef, plan: SavePlan, step: SaveStepPlan, domain: SpecModel): ParamSource | null {
  const actorRef = field.type.kind === 'ref' && field.type.entity === actorEntity(domain);
  const inInput = step.inputFields.includes(field.name);
  switch (origin) {
    case 'created_ref': {
      if (field.type.kind !== 'ref') return null;
      const created = createdRef(plan, step, field.type.entity);
      return created.kind === 'step' ? { kind: 'step_result_id', step: created.index, column: field.name } : null;
    }
    case 'self':
      return step.defaultsSelf && actorRef ? { kind: 'actor' } : null;
    case 'self_narrowing':
      return step.defaultsSelf && actorRef && inInput ? { kind: 'actor' } : null;
    case 'owner':
      return actorRef && field.required && !inInput && step.owner === field.name ? { kind: 'actor' } : null;
    case 'records_actor':
      return recordsActor(step, field) ? { kind: 'actor' } : null;
    case 'input':
      return inInput ? { kind: 'input_field', field: field.name, type: field.type } : null;
    case 'computed': {
      const computed = step.computes[field.name];
      return computed === undefined ? null : { kind: 'computed', field: field.name, ref: computed };
    }
    case 'not_written': {
      const contract = notWrittenByTransition(step, field);
      return contract === null ? null : { kind: 'not_written', field: field.name, contract };
    }
  }
}

/** 許可表のどの出どころにも当たらない欄の指摘(手順の形ごとに直し方が違う)。 */
function undecidedField(field: FieldDef, plan: SavePlan, step: SaveStepPlan, domain: SpecModel): PlanProblem {
  const actorRef = field.type.kind === 'ref' && field.type.entity === actorEntity(domain);
  const transitionActor =
    step.kind === 'transition' && actorRef
      ? `遷移が実行者をこの列に書き留めるなら、state_spec のそのイベントに "records_actor: [${field.name}]" を宣言する` +
        '(遷移で実行者を書くのはこの宣言だけ。作成の owner・「自分として」は遷移には効かない)。' +
        `書き留めない遷移なら、data_table の ${step.fn.name} の params から p_${field.name} を外す。それ以外では `
      : '';
  const createActor =
    step.kind === 'create' && actorRef
      ? `${step.entity}.${field.name} は実行者への参照の欄で、作成者で埋める宣言がありません(推測では埋めない)。` +
        `人が選ぶ欄(代理で作る相手・査閲者・担当者など)なら action_spec ${step.op} の input に足す。` +
        `作成者そのものがこの行の持ち主になる欄なら action_spec ${step.op} に "owner: ${step.entity}.${field.name}" を宣言する` +
        '(1 つの作成に 1 本だけ。どちらか決まらない欄を作成者で埋めない)。それ以外では '
      : '';
  return {
    message: `${step.fn.name} の引数 p_${field.name} に渡す値が仕様のどこにもありません`,
    suggestion:
      transitionActor +
      createActor +
      `${step.entity}.${field.name} を action_spec ${step.op} の input に足す(人が入れる値なら)か、` +
      'entity_spec に supplied_by: db を宣言して DB に決めさせる(V17)か、' +
      `action_spec に "computes: [{ field: ${step.entity}.${field.name}, ref: {純関数名} }]" を宣言する` +
      '(実行時に純関数が決める値なら。計算値の列は access_spec の writes に並べない —— V18)。' +
      '利用者の入力から読むのは action_spec の input に宣言された欄だけで、保存点・runner: manual でも広がらない',
    counterexample: { ...at(plan, step), function: step.fn.name, param: `p_${field.name}` },
  };
}

/**
 * **この遷移は実行者をこの列に書き留める**か(state_spec の `records_actor`。束 ⑰-2)。
 *
 * 遷移の RPC は状態列のほかに `p_{列}` を受け取ることがある(対応者・紐づくアカウント)。
 * その値は入力にも DB にも無く、**イベントごとに**違う ——「対応開始は対応者を書くが再開は
 * 書かない」は `records_actor` だけが知っている(`access_spec` の `writes` は集約単位の
 * 近似であり、イベントを区別できない)。規約「実行者の集約への参照で入力に無い欄は実行者」
 * (作成の形で既にあるもの)を、**イベント単位の宣言を関門にして**遷移まで広げたのがこれである。
 */
function recordsActor(step: SaveStepPlan, field: FieldDef): boolean {
  if (step.kind !== 'transition' || step.event === null) return false;
  return (step.event.recordsActor ?? []).includes(field.name);
}

/**
 * **この遷移はその列を自分で決めない**(空を渡す)か。決めるならその契約、そうでなければ null。
 *
 * 遷移の RPC の引数にはあるが `records_actor` が宣言していない自集約の列は、その遷移が
 * 自分で決めない列である。無条件に空へ倒すと「決まらない」が黙って通るので、
 * `access_spec` の `transition_writes` に載っている列と、どれかの遷移の `computes` が書く列(計算で決まる列)だけに
 * 限る —— そこが「人の操作としては現れず、**遷移が**書く列」という集約単位の宣言であり、空を渡してよいことの
 * 根拠である。宣言に無い列を RPC が要求していれば、従来どおり「決まらないもの」として止まる。
 *
 * **どの遷移が書くか**を名指しできるのは `records_actor` だけなので、実行者以外の値を書く遷移
 * (提出が合計額を確定する、など)は依然として `computes` の宣言が要る —— この規則が空に倒すのは
 * 「その値を供給する宣言がどこにも無い」場合だけである。
 *
 * 渡す値はどちらも空だが、**空が何を意味するかは宣言が決める** —— `clears` に並ぶ列は
 * 「空にする」、並ばない列は「触れない」である(束 ⑰-3。それまでは RPC の本文だけが
 * 知っていて、同じ宣言の不在が正反対の結果を生んでいた)。
 */
function notWrittenByTransition(step: SaveStepPlan, field: FieldDef): NotWrittenContract | null {
  if (step.kind !== 'transition') return null;
  if (!step.transitionWrittenFields.includes(field.name)) return null;
  return (step.event?.clears ?? []).includes(field.name) ? 'cleared' : 'untouched';
}

/** `p_values`: 入力欄のうち、他の引数が受け取っていない残り。 */
export function valuesSource(step: SaveStepPlan, domain: SpecModel, consumed: ReadonlySet<string>): ParamSource {
  return { kind: 'input_values', fields: restFields(step, domain, consumed) };
}

/**
 * `p_changes`: 入力欄のうち、対象の識別子と他の引数が受け取っていない残り。
 *
 * 識別子(`id`)を明示的に外すのは、それを運ぶ引数が `p_{集約}_id` という別の名前だからである
 * (`consumed` に入るのは `{集約}_id` であって `id` ではない)。
 */
export function changesSource(step: SaveStepPlan, domain: SpecModel, consumed: ReadonlySet<string>): ParamSource {
  return { kind: 'input_changes', fields: restFields(step, domain, consumed).filter((field) => field.name !== 'id') };
}

/** 入力欄のうち、他の引数が受け取っていないものを FieldDef に写す。 */
function restFields(step: SaveStepPlan, domain: SpecModel, consumed: ReadonlySet<string>): readonly FieldDef[] {
  return step.inputFields
    .filter((name) => !consumed.has(name))
    .map((name) => findField(domain, step.entity, name))
    .filter((field): field is FieldDef => field !== null);
}
