/**
 * 保存点の実行計画(plan-facts.ts)が扱う値の型。
 *
 * 供給元の語彙は**閉じており**、ここに無い形は生成時エラー(Y10)になる —— 実行器が
 * 「その他」を推測で埋める枝を持たないようにするための境界である。
 *
 * 入口は plan-facts.ts(解決の規約そのもの)で、ここは型だけを持つ。
 */

import type { SpecModel } from '../model/types.js';
import type { GuardServices } from '../guard/ast.js';
import type { ResolvedParam } from './param-source.js';
import type { PlanProblem, SavePlan } from './step-plan.js';

/**
 * 保存点の**外**の集約を 1 行読むときの「どの id で読むか」(値域)。
 *
 * 保存点の中で作る行は入らない —— `permit` を立てるのは書き込みの**前**であり、
 * その時点でまだ存在しない行を読む供給元は原理的にありえない(あれば生成時エラー)。
 */
export type UsecaseReadIdSource =
  /** 実行者自身の行(session を宣言した集約)。 */
  | { readonly kind: 'actor' }
  /** 入力の 1 欄(`{手順}.{欄}`)。 */
  | { readonly kind: 'input'; readonly step: number; readonly field: string }
  /**
   * **先に読んだ行の参照列**(`ref` は `{entity}.{field}`)。単発の操作だけに現れる。
   *
   * 対象の行は入力の `id` で読めるが、ガード式が参照する**親**の行(催し・枠)の id は入力に
   * 無い ——「このエントリーの催し」は entity_spec の `context`(`workshop: entry.workshop_id`)が
   * 宣言している解決パスであり、実行器はそれを辿る(手書きの operation が
   * `deps.workshops.findById(entry.workshopId)` と書いているのと同じ 1 段である)。
   *
   * 依存は**必ず 1 段**である: 参照元は常に操作の対象の集約であり、その行は入力の `id` で読める。
   */
  | { readonly kind: 'context'; readonly ref: string };

/** 保存点の結末の id の供給元(値域)。 */
export type UsecaseResultIdSource =
  /** 複合 RPC に渡した冪等キーそのもの(保存点が最初にその行を作る場合)。 */
  | { readonly kind: 'idempotency' }
  /** 入力の 1 欄(保存点が対象を作らず動かすだけの場合)。 */
  | { readonly kind: 'input'; readonly step: number; readonly field: string };

/** `permit` が要る値 1 つの供給元(値域)。 */
export type UsecaseFactSource =
  /** 保存点の外から読んだ事実。`ref` は `{entity}.{field}`(`reads` の結果の鍵)。 */
  | { readonly kind: 'external'; readonly ref: string }
  /** 仕様から予測した状態(作成 = initial / 遷移 = 直前の to)。 */
  | { readonly kind: 'predicted'; readonly value: string }
  /** 入力の 1 欄。 */
  | { readonly kind: 'input'; readonly step: number; readonly field: string }
  /** 実行者の id。 */
  | { readonly kind: 'actor' }
  /**
   * 実行者自身の行のうち**セッションに載っている欄**(`session: true`)。
   *
   * `claim`(`UsecaseClaimFact`)とまったく同じ経路である —— 実行器はログインセッションの
   * profile(`app_metadata.profile`)からこの 1 欄を読むだけで、**DB は読まない**。
   *
   * 「実行者の集約のその行を 1 行読む」(= `external`)に畳んではならない。実行者の集約が
   * その計画の**対象**でもあるとき、外の行を読む供給元は「入力が指した対象の行」に解決される
   * (`readIdSourceOf` の `targetRowIdSourceOf`。束 ⑰-2 でロールの穴を塞ぐために意図的に
   * そうした分岐である)。畳むと `product.company_id == actor.company_id` の両辺が**同じ 1 つの
   * 事実**になり、テナント境界のガードが宣言も警告もなく恒真になる(束 ⑲-2a レビューが実測)。
   * **実行者の属性と対象の行の属性は別の事実**であり、供給元も別である。
   */
  | { readonly kind: 'session'; readonly field: string }
  /** 判断時刻。 */
  | { readonly kind: 'now' };

/** ガード式の変数 1 つとその供給元。 */
export interface UsecaseGuardFact {
  /** ガード式に現れるパス(`workshop.state` / `now` など)。 */
  readonly variable: string;
  readonly source: UsecaseFactSource;
}

/** 文脈ロール 1 つと、その binding の左辺(実行者 id と比べる値)の供給元。 */
export interface UsecaseRoleFact {
  readonly role: string;
  readonly source: UsecaseFactSource;
}

/**
 * `claim` を持つロール 1 つと、根拠になるセッションの欄(束 ⑰ 設計 §4)。
 *
 * 実行器はセッションの profile(`SessionProfile`)の `field` を読み、`true` ならそのロールを
 * 立てる。**DB は読まない** —— 欄は `session: true` を宣言しているので、ログイン時に
 * `app_metadata.profile` へ載っている(V11 がそれを見ている)。
 */
export interface UsecaseClaimFact {
  readonly role: string;
  /** セッションの profile の欄名(`SESSION_FIELDS` の 1 つ)。 */
  readonly field: string;
  /** 立つ値の集合(state / enum の欄。boolean の欄なら持たない。ADR-0018)。 */
  readonly values?: readonly string[];
}

/** 実行者自身の行の欄の条件 1 つ(`UsecaseStepFacts.roleGates` の要素)。 */
export interface UsecaseRowCondition {
  readonly field: string;
  readonly values?: readonly string[];
}

/** 保存点の外の集約 1 つの読み取り(1 集約 1 回)。 */
export interface UsecaseRead {
  readonly entity: string;
  readonly table: string;
  readonly idFrom: UsecaseReadIdSource;
  /** 読む列(重複なし・宣言順)。 */
  readonly fields: readonly string[];
}

/** 1 手順ぶんの事実。 */
export interface UsecaseStepFacts {
  /**
   * 遷移の**遷移元の状態**の供給元(作成では null)。
   *
   * 保存点の中で作った・動かした集約なら仕様からの予測(ADR-0011 §4)、外の集約なら読んだ値。
   */
  readonly stateFrom: UsecaseFactSource | null;
  readonly guardFacts: readonly UsecaseGuardFact[];
  readonly roleFacts: readonly UsecaseRoleFact[];
  /** この手順が認める `claim` ロールと、その根拠になるセッションの欄(宣言順)。 */
  readonly claimFacts: readonly UsecaseClaimFact[];
  /**
   * この手順が認めるロールごとの、併せて満たす実行者の行の条件(ADR-0018 の E2。無ければ持たない)。
   *
   * 既定のログインロール自身の条件と、`claim` を持つロールを含意する側の含意の先の条件。
   * 実行計画の `roleGates` へそのまま出る(ロール配列から立つロールにも効く、DB の述語の写し)。
   */
  readonly roleGates?: Readonly<Record<string, readonly UsecaseRowCondition[]>>;
  /**
   * この手順が認めるロールのうち、**保存点の経路では立たない**もの(宣言順)。
   *
   * 保存点の実行器が立てられるのは「セッションから立つグローバルロール(`kind` を持つ)」と
   * 「計画が供給元を持つ文脈ロール(`binding` を持つ)」だけである。どちらでもないロール
   * (行の属性が根拠のもの)はこの経路では解決できない —— その人はこの保存点を通れない。
   * 1 つも立たない手順は Y10 のエラーであり、混じっているだけならここに載せて**黙らせない**
   * (ハンドブック「タスク」章がこの並びを出す)。
   */
  readonly unresolvableRoles: readonly string[];
  /** 入力から受け取る欄(`inputSchemaKeys`)。 */
  readonly inputKeys: readonly string[];
}

/** 保存点の成功値(`{ id, state }`)の作り方。 */
export interface UsecaseResultPlan {
  /** 結末の集約。 */
  readonly entity: string;
  /** id の供給元。 */
  readonly idFrom: UsecaseResultIdSource;
  /** 保存点を通った後の予測状態(状態を持たない集約なら null)。 */
  readonly state: string | null;
}

/** 保存点 1 つぶんの事実。 */
export interface SaveFacts {
  readonly reads: readonly UsecaseRead[];
  /** 複合 RPC の `p_expected` に載せる鍵(`{entity}.{field}`)。 */
  readonly expectedKeys: readonly string[];
  /** `plan.steps` と同じ並び。 */
  readonly steps: readonly UsecaseStepFacts[];
  /** 適用が要る application 執行の不変条件 ID。 */
  readonly invariantHooks: readonly string[];
  readonly result: UsecaseResultPlan;
}

/** 解決の結果。1 つでも決まらなければ `problems` を返す。 */
export type SaveFactsResult =
  | { readonly ok: true; readonly facts: SaveFacts }
  | { readonly ok: false; readonly problems: readonly PlanProblem[] };

/** 解決に要る入力(接地済みの保存点 + 解決済みの引数 + ドメイン + ガード解析)。 */
export interface FactsInput {
  readonly plan: SavePlan;
  /** `resolveSaveParams` の結果(手順の並びと同じ)。 */
  readonly params: readonly (readonly ResolvedParam[])[];
  readonly domain: SpecModel;
  readonly guards: GuardServices;
}

