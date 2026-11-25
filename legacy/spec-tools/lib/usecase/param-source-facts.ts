/**
 * 引数の供給元を決めるための**事実の引き当て**(param-source.ts が使う)。
 *
 * 持つのは「保存点の中で作ったか」「そのときの状態は何か」「実行者を指す集約はどれか」という
 * **仕様への問い合わせ**であり、引数名 → 供給元の規約(束 ⑯c 設計 §2)そのものは param-source.ts である。
 */

import type { FieldDef, SpecModel } from '../model/types.js';
import { findEntityFields } from '../semantics/domain-index.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import type { ResolvedParam } from './param-source.js';
import type { PlanProblem, SavePlan, SaveStepPlan } from './step-plan.js';

/** 引数名の前置(param-source.ts の PREFIX と同じ規約)。 */
const PREFIX = 'p_';

/**
 * その手順の RPC に**届く**欄名の集合(引数名 `p_{欄}` ∪ `p_values` の中身の 2 経路だけ)。
 * どちらにも現れない欄は SQL に 1 文字も出ない —— Y8 が「自分として」の空手形を見る材料。
 *
 * @param step その手順
 * @param params 解決済みの引数
 * @returns 届く欄名の集合
 */
export function reachedFields(step: SaveStepPlan, params: readonly ResolvedParam[]): ReadonlySet<string> {
  const reached = new Set<string>();
  for (const name of step.fn.params) {
    if (name.startsWith(PREFIX)) reached.add(name.slice(PREFIX.length));
  }
  for (const param of params) {
    if (param.source.kind !== 'input_values') continue;
    for (const field of param.source.fields) reached.add(field.name);
  }
  return reached;
}

/**
 * 宣言順(`functions[].params`)に並べ直す。
 *
 * @param order 宣言順の引数名
 * @param params 解決済みの引数
 * @returns 宣言順に並べ直したもの
 */
export function reorder(order: readonly string[], params: readonly ResolvedParam[]): readonly ResolvedParam[] {
  return order
    .map((name) => params.find((param) => param.name === name))
    .filter((param): param is ResolvedParam => param !== undefined);
}

/**
 * `defaults.self` が指す欄が一意に決まり、かつ**その手順の RPC に届く**か。
 *
 * 一意性(その entity の `ref(実行者の集約)` が 1 件)だけでは足りない —— 欄が決まっても、
 * その欄を受け取る引数が RPC に無ければ「自分として」は生成される SQL に 1 文字も現れず、
 * 宣言は空手形になる(束 ⑯c-1 の実穴: 参加者は `member_id` を受ける引数が無いまま
 * `defaults.self` を宣言していて、生まれる行は誰のものでもなかった)。
 *
 * @param reached その手順の RPC に届く欄名の集合(引数名 ∪ `p_values` の中身)
 */
export function checkSelf(
  plan: SavePlan,
  step: SaveStepPlan,
  domain: SpecModel,
  reached: ReadonlySet<string>,
): PlanProblem[] {
  const actor = actorEntity(domain);
  const fields = (findEntityFields(domain, step.entity) ?? []).filter(
    (field) => field.type.kind === 'ref' && field.type.entity === actor,
  );
  const only = fields.length === 1 ? fields[0] : undefined;
  if (only !== undefined) return checkSelfReaches(plan, step, only.name, reached);
  return [
    {
      message:
        `defaults.self を宣言した手順 ${step.op} の ${step.entity} に、実行者を指す欄が ` +
        `${fields.length} 件あります(1 件でなければ「自分として」が何を埋めるか決まりません)`,
      suggestion:
        fields.length === 0
          ? '「自分として」は実行者を指す参照欄の既定値である。その欄が無い集約では defaults を書かない'
          : `どの欄を指すかが決まらない(候補: ${fields.map((field) => field.name).join(' / ')})。defaults を消すか、entity_spec を見直す`,
      counterexample: { ...at(plan, step), entity: step.entity, candidates: String(fields.length) },
    },
  ];
}

/**
 * 一意に決まった「自分として」の欄が、その手順の RPC に届いているか。
 *
 * **遷移の手順では、`defaults.self` は action_spec の input に宣言された欄を自分に絞るだけ**である
 * (許可表 `FIELD_ORIGINS` の `self_narrowing`)。遷移が実行者を列に書き留めるのは state_spec の
 * `records_actor` だけで、input に無い欄へ「自分として」を書いても実行者は入らない —— 以前の直し方の文は
 * 「RPC に引数を足して揃える」と案内し、案内どおりに足すと**その遷移の全イベント**が実行者を
 * その列に書く形に着いた(点検 7 回目 A7-1)。
 */
function checkSelfReaches(
  plan: SavePlan,
  step: SaveStepPlan,
  field: string,
  reached: ReadonlySet<string>,
): PlanProblem[] {
  if (step.kind === 'transition' && !step.inputFields.includes(field)) {
    return [
      {
        message:
          `defaults.self を宣言した遷移の手順 ${step.op} の ${field} は、その遷移の action_spec の input にありません` +
          '(遷移の手順の「自分として」は、input に宣言された欄を自分に絞るだけで、書ける列を増やさない)',
        suggestion:
          `この遷移が実行者を ${field} に書き留めるなら、state_spec のそのイベントに "records_actor: [${field}]" を宣言して ` +
          'defaults を消す(遷移で実行者を書くのはこの宣言だけ)。利用者が選ぶ値を自分に絞りたいだけなら、' +
          `action_spec ${step.op} の input に ${step.entity}.${field} を宣言する。どちらでもないなら defaults を消す`,
        counterexample: { ...at(plan, step), field, function: step.fn.name },
      },
    ];
  }
  if (reached.has(field)) return [];
  return [
    {
      message:
        `defaults.self を宣言した手順 ${step.op} の ${field} が、呼ぶ RPC ${step.fn.name} に届きません` +
        '(引数名にも p_values の中身にも現れないので、「自分として」は生成される SQL に出ません)',
      suggestion:
        step.kind === 'transition'
          ? `遷移が実行者を ${field} に書き留めるなら、state_spec のそのイベントに "records_actor: [${field}]" を宣言する` +
            `(${step.fn.name} の p_${field} は、記録する遷移では DB の本文が実行者に縛る)。` +
            'どちらもできないなら defaults を消す(宣言だけ残すと「自分として」が嘘になる)'
          : `${field} を実行者で埋める手順そのものを steps に足す(状態機械を持つ紐付けなら遷移として records_actor で)か、` +
            `作成の RPC ${step.fn.name} の data_table の params に p_${field} を足す(作成の手順では「自分として」が実行者で埋める)。` +
            'どちらもできないなら defaults を消す(宣言だけ残すと「自分として」が嘘になる)',
      counterexample: { ...at(plan, step), field, function: step.fn.name },
    },
  ];
}

/**
 * 保存点の中で、その手順より前にその集約を作った手順(無ければ null)。
 *
 * **同じ集約を複数の手順で作れる**(別名 `as` を持つ 2 つの作成)ので、指すのは
 * 「直前までの、その集約を作る **repeat でない** 手順のうち**最も近いもの**」である
 * (usecase-spec-writing.md §同じ集約を複数の手順で作るとき)。
 *
 * **繰り返す作成は数えない** —— `repeat: true` の作成は行を何本も作るので「その集約の id」が
 * 1 つに定まらない。繰り返す作成しか先行していなければ `repeatOnly` を返し、参照側は
 * それを**生成時エラー**にする(黙って入力から読む形に落とさない)。
 */
export type CreatedRef =
  /** 先行する作成が無い(保存点の外から来る行)。 */
  | { readonly kind: 'none' }
  /** 直前の、繰り返さない作成の手順番号。 */
  | { readonly kind: 'step'; readonly index: number }
  /** 繰り返す作成しか先行していない(どの行を指すか決まらない)。 */
  | { readonly kind: 'repeatOnly'; readonly index: number };

/**
 * その手順より前でその集約を作った手順を引く。
 *
 * @param plan 接地済みの保存点
 * @param step 参照する側の手順
 * @param entity 参照先の集約のエンティティ名
 * @returns 最も近い「繰り返さない作成」/ 繰り返す作成だけ / 無し
 */
export function createdRef(plan: SavePlan, step: SaveStepPlan, entity: string): CreatedRef {
  let repeated: number | null = null;
  let found: number | null = null;
  for (const candidate of plan.steps) {
    if (candidate.index >= step.index) break;
    if (candidate.kind !== 'create' || candidate.entity !== entity) continue;
    if (candidate.repeat) repeated = candidate.index;
    else found = candidate.index;
  }
  if (found !== null) return { kind: 'step', index: found };
  if (repeated !== null) return { kind: 'repeatOnly', index: repeated };
  return { kind: 'none' };
}

/**
 * 繰り返す作成しか先行していないときの生成時エラー。
 *
 * @param plan 接地済みの保存点
 * @param step 参照する側の手順
 * @param entity 参照先の集約のエンティティ名
 * @param created `createdRef` の結果(繰り返す作成の手順番号を反例に載せる)
 * @returns 反例つきの理由
 */
export function repeatOnlyReference(
  plan: SavePlan,
  step: SaveStepPlan,
  entity: string,
  created: { readonly index: number },
): PlanProblem {
  const repeated = plan.steps[created.index];
  return {
    message:
      `手順 ${step.op} が参照する ${entity} は、この保存点では繰り返す作成(手順 ${created.index + 1}: ` +
      `${repeated?.alias ?? ''})でしか作られていないため、どの行を指すか決まりません`,
    suggestion:
      `${entity} を作る「繰り返さない」手順をこの手順より前に置く(親の行を 1 つ作る)か、` +
      'この手順を保存点から外す。繰り返す作成は行を何本も作るので、その id は 1 つに定まらない',
    counterexample: { ...at(plan, step), entity, repeatStep: repeated?.alias ?? String(created.index) },
  };
}

/**
 * 予測すべき状態フィールドを引く。
 *
 * 集約は直交した状態軸を複数持てる(進行の軸と掲載の軸)ため、**どの軸か**まで決めないと
 * 予測が別の軸の状態になってしまう。決め方は 2 つだけ:
 *   - 遷移の手順なら、その遷移の状態機械に対応する軸(`state({machine})` 型の列)
 *   - それ以外なら、引数名が名指しした列(`p_expected_{集約}_{列}`)か、既定の `state`
 *
 * @param domain ドメイン仕様
 * @param entity 集約のエンティティ名
 * @param machine 軸を指定する状態機械名(遷移のとき)。null なら `field` の名前で引く
 * @param field 軸を指定する列名(引数名が名指ししたとき)。null なら既定の `state`
 * @returns 見つかった状態フィールド。無ければ null
 */
export function stateFieldOf(
  domain: SpecModel,
  entity: string,
  machine: string | null = null,
  field: string | null = null,
): FieldDef | null {
  const fields = findEntityFields(domain, entity) ?? [];
  if (machine !== null) {
    return fields.find((candidate) => candidate.type.kind === 'state' && candidate.type.machine === machine) ?? null;
  }
  const name = field ?? DEFAULT_STATE_FIELD;
  return fields.find((candidate) => candidate.name === name && candidate.type.kind === 'state') ?? null;
}

/** 軸を名指ししない引数(`p_expected_state`)が指す既定の列名。 */
const DEFAULT_STATE_FIELD = 'state';

/**
 * `p_expected_{集約}_{列}` を「集約 + 状態列」に分解する。
 *
 * 集約名にも列名にも `_` が入りうるので、区切りは総当たりで決める(両方が仕様に実在する
 * 分け方は 1 通りしかない —— 見つからなければ規約に載らない名前として扱う)。
 *
 * @param domain ドメイン仕様
 * @param rest `p_expected_` を取り除いた残り
 * @returns 分解できた集約と状態フィールド。できなければ null
 */
export function splitExpectedParam(
  domain: SpecModel,
  rest: string,
): { readonly entity: string; readonly field: FieldDef } | null {
  const parts = rest.split('_');
  for (let cut = 1; cut < parts.length; cut += 1) {
    const entity = entityOf(domain, parts.slice(0, cut).join('_'));
    if (entity === null) continue;
    const field = stateFieldOf(domain, entity, null, parts.slice(cut).join('_'));
    if (field !== null) return { entity, field };
  }
  return null;
}

/** 状態機械の初期状態。 */
export function initialOf(domain: SpecModel, machine: string | null): string | null {
  if (machine === null) return null;
  for (const specs of domain.aggregates.values()) {
    const found = specs.stateMachines.find((candidate) => candidate.machine === machine);
    if (found !== undefined) return found.initial;
  }
  return null;
}

/**
 * 実行者(actor)に対応する集約のエンティティ名。
 *
 * 「ログインしている人の行」を持つ集約は `session: true` を宣言した 1 つだけである
 * (V13 が全域で 1 つに閉じている)。アプリの語彙を仕組み側に書かないための唯一の手がかり。
 */
export function actorEntity(domain: SpecModel): string | null {
  for (const specs of domain.aggregates.values()) {
    const entity = specs.entity;
    if (entity !== undefined && entity.fields.some((field) => field.session)) return entity.entity;
  }
  return null;
}

/** 集約名・エンティティ名のどちらでも引ける形でエンティティ名に正規化する(無ければ null)。 */
export function entityOf(domain: SpecModel, name: string): string | null {
  return findEntitySpec(domain, name)?.entity ?? null;
}

/** 反例の共通部分(どのユースケースのどの保存点のどの手順か)。 */
export function at(plan: SavePlan, step: SaveStepPlan): Readonly<Record<string, string>> {
  return { usecase: plan.usecase.name, save: plan.save.id, step: step.op };
}

/**
 * 保存点の冪等の錨(最初の作成の手順。作成を持たない保存点は undefined)。錨の決め方はここ 1 か所で、読み直しの構造(`save-readback.ts`)・
 * 冪等キーの置き場(`param-source.ts`)・一致の証明の設計図(`world/eq-save-shape.ts`)は呼ぶだけ(点検 22 回目 C の O22-3)。
 *
 * @param plan 保存点(手順の並び)
 * @returns 錨の手順
 */
export function anchorStep<T extends { readonly kind: string }>(plan: { readonly steps: readonly T[] }): T | undefined {
  return plan.steps.find((step) => step.kind === 'create');
}
