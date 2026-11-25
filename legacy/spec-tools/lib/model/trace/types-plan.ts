/**
 * action_spec のうち**実行計画にかかわる 2 つの宣言**(`computes` / `runner`)の型。
 *
 * 入口は types.ts(そこから再 export される)。実行計画にかかわる宣言という 1 つの概念の型で、
 * パーサー(`parse-action-plan.ts`)と同じ線で分けてある。
 */

import type { LiteralValue } from '../../kernel/literal-value.js';
import type { SourceLocation } from '../types.js';

/** 例の表の値(YAML が運べる値。数値・真偽・文字列・null・配列・マッピング)。 */
export type ComputeExampleValue = LiteralValue;

/**
 * 純関数の呼び口の形(`computes[].shape`。閉じた値域)。
 *
 * 例の表(`examples`)の `given` をどう関数の引数に写すかを宣言が持つ —— 関数の署名から
 * 生成器が推測しない(推測すると、署名を変えた瞬間に生成物の意味が黙って変わる)。
 *
 * - `facts_input` … `(facts, input) => 値`(既定。`facts` は計画が読んだ事実、`input` は操作の入力)
 * - `input` … `(input) => 値` の 1 引数の関数(`given` は `input` だけ。`expect` は戻り値の写しで、入れ子の値は書いた鍵だけ照合する)
 */
export const COMPUTE_SHAPES = ['facts_input', 'input'] as const;

/** 純関数の呼び口の形。 */
export type ComputeShape = (typeof COMPUTE_SHAPES)[number];

/**
 * 例の表の 1 行(`computes[].examples[]`)。入力 → 値の**データ**であり、式ではない。
 *
 * 式は純関数のまま DSL の外に置く(domain-spec-writing.md「DSL の外に置くもの」)。ここが持つのは
 * 「この入力のときこの値になるはず」という人が読める主張の一覧で、**生成されるユニットテストが
 * 純関数の実際の値と突き合わせる** —— 一致しなければ式か例のどちらかが間違っている。
 */
export interface ActionComputeExample {
  /** 人が読む行の名前(短い言葉。1 つの `computes` の中で一意)。 */
  readonly note: string;
  /** `given.facts`(`{entity}.{field}` → 値)。`shape: input` では書けない。 */
  readonly facts: Readonly<Record<string, ComputeExampleValue>>;
  /** `given.input`。`facts_input` では操作の入力の欄 → 値、`input` では関数の引数そのもの。 */
  readonly input: Readonly<Record<string, ComputeExampleValue>>;
  /** 期待する値(`facts_input` ではその `field` の型の値、`input` では戻り値の写し)。 */
  readonly expect: ComputeExampleValue;
  readonly location: SourceLocation;
}

/**
 * 計算値の宣言 1 件(`computes`。束 ⑰ 設計 §3-2)。
 *
 * 「入力に無いが、この操作の実行時に**純関数**が決める値」である。入力にも実行者にも DB にも
 * 無い欄を RPC が要求するとき、実装の中にだけ住んでいた計算(料金の確定額・遅れ確定の席)を
 * 宣言の側に出すための欄であり、宣言が無ければ操作の実行計画は**導出できない**
 * (そこが「仕様に無い知識が実装にある」箇所そのものである)。
 *
 * **`supplied_by: db` にできるものはここに書かない**(V17 が DB 側の機構を要求する)。
 * 集計とポリシーの組み合わせで SQL 化の判断が済んでいないものだけがここに来る。
 */
export interface ActionComputeDecl {
  /** 書かれたままの `{entity}.{field}`。 */
  readonly raw: string;
  readonly entity: string;
  readonly field: string;
  /** 値を決める純関数の名前(`app/src/domain/computes/{ref}.ts` の主 export)。 */
  readonly ref: string;
  /**
   * その純関数が**読む事実**(`{entity}.{field}` の並び。束 ㉒)。
   *
   * 純関数が受け取るのは「その計画が読んだ事実」と「入力」だけである。宣言が無かったあいだ、
   * 計画が読むのは**ガード式・ロールの binding・予測状態・結果の id** が要求した欄だけで、
   * 計算の材料は 1 欄も積まれなかった —— それでも `verify` はエラーも警告も出さなかった
   * (材料の届かない `computes` が黙って通る穴。束 元の製品 B の実測と独立レビュー F-4)。
   * ここはその材料を宣言の側に出す欄であり、`plan-facts.ts` が計画の `reads` に積む。
   *
   * 自分の集約の欄も別の集約の欄も書ける。**読めない集約は A19 がエラーにする** ——
   * 「読める」は entity_spec の `context`(1 段 / 2 段)と入力が id を指すことから決まる。
   */
  readonly reads: readonly ActionComputeReadRef[];
  /** 純関数の呼び口の形(省略は `facts_input`)。 */
  readonly shape: ComputeShape;
  /**
   * 例の表(任意。入力 → 値の行の並び。宣言順)。
   *
   * 書けば生成器が**ユニットテスト**と**ブックの早見表**を出す。同じ `ref` を持つ複数の欄
   * (1 本の関数が表を返し、欄ごとにその一部を書く形)は、**1 つの欄にだけ**書く
   * (どの欄に書いても同じ関数の例であり、重ねると同じ行を何度も数える)。
   */
  readonly examples: readonly ActionComputeExample[];
  readonly location: SourceLocation;
}

/** `computes[].reads` の 1 本(`{entity}.{field}`)。 */
export interface ActionComputeReadRef {
  /** 書かれたままの `{entity}.{field}`。 */
  readonly raw: string;
  readonly entity: string;
  readonly field: string;
  readonly location: SourceLocation;
}

/** `runner` の値域(宣言が無ければ「生成された実行計画で走る」)。 */
export const ACTION_RUNNER_KINDS = ['manual'] as const;

/** 実行器の選び方。 */
export type ActionRunnerKind = (typeof ACTION_RUNNER_KINDS)[number];

/**
 * 実行器の選び方の宣言(`runner`。束 ⑰ 設計 §5)。
 *
 * 書かなければ「操作は仕様から導出した実行計画で走る」——`runner: manual` は
 * **規約に乗らない RPC を呼ぶ操作**だけが宣言できる例外であり、理由が必須である
 * (免除リストを作らない。理由の無い例外は仕様の穴と区別が付かない)。
 */
export interface ActionRunnerDecl {
  readonly kind: ActionRunnerKind;
  /** なぜ生成に乗らないか(日本語 1 文)。 */
  readonly reason: string;
  readonly location: SourceLocation;
}
