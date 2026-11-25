/**
 * **どの id でその行を読むか**と**結末の id** の解決(plan-facts.ts が使う)。
 *
 * 持つのは、読む行を 1 行に絞る手がかり(実行者 / 入力 / 保存点の中で作った行)をどこから取るかと、
 * 保存点の結末の id をどの行から取るかである。**`permit` が要る事実の全体の供給元**(ガード変数・
 * 文脈ロール・予測状態)は plan-facts.ts が決め、ここはそのうち「行を読む口」だけを引き受ける。
 */

import type { ResolvedParam } from './param-source.js';
import type { SaveStepPlan } from './step-plan.js';
import type {
  FactsInput,
  UsecaseFactSource,
  UsecaseReadIdSource,
  UsecaseResultIdSource,
  UsecaseResultPlan,
} from './plan-facts-types.js';
import type { PlanProblem } from './step-plan.js';
import { actorEntity, entityOf } from './param-source-facts.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import { finalStateOf } from './plan-facts-parts.js';
import { unreadable } from './plan-facts-problems.js';

/** 保存点の外の 1 欄を読む予約を積む口(plan-facts.ts が閉包として渡す)。 */
export type ReadExternal = (step: SaveStepPlan, entity: string, field: string) => UsecaseFactSource | null;

/**
 * 保存点の**外**の集約を 1 行に絞る id の供給元(実行者 / 入力)。
 *
 * 保存点の中で作る行はここに現れない —— `permit` は書き込みの前に立てるので、その時点で
 * まだ存在しない行は読めない。読もうとしていたら仕様の問題であり、呼び側が Y10 で止める。
 */
export function readIdSourceOf(
  input: FactsInput,
  entity: string,
  readExternal: ReadExternal,
  step: SaveStepPlan,
): UsecaseReadIdSource | null {
  const target = targetRowIdSourceOf(input, entity);
  if (target !== null) return target;
  if (entity === actorEntity(input.domain)) return { kind: 'actor' };
  // 同じ保存点が**この手順の集約を作る**(作成のあとに遷移する、など)なら、対象の行はまだ DB に無く、その作成の入力が
  // 行の持ち主を決める —— 入力の参照の欄が「いまの行の親」そのものなので、従来どおり入力から読む。
  const createdHere = input.plan.steps.some((entry) => entry.kind === 'create' && entry.entity === step.entity);
  if (step.kind !== 'create' && !createdHere) {
    // **作成でない手順(編集・削除・遷移)は、現在の対象の行から辿る親を先に読む。** 入力の参照の欄は「これから
    // 書く新しい値」であって、いま行が指している親ではない —— 新しい親を先に読むと、他社の親を指す既存の行を
    // 自社の親へ付け替える入力が、新しい親の列(テナントの境界など)で通ってしまう(外部レビュー の P2-1)。
    // `context` が届かない親は**読まない**(null → 呼び手が Y10 で止める)。入力の参照の欄から読むと、新しい親の列で
    // 権限が通ってしまう(fail-closed)。権限の判定に親を使うなら、対象の集約に `context` でその親への道を宣言する。
    return contextIdSourceOf(input, entity, readExternal, step);
  }
  const fromInput = inputIdSourceOf(input, entity);
  if (fromInput !== null) return fromInput;
  return contextIdSourceOf(input, entity, readExternal, step);
}

/**
 * **この計画が書き換える行**を入力から指せるなら、その id の供給元(指せなければ null)。
 *
 * 「対象の集約が実行者の集約でもあるとき、読むのは入力が指す行であって実行者の行ではない」
 * という規則である。ここを取り違えると「他人の行を編集しようとした実行者が、自分の行を
 * 読んだ結果 `account_owner` として通る」—— 束 ⑰-2 の切り替えで実測した権限の穴である。
 *
 * **単発の操作と保存点の両方に効かせる**(束 ⑰-3)。穴の性質は手順の数に依らない ——
 * 実行者の集約を対象にする手順が保存点に現れた瞬間に同じ穴が開く。実行者の行を読むのは
 * 「binding の相手が別の集約にある」ときだけであり、それは対象の行が入力から指せない
 * ことと同義である(この関数が null を返す場合)。
 */
function targetRowIdSourceOf(input: FactsInput, entity: string): UsecaseReadIdSource | null {
  if (!input.plan.steps.some((step) => step.entity === entity)) return null;
  return inputIdSourceOf(input, entity);
}

/**
 * 対象の集約が宣言した**解決パス**(entity_spec の `context`)を辿って id を得る。
 *
 * 入力にその集約の id を指す欄が無くても、**既に読める行の参照列**から 1 ホップで届くなら
 * その 1 段を辿る。1 段を宣言しているのが `context` である(`workshop: entry.workshop_id`。
 * V11 が文脈ロールについて同じ宣言を要求している)。
 *
 * **単発の操作と保存点の両方に効かせる。** 当初は単発の操作だけの経路だった(「保存点では
 * 対象の行が一意に決まらない」)が、決まらないのは**辿る起点**であって `context` の宣言では
 * ない —— 起点を「作成でない手順の自集約」と「入力が id を指す集約」に限れば、
 * 手順が何本あっても行は 1 つに決まる。保存点で辿れなかった間は、1 段先から導ける相手の行を
 * 人に入力させるフォームが生成されていた(束 ⑱ の題材 B が実測)。
 *
 * **起点は 2 段まで伸びる**(束 ⑲-2a)。1 段目で読めた集約は、それ自身が次の段の起点になれる
 * —— `{起点} → {中継} → {相手}` を辿るのに、`{起点}` に `{相手}_id` の写しの列を
 * 持たせる必要が無くなる(読み取りが 1 つ増えるだけで、表は増えない)。
 */
function contextIdSourceOf(
  input: FactsInput,
  entity: string,
  readExternal: ReadExternal,
  step: SaveStepPlan,
): UsecaseReadIdSource | null {
  for (const holder of contextHolders(input, step)) {
    const path = findEntitySpec(input.domain, holder)?.context[entity];
    if (path === undefined) continue;
    const [head, field] = path.split('.');
    if (head === undefined || field === undefined || entityOf(input.domain, head) !== holder) continue;
    if (readExternal(step, holder, field) === null) continue;
    return { kind: 'context', ref: `${holder}.${field}` };
  }
  return null;
}

/**
 * `context` を辿る**起点**になれる集約(参照列を読める行を持つもの)。
 *
 * 2 つだけである。
 *   - その手順自身の集約。ただし**作成を除く** —— 作成の手順には「対象の行」がまだ無い
 *     (例: 演目を載せる = 入力は枠の id だけ。催しはその枠が宣言する `context` の 1 段先)。
 *   - 入力が id を指している集約(`inputReachableEntities`)。
 * どちらも「この保存点が作る行」を含まない —— `permit` は書き込みの前に立てるので、まだ
 * 存在しない行の参照列は読めない。読める起点だけに絞ることで、`readExternal` に無資格の
 * 起点を渡して**余計な Y10 の問題を積んでしまう**ことも避けている(あれは副作用を持つ)。
 */
function contextHolders(input: FactsInput, step: SaveStepPlan): readonly string[] {
  const created = new Set(input.plan.steps.filter((entry) => entry.kind === 'create').map((entry) => entry.entity));
  const own = step.kind !== 'create' && !created.has(step.entity) ? [step.entity] : [];
  const reachable = inputReachableEntities(input).filter((entity) => !created.has(entity));
  const direct = [...new Set([...own, ...reachable])];
  // **段の 2 つ目**: 起点の `context` で辿れる集約も、それ自身が読めるなら次の段の起点になれる
  // (`{起点} → {中継} → {相手}`)。1 段しか辿れなかったあいだ、木の各段に写しの列と
  // トリガと不変条件が要っていた(束 ⑱ の実測 → 束 ⑲-2a)。読めるかどうかの判定は
  // `readExternal` が行うので、ここでは候補として並べるだけでよい。
  const second = direct.flatMap((holder) => Object.keys(findEntitySpec(input.domain, holder)?.context ?? {}));
  return [...new Set([...direct, ...second.filter((entity) => !created.has(entity))])];
}

/** 入力が id を指している集約(= それ自体は読める行)の一覧。 */
function inputReachableEntities(input: FactsInput): readonly string[] {
  const entities = new Set<string>();
  for (const [index, params] of input.params.entries()) {
    const step = input.plan.steps[index];
    if (step === undefined) continue;
    for (const param of params) {
      if (param.source.kind === 'input_field' && param.source.type.kind === 'ref') {
        entities.add(param.source.type.entity);
      }
    }
  }
  return [...entities];
}

/** 入力が親の集約を指す参照の欄 1 本(どの手順の、どの欄か)。 */
interface InputRef {
  readonly step: number;
  /** その手順の集約(`context` を引く側)。 */
  readonly holder: string;
  readonly field: string;
}

/**
 * その集約の id を指す入力欄(対象そのものの `id` か、手順が入力で受ける親への参照の欄)。
 *
 * **どの欄で親を指すかは宣言が決める。** 型が同じ `ref({親})` の欄が複数あれば、先に見つかったものを黙って取ると
 * 別の親の行を読む(テナントの境界などを読む `permit` が、結ばれていない欄の親の列を見る)。そこで次の順で決める。
 *   1. 手順の集約の `context` が親へ届く欄として名指した欄(`context[親] = 手順の集約.{欄}`)が入力にあれば、それ。
 *   2. 名指しが無く、同じ親を指す欄がちょうど 1 つ(欄の名前で数える)ならそれ。
 *   3. 同じ親を指す欄が複数あって `context` が選ばなければ、**決めない**(null → 呼び手が Y10 で止める)。
 * 別の引数で受ける欄(`p_{欄}`)も、`p_values` でまとめて受ける欄も、手順の入力の欄として同じに扱う
 * (実行器は手順の入力から欄の名前で引く)。
 */
function inputIdSourceOf(input: FactsInput, entity: string): { readonly kind: 'input'; readonly step: number; readonly field: string } | null {
  for (const [index, params] of input.params.entries()) {
    const step = input.plan.steps[index];
    if (step === undefined) continue;
    for (const param of params) {
      if (param.source.kind === 'input_target_id' && step.entity === entity) {
        return { kind: 'input', step: index, field: 'id' };
      }
    }
  }
  const refs = inputRefsTo(input, entity);
  const named = refs.find((ref) => contextColumnOf(input, ref.holder, entity) === ref.field);
  if (named !== undefined) return { kind: 'input', step: named.step, field: named.field };
  const first = refs[0];
  if (first === undefined) return null;
  return new Set(refs.map((ref) => ref.field)).size === 1 ? { kind: 'input', step: first.step, field: first.field } : null;
}

/** 手順の入力が、その集約を指す参照の欄(別の引数で受けるもの → `p_values` でまとめて受けるもの。宣言順)。 */
function inputRefsTo(input: FactsInput, entity: string): readonly InputRef[] {
  const found: InputRef[] = [];
  for (const [index, params] of input.params.entries()) {
    const holder = input.plan.steps[index]?.entity;
    if (holder === undefined) continue;
    for (const param of params) {
      if (param.source.kind === 'input_field' && param.source.type.kind === 'ref' && param.source.type.entity === entity) {
        found.push({ step: index, holder, field: param.source.field });
      }
      // `p_values` でまとめて受ける欄の親の参照は**作成だけ**(編集の新しい値は、現在の行の親ではない)。
      if (param.source.kind === 'input_values' && input.plan.steps[index]?.kind === 'create') {
        for (const field of param.source.fields) {
          if (field.type.kind === 'ref' && field.type.entity === entity) found.push({ step: index, holder, field: field.name });
        }
      }
    }
  }
  return found;
}

/** 手順の集約の `context` が、その親へ届く欄として名指した列(`context[親] = 手順の集約.{列}`)。無ければ null。 */
function contextColumnOf(input: FactsInput, holder: string, entity: string): string | null {
  const path = findEntitySpec(input.domain, holder)?.context[entity];
  if (path === undefined) return null;
  const [head, column] = path.split('.');
  return head === holder && column !== undefined ? column : null;
}

/** `p_expected` が読む鍵(保存点の外の状態)。読む予約も同時に積む。 */
export function expectedKeysOf(
  params: readonly (readonly ResolvedParam[])[],
  readExternal: ReadExternal,
  steps: readonly SaveStepPlan[],
): readonly string[] {
  const keys: string[] = [];
  for (const [index, resolved] of params.entries()) {
    const step = steps[index];
    if (step === undefined) continue;
    for (const param of resolved) {
      if (param.source.kind !== 'expected_state' || param.source.literal !== null) continue;
      readExternal(step, param.source.entity, param.source.field);
      keys.push(`${param.source.entity}.${param.source.field}`);
    }
  }
  return [...new Set(keys)].sort((a, b) => a.localeCompare(b));
}

/**
 * 成功値(`{ id, state }`)の作り方。結末になるのは**最初の手順の集約**である。
 *
 * その集約をこの保存点が作るなら id は冪等キーそのもの(複合 RPC の `p_id`)、
 * 作らず動かすだけなら入力が指す id である。どちらでもなければ決まらない(生成時エラー)。
 */
export function resultPlanOf(input: FactsInput, problems: PlanProblem[]): UsecaseResultPlan {
  const steps = input.plan.steps;
  const first = steps[0];
  const entity = first?.entity ?? '';
  const firstCreate = steps.find((step) => step.kind === 'create' && !step.repeat);
  const created = firstCreate !== undefined && firstCreate.entity === entity;
  const fromInput = created ? null : inputIdSourceOf(input, entity);
  const idFrom: UsecaseResultIdSource = created || fromInput === null ? { kind: 'idempotency' } : fromInput;
  if (!created && fromInput === null && first !== undefined) {
    problems.push(unreadable(input.plan, first, entity, 'id'));
  }
  return { entity, idFrom, state: finalStateOf(input.domain, input.plan, entity) };
}

/**
 * `computes[].reads` の 1 本を計画の読み取りに積む(束 ㉒)。
 *
 * パスは `{entity}.{field}` に固定である —— ガード式と違って `actor.{欄}` も `now` も来ない
 * (純関数が受け取るのは**読んだ事実と入力**だけであり、実行者も時刻も見ない。見るなら
 * 純関数ではない: action-spec-writing.md §computes)。
 *
 * 読めなければ**黙って積まない**。それが穴に見えるのは A19 が宣言と計画の `reads` を
 * 突き合わせるからで、ここで止めると A15 の文面に化ける(readExternal の `optional` の注)。
 */
export function computeReadFact(
  input: FactsInput,
  step: SaveStepPlan,
  path: string,
  readExternal: (step: SaveStepPlan, entity: string, field: string, optional?: boolean) => UsecaseFactSource | null,
): void {
  const dot = path.indexOf('.');
  if (dot <= 0) return;
  const entity = entityOf(input.domain, path.slice(0, dot));
  const field = path.slice(dot + 1);
  if (entity === null || field === '') return;
  readExternal(step, entity, field, true);
}

/**
 * 作成でない手順が親を読めないときの対処に、`context` の宣言を足す(入力の新しい参照の欄から親を読むと、
 * 新しい値の親で権限が通ってしまうので、現在の行から辿る道が要る)。
 */
export function withContextHint(problem: PlanProblem, step: SaveStepPlan, entity: string): PlanProblem {
  if (step.kind === 'create') return problem;
  return {
    ...problem,
    suggestion:
      `${problem.suggestion}。作成でない手順は入力の新しい参照から親を読まない(権限が新しい値で通るため) —— ` +
      `対象の entity_spec の context で ${entity} への道を宣言するか、ガードから ${entity} の列を外す`,
  };
}
