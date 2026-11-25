/**
 * ユースケース仕様(usecase_spec)の型付きモデル。
 *
 * スキーマの正: docs/rules/process/frontend/specification/standards/usecase-spec-writing.md
 * 背景: docs/rules/decisions/common/ADR-0011-usecase-layer-two-origins.md
 *
 * usecase_spec が宣言するのは「ドメインの操作を、目的・誰・どこから・達成条件・操作列・
 * 保存点で**組み合わせる**」ことだけである(ADR-0011 §2)。ガード・権限・必須・不変条件は
 * 書けない —— 書けるキーを allowlist で閉じることで、それらを**定義し直す**経路そのものを
 * 無くしている(Y0 がスキーマ適合を見る)。
 */

import type { SourceLocation } from '../types.js';
import type { ActionTestCase } from '../../testcase/types.js';

/**
 * `defaults` の値域。
 *
 * 「自分として」= 保存点の入力欄で、実行者(actor)自身を指す ref フィールドの既定値にする、
 * という UI 都合の宣言である(実際にどのフィールドへ効くかは束⑯c の 1 画面フォーム生成が
 * 決める。usecase_spec の時点では「self という語がある」ことだけを保証する)。
 */
export const USECASE_DEFAULT_KEYS = ['self'] as const;

/** `defaults` の語彙。 */
export type UsecaseDefaultKey = (typeof USECASE_DEFAULT_KEYS)[number];

/** 保存点の 1 手順(`saves[].steps[]`)。 */
export interface UsecaseStepDecl {
  /**
   * 操作 ID。ドメインイベント ID(`{machine}.{event}`)または予約 ID
   * (`{entity}.create` / `.delete` / `.update`)。接地の実在は Y1 が見る。
   */
  readonly op: string;
  /**
   * 別名(`as`。任意)。**同じ操作を 1 つの保存点で 2 回以上書くための唯一の手段**である。
   *
   * 入力・結果・入力スキーマ・フォームの節・testid の鍵はすべてこの別名であり、書かなければ
   * 鍵は `op` になる(`stepKey`)。保存点の中で一意であることは Y11 が見る。
   */
  readonly alias: string | null;
  /** フォームの節の見出し(任意)。書かなければ操作の label(遷移の label / 集約の label)。 */
  readonly label: string | null;
  /** この手順を繰り返せるか(既定 false)。true なら手数の数え上げに「+N」を添える。 */
  readonly repeat: boolean;
  /** 「自分として」の既定値(任意)。書けるのは `self: true` だけ。 */
  readonly defaultsSelf: boolean;
  readonly location: SourceLocation;
}

/**
 * その手順の鍵(別名があればそれ、無ければ操作 ID)。
 *
 * 複合 RPC の `p_input` / 戻り値・入力スキーマ・実行計画・フォームの節と testid が**同じ 1 つの
 * 導出**を共有するための関数である(鍵の正が 2 つになると、生成物どうしがすれ違う)。
 *
 * @param step 手順の宣言
 * @returns 鍵
 */
export function stepKey(step: UsecaseStepDecl): string {
  return step.alias ?? step.op;
}

/** 保存点 1 つ(`saves[]`)。内側は全部か無しか(ADR-0011 §4)。 */
export interface UsecaseSaveDecl {
  /** 保存点 ID(snake_case)。複合 RPC・Server Action の名前(束⑯c)の材料になる。 */
  readonly id: string;
  /** 人の言葉での説明(ハンドブックの物語に出る)。 */
  readonly label: string;
  /**
   * この保存点の複合 RPC を書き出す migration のファイル名(`supabase/migrations/` 配下)。
   *
   * 形式は `{14 桁}_usecase_{name}_{save}.sql`(Y7)。生成器がこのファイルを whole-file で
   * 書く。**SQL が変わる仕様変更をしたら名前を新しくする** —— migration は追記専用の歴史
   * であり、適用済みのファイルを書き換えると DB と食い違うためである(ADR-0011 §4 /
   * migrations.md §生成 migration)。
   */
  readonly migration: string;
  readonly steps: readonly UsecaseStepDecl[];
  readonly location: SourceLocation;
}

/** 認知の予算(手数・画面・概念・前提・入力・確認)の指標名(値域)。 */
export const USECASE_BUDGET_METRICS = [
  'steps',
  'screens',
  'concepts',
  'preconditions',
  'inputs',
  'confirmations',
] as const;

/** 予算の指標名。 */
export type UsecaseBudgetMetric = (typeof USECASE_BUDGET_METRICS)[number];

/**
 * 規約(usecase-spec-writing.md)が定める既定予算。
 *
 * `budget` を書かないユースケースはこの値と比較される(Y5)。数字の根拠・変更の手順は
 * usecase-spec-writing.md に書く(ここはコードとしての正であり、数字を動かすときは
 * 先に規約を直してからここを合わせる)。
 */
export const DEFAULT_USECASE_BUDGET: Readonly<Record<UsecaseBudgetMetric, number>> = {
  steps: 4,
  screens: 2,
  concepts: 3,
  preconditions: 2,
  inputs: 8,
  confirmations: 1,
};

/** 予算の宣言(`budget:`)。書かれた指標だけが既定を上書きする。 */
export type UsecaseBudget = Partial<Readonly<Record<UsecaseBudgetMetric, number>>>;

/**
 * 理由つき受け入れ(`accept:`)1 件。
 *
 * 受け入れられるのは **warning だけ**である(エラーは仕様の問題であって、理由で消せない)。
 * 2 種類あり、どちらも「何を受け入れるか」を名指しする —— 一括で黙らせる口は作らない。
 *   - `metric`: 認知の予算の超過(Y5)。
 *   - `invariant`: この保存点が触る集約の不変条件のうち、**application 執行なのに保存点が
 *     実行しない**もの(Y10 の warning。束⑯g・ADR-0012 の当座)。
 */
export type UsecaseAcceptDecl =
  | {
      readonly kind: 'budget';
      readonly metric: UsecaseBudgetMetric;
      readonly reason: string;
      readonly location: SourceLocation;
    }
  | {
      readonly kind: 'invariant';
      /** 受け入れる不変条件の id(実在を Y1 が見る)。 */
      readonly invariant: string;
      readonly reason: string;
      readonly location: SourceLocation;
    };

/** 1 つの usecase_spec ファイル(= 1 ユースケース)。 */
export interface UsecaseSpec {
  /** `usecase-{name をハイフン区切りにしたもの}`(例: usecase-entry-self)。 */
  readonly id: string;
  /** ユースケース名(snake_case)。 */
  readonly name: string;
  /** 人の言葉での目的(ハンドブックの見出し)。 */
  readonly goal: string;
  /** 実行者。role_spec のグローバル人間ロール 1 つ(Y1)。 */
  readonly actor: string;
  /** 起点の画面 id。実在を Y1 が見る。 */
  readonly start: string;
  /** 達成条件(ガード式と同じ文法の生文字列)。Y6 が評価可能性と最終手順との整合を見る。 */
  readonly done: string;
  /** 保存点の列(1 つ以上)。 */
  readonly saves: readonly UsecaseSaveDecl[];
  /** 認知の予算(任意。書かれた指標だけ既定を上書きする)。 */
  readonly budget: UsecaseBudget;
  /** 予算超過(Y5)の理由つき受け入れ(任意)。 */
  readonly accept: readonly UsecaseAcceptDecl[];
  /**
   * テストケース宣言(複合 RPC の突合テストを指す)。Y9 が実装との接地を見る。
   *
   * 保存点ごとに「署名・本文の突合」と「挙動」の 2 種類のテストを紐づける場所であり、
   * action_spec / data_table の `test_cases` と同じ形式・同じ ID 空間を使う。
   */
  readonly testCases: readonly ActionTestCase[];
  /** specs/frontend/usecases からの相対パス(例: "entry_self.md")。 */
  readonly relPath: string;
  readonly location: SourceLocation;
}

/** specs/frontend/usecases 全体。Y 群への入力の 1 つ。 */
export interface UsecaseSpecModel {
  /**
   * specs/frontend/usecases を読めたか。
   * false は「タスクをまだ仕様化していない」ことを意味し、0 件(ディレクトリはあるが空)と区別する
   * (query_spec / screen_spec と同じ流儀)。
   */
  readonly available: boolean;
  readonly usecases: readonly UsecaseSpec[];
}
