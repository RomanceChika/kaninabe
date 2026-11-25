/**
 * **生成器の変異テスト**の型(束 ⑳-5c)。
 *
 * 変異テストが問うのは「検査に漏れが無いか」である。生成器・検査器・オラクルが正しく動いている
 * ことは、正しい仕様を入れて緑になることでは示せない —— **宣言を 1 か所わざと壊したときに、
 * どれかが赤になる**ことでしか示せない。束 ⑳-3〜⑳-5b は束ごとに手で 1〜2 件そうやって
 * 確かめてきた(builder report の「変異確認」)が、機械では回っていなかった。
 *
 * ここが定めるのは 3 つである。
 *  - **変異器**(`MutationOperator`): 仕様モデルを機械で 1 か所壊す純関数。壊した場所を宣言する。
 *  - **検査**(`MutationDetector`): モデルから「観測できるもの」の指紋を取る純関数。
 *    指紋が変異の前後で違えば、その検査はその変異を**捕っている**。
 *  - **対応表**(`MutationRow`。型は `kernel/mutation-report.ts`): 変異 × 検査の実測。**捕る検査が 1 つも無い変異は赤**である
 *    (免除リストは持たない —— 穴が見つかったら検査を直す)。
 */

import type { SpecModel } from '../model/types.js';
import type { GuardServices } from '../guard/ast.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { JobSpecModel } from '../model/job/types.js';
import type { GenerateContext } from '../gen-kit/generator.js';
import type { EqCatalogEntry } from '../world/index.js';

/**
 * 壊した宣言の**執行点の所在**(宣言された例外を引くための鍵)。
 *
 * 壊した宣言を執行するのは、その集約の書き込み RPC である。`shape` はその形であり、
 * data_table の `functions[].shape` と同じ語である —— 「その形の関数が生成物か、手写しと
 * 宣言されているか」を、**宣言から**引くのに使う(自由記述の免除リストを作らないため)。
 */
export interface MutationSite {
  /** 壊した宣言が属するエンティティ(data_table の帰属 `entity` と同じ語)。 */
  readonly entity: string;
  /** 執行する書き込み RPC の形。 */
  readonly shape: 'transition' | 'create' | 'update' | 'delete';
  /** 遷移を壊したときの `{機械}.{イベント}`(action_spec の `handles` と同じ語)。 */
  readonly event?: string;
  /**
   * 作成・編集・削除の規則を壊したときの、その規則の `by`(ロール ID)。
   *
   * `composite` の関数が `enforces` で名指す規則(`writes` + `by`)と突き合わせるための鍵である。
   */
  readonly by?: string;
}

/** 変異 1 件(壊したあとのモデルと、壊した場所)。 */
export interface Mutant {
  /** 変異器の ID。 */
  readonly operator: string;
  /** **どの宣言のどこを**壊したか(人が読む 1 行)。 */
  readonly at: string;
  /** 壊した宣言の執行点の所在(執行点を持たない宣言 —— ロール階層・読み取り —— では無い)。 */
  readonly site?: MutationSite;
  /** 壊したあとのモデル。 */
  readonly model: SpecModel;
}

/** 変異器 1 つ(仕様モデルを 1 か所壊す)。 */
export interface MutationOperator {
  /** 識別子(対応表の行になる)。 */
  readonly id: string;
  /** 人が読む「何を壊すか」。 */
  readonly title: string;
  /**
   * **壊す宣言の名前**(仕様の DSL に現れる語)。
   *
   * 目録の**範囲**はここから導く —— 「この表は何を壊してみたのか」を人が数えられるように
   * するための欄であり、`scope.ts` が宣言する「まだ壊す変異器を持たない宣言」と並べて
   * 保証の章の冒頭に生成物として出る。手で書いた範囲の文を章に貼らないための 1 欄である。
   */
  readonly breaks: string;
  /**
   * 壊せる場所すべてについて変異を作る(壊せる場所が無ければ空)。
   *
   * 並びは「**より微妙な変異が先**」である(例: ロールが 2 つ以上ある `by` から 1 つ落とす方が、
   * 1 つしかない `by` を空にするより気づきにくい)。呼び側は先頭から必要な数だけ取る。
   */
  mutate(model: SpecModel): readonly Mutant[];
}

/**
 * 1 題材ぶんの材料(**変異の前**の姿。申し送り 1)。
 *
 * 変異の前の軸で変異の後の生成物を実行する —— world や組み合わせの軸まで変異させると、
 * 「落とした側」の変異が world からその実行者ごと消えてしまい、変異が見えなくなる
 * (⑳-5a2 §7 ② の実測)。だから軸(`catalog` / `rlsWorlds`)はここに**変異前のまま**持つ。
 */
export interface MutationSubject {
  /** 題材の名前(報告と対応表の見出し)。 */
  readonly name: string;
  /** 変異前のドメイン仕様。 */
  readonly model: SpecModel;
  readonly guards: GuardServices;
  readonly actions: ActionSpecModel | undefined;
  readonly dataTables: DataTableSpecModel | undefined;
  readonly jobs: JobSpecModel | undefined;
  /** 生成器に渡す文脈(他の仕様種は変異させない)。 */
  readonly context: GenerateContext;
  /** 一致の証明の目録(**変異前**の軸)。 */
  readonly catalog: readonly EqCatalogEntry[];
}

/** 検査 1 つ(モデルから観測できるものの指紋を取る)。 */
export interface MutationDetector {
  readonly id: string;
  /** 人が読む「何を見ている検査か」。 */
  readonly title: string;
  /**
   * そのモデルに対する観測の指紋。
   *
   * 例外を投げる観測(生成器が前提の破れで止まる等)は、呼び側が
   * `error:…` の指紋に畳む —— **止まったこと自体が「捕った」**である。
   *
   * @param model 観測対象のモデル(変異前・変異後の両方で呼ばれる)
   * @param subject 題材の材料(軸は変異前のまま)
   * @returns 指紋(同じ観測なら同じ文字列)
   */
  fingerprint(model: SpecModel, subject: MutationSubject): string;
}
