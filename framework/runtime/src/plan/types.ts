/**
 * 実行計画の**型**(`RunPlan` とその部品)。
 *
 * 保存点の計画(`usecase-plans.ts`)と単発の操作の計画(`operation-plans.ts`)は**同じ形**である
 * ——「1 操作 = 手順が 1 つの保存点」(束 ⑰ 設計 §0)。したがって型は 1 か所にあり、実行器
 * (`operation/_template/run-plan.ts`)はその 1 つの型だけを知る。
 *
 * **ここは生成物ではない。** 束 ①-b までは生成器(`code-plan-types.ts`)が固定の文面を吐いて
 * `app/src/domain/generated/plan-types.ts` に置いていたが、**仕様を 1 行も読んでいなかった**
 * ——「実行計画の形」はアプリの仕様から導かれるものではなく、フレームワークが決めている
 * **軸**である(「軸は仕組み・語はアプリ」)。軸の宣言を製品の生成物に置くと、仕組み側の
 * コード(実行器・一致の証明のハーネス)が製品を読む逆向きの依存になる(設計メモ
 * `docs/design/runtime-package.md` §1-2 の A)。だからここが正である。
 *
 * **アプリの語彙は 1 語も無い** —— 集約名・状態名・イベント ID はここに 1 つも現れない。
 * 軸を定めている散文は usecase-spec-writing.md と server-actions.md である。
 */

import type { CreateTable, DeleteTable, MachineTable, WriteTable } from '../domain/engine/types';

/**
 * 読む行を 1 つに絞る id の供給元(値域)。
 *
 * 保存点の中で作る行は入らない —— `permit` は書き込みの前に立てるので、その時点でまだ
 * 存在しない行は読めない。
 */
export type RunReadIdSource =
  /** 実行者自身の行(`session: true` を宣言した集約)。 */
  | { readonly kind: 'actor' }
  /** 入力の 1 欄(`{手順}.{欄}`)。 */
  | { readonly kind: 'input'; readonly step: number; readonly field: string }
  /**
   * **先に読んだ行の参照列**(`ref` は `{entity}.{列}`)。単発の操作だけに現れる。
   *
   * 「この行の親」は entity_spec の `context` が宣言している解決パスであり、実行器はその
   * 1 段を辿る。`reads` は依存の無いものが先に並んでいる(生成器が順序を保証する)。
   */
  | { readonly kind: 'context'; readonly ref: string };

/** 結末の id の供給元(値域)。 */
export type RunResultIdSource =
  | { readonly kind: 'idempotency' }
  | { readonly kind: 'input'; readonly step: number; readonly field: string };

/** `permit` が要る値 1 つの供給元(値域)。`external` の `ref` は `reads` の結果の鍵。 */
export type RunFactSource =
  | { readonly kind: 'external'; readonly ref: string }
  | { readonly kind: 'predicted'; readonly value: string }
  | { readonly kind: 'input'; readonly step: number; readonly field: string }
  | { readonly kind: 'actor' }
  /**
   * 実行者自身の行のうち**セッションに載っている欄**(`session: true`)。
   *
   * 実行器はログインセッションの profile(`app_metadata.profile`)からこの 1 欄を読む。
   * **DB は読まない** —— `claim`(`RunClaimFact`)とまったく同じ経路である。
   *
   * 「実行者の集約の行を 1 行読む」(`external`)に畳んではならない。読む行の id は
   * 「この計画が書き換える行を入力から指せるならそれ」が先に立つので、実行者の集約が
   * 対象でもあるとき `{対象}.{列} == actor.{列}` の両辺が同じ 1 つの事実になり、
   * 境界のガードが黙って恒真になる(束 ⑲-2a の実測)。
   */
  | { readonly kind: 'session'; readonly field: string }
  | { readonly kind: 'now' };

/** ガード式の変数 1 つとその供給元。 */
export interface RunGuardFact {
  readonly variable: string;
  readonly source: RunFactSource;
}

/** 文脈ロール 1 つと、実行者 id と比べる値の供給元。 */
export interface RunRoleFact {
  readonly role: string;
  readonly source: RunFactSource;
}

/**
 * 実行者自身の行の欄の条件 1 つ(role_spec の `claim` の根拠。ADR-0018)。
 *
 * `field` はセッション(`app_metadata.profile`)に載る欄名である。`values` が無ければ boolean の欄が
 * 真であること、あれば state / enum の欄が**値の集合のどれか**であること。実行器はセッションを
 * 読むだけでよく、**DB は読まない**(DB の述語が正であり、セッションの写しは遅れうる)。
 */
export interface RunRowCondition {
  readonly field: string;
  /** 値の集合(boolean の欄なら無い)。 */
  readonly values?: readonly string[];
}

/**
 * 実行者自身の行の欄が根拠のロール 1 つ(role_spec の `claim`)。
 *
 * `field`(と、あれば `values`)はセッション(`app_metadata.profile`)に載る欄の条件である。
 * 実行器はそこを読むだけでよく、**DB は読まない** —— 欄が `session: true` を宣言していることは V11 が見ている。
 */
export interface RunClaimFact extends RunRowCondition {
  readonly role: string;
}

/** 判断材料として読む行 1 つ(1 集約 1 回)。 */
export interface RunRead {
  readonly entity: string;
  readonly table: string;
  readonly idFrom: RunReadIdSource;
  readonly fields: readonly string[];
}

/** 手順の形(5 形の定型のうち、計画に乗る 4 つ)。 */
export type RunStepKind = 'create' | 'transition' | 'delete' | 'update';

/** 計画の 1 手順。 */
export interface RunStepPlan {
  /** 操作 ID(ドメインイベント ID または予約 ID。拒否が載せるのはこちら)。 */
  readonly op: string;
  /**
   * 入力・結果の鍵(usecase_spec の `as`。書かなければ `op`)。
   *
   * 同じ操作を 1 つの保存点で 2 回実行する保存点では `op` が 2 つの手順で同じになるので、
   * 入力(`p_input`)と結果を引くときの鍵はこちらである。
   */
  readonly alias: string;
  /** 人の言葉での見出し(usecase_spec の `label`。書かなければ操作の label)。 */
  readonly label: string;
  readonly kind: RunStepKind;
  readonly aggregate: string;
  readonly repeat: boolean;
  /** 「自分として」の宣言(`defaults.self`)。 */
  readonly self: boolean;
  /** 遷移のイベント名(状態機械の中での名前)。遷移以外では null。 */
  readonly event: string | null;
  /** 作成規則の表(作成のときだけ)。 */
  readonly createRules: CreateTable | null;
  /** 削除規則の表(削除のときだけ)。 */
  readonly deleteRules: DeleteTable | null;
  /** 編集規則の表(編集のときだけ)。 */
  readonly writeRules: WriteTable | null;
  /** 遷移表(遷移のときだけ)。 */
  readonly machine: MachineTable | null;
  /** 遷移元の状態の供給元(遷移以外では null)。 */
  readonly stateFrom: RunFactSource | null;
  readonly guardFacts: readonly RunGuardFact[];
  readonly roleFacts: readonly RunRoleFact[];
  readonly claimFacts: readonly RunClaimFact[];
  /**
   * この手順が認めるロールごとの、**併せて満たす実行者の行の条件**(ADR-0018 の E2。無ければ空)。
   *
   * 既定のログインロールが行の条件(`claim`)を持つなら、その条件自身と、`claim` を持つロールを
   * `implies` している側の、含意の先の条件である。ロール配列(`p_actor_roles`)から立つロールにも
   * 行から立つロールにも同じく効き、DB の述語(`自分の根拠 AND 含意の先の行の条件`)の写しである。
   * 条件を持つロールだけがキーになり、1 つも無ければこの欄ごと省く。
   */
  readonly roleGates?: Readonly<Record<string, readonly RunRowCondition[]>>;
  /**
   * この手順が認めるロールのうち、**この経路では立たない**もの。
   *
   * 立つのはセッションから立つグローバルロール(role_spec の `kind` / `claim`)と、計画が
   * 供給元を持つ文脈ロール(`binding`)だけである。ここに並ぶロールしか持たない実行者は、
   * この手順で `forbidden` になる —— 1 つも立たない手順は仕様の時点で Y10 が止めている。
   */
  readonly unresolvableRoles: readonly string[];
  /** 入力から受け取る欄(入力スキーマの鍵と一致する)。 */
  readonly inputKeys: readonly string[];
}

/** 成功値(`{ id, state }`)の作り方。 */
export interface RunResultPlan {
  readonly entity: string;
  readonly idFrom: RunResultIdSource;
  readonly state: string | null;
}

/**
 * 名前付き引数 1 本の供給元(単発の操作。値域)。
 *
 * 正は usecase-spec-writing.md §引数名 → 供給元 であり、ここはその機械的な写しである。
 * この形に載らない引数名を持つ RPC は計画が導出できない(= `runner: manual` の候補)。
 */
export type RunParamSource =
  /** 呼び出しごとに 1 つ作る冪等キー。 */
  | { readonly kind: 'idempotency_key' }
  | { readonly kind: 'actor' }
  /**
   * 実行者に立つロールの配列(`p_actor_roles`。束 ⑳-3)。
   *
   * **実行器が session から解決した閉包**である —— グローバルロールと `claim` で立つロールを
   * `implies` の推移閉包で閉じたもの。DB はこれを `by` の照合に使う(束縛のロールは配列では
   * なく行から立つので、ここに無くても DB 側で成立する)。
   */
  | { readonly kind: 'actor_roles' }
  /** 読んだ行の状態(`ref` は `reads` の結果の鍵)。楽観的並行制御の条件になる。 */
  | { readonly kind: 'expected_state'; readonly ref: string }
  | { readonly kind: 'next_state'; readonly state: string }
  | { readonly kind: 'effects'; readonly effects: readonly string[] }
  /**
   * 編集が積む副作用(`access_spec` の `writes[].effects`)。
   *
   * 遷移の `effects` と違い**判断の結果から決まる** —— 許可を返した規則が宣言していたものだけを、
   * 変更された欄の並びで集める。したがって値は計画に載らず、実行器が組む。
   */
  | { readonly kind: 'write_effects' }
  | { readonly kind: 'event_id'; readonly event: string }
  /** 入力の 1 欄。 */
  | { readonly kind: 'input_field'; readonly field: string }
  /** 入力の `id`(対象そのものの識別子)。 */
  | { readonly kind: 'input_target_id' }
  /** 入力から組み立てる jsonb(作成。並べた欄を全部入れる)。 */
  | { readonly kind: 'input_values'; readonly fields: readonly string[] }
  /** 入力から組み立てる jsonb(編集。**送られた鍵だけ**)。 */
  | { readonly kind: 'input_changes'; readonly fields: readonly string[] }
  /** 実行時に純関数が決める値(action_spec の `computes`)。`ref` は純関数名。 */
  | { readonly kind: 'computed'; readonly field: string; readonly ref: string }
  /**
   * **この遷移は自分でその列を決めない**(空を渡す)。
   *
   * 遷移の RPC が受け取る自集約の列のうち、その遷移が `records_actor` で宣言していないもの。
   * 空が「触れない」(`untouched`)なのか「空にする」(`cleared`)なのかは state_spec の
   * `clears` が宣言し、その宣言と RPC の定義(`coalesce` か代入か)は rpc-parity が突き合わせる。
   * 実行器がすることは、どちらでも空を渡すことだけである。
   */
  | { readonly kind: 'not_written'; readonly field: string; readonly contract: 'untouched' | 'cleared' };

/** 名前付き引数 1 本。 */
export interface RunParam {
  readonly name: string;
  readonly source: RunParamSource;
}

/** RPC の呼び方(値域)。 */
export type RunCall =
  /** 複合 RPC。引数は `p_id` / `p_actor_id` / `p_expected` / `p_input` の 4 本に固定される。 */
  | { readonly kind: 'composite' }
  /** 定型 RPC。data_table が宣言した `params` のとおりに名前付きで渡す。 */
  | { readonly kind: 'named'; readonly params: readonly RunParam[] };

/**
 * 実行計画 1 つ(保存点も単発の操作も同じ形)。
 *
 * 実行器(`_template/run-plan.ts`)が読むのはこの型だけである。「何を予測し、何を読み、
 * どのロールをどう解決し、どの RPC をどう呼ぶか」はすべてここに載っており、実行器の中には
 * 手順の順序と拒否の写像しか無い(PRIN-0007 / PRIN-0008)。
 */
export interface RunPlan {
  /** 保存点ならユースケース名、単発の操作なら状態機械名(または集約名)。 */
  readonly usecase: string;
  /** 保存点なら保存点 ID、単発の操作ならイベント名。`{usecase}.{save}` が拒否に載る ID。 */
  readonly save: string;
  /** 呼ぶ RPC の名前(api スキーマ)。 */
  readonly rpc: string;
  readonly call: RunCall;
  readonly reads: readonly RunRead[];
  /** 読んだ状態のうち RPC の条件になる鍵(`{entity}.{列}`)。 */
  readonly expectedKeys: readonly string[];
  readonly steps: readonly RunStepPlan[];
  /** 適用が要る application 執行の不変条件 ID(実行器が hooks から引く)。 */
  readonly invariantHooks: readonly string[];
  readonly result: RunResultPlan;
}
