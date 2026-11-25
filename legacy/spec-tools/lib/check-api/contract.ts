/**
 * 検証器(Verifier)の共有インターフェース。
 *
 * 検証器は「構築済みの SpecModel を受け取り、Finding の配列を返す純粋関数」であり、
 * ファイル I/O・console 出力・例外による違反報告をしてはならない
 * (規約: docs/rules/process/common/tooling/standards/scripts-code-quality.md)。
 *
 * チェック内容の正: domain-spec-writing.md の V1〜V12。
 * 新しい検証器の追加は、この Verifier を実装したモジュールを
 * verifiers/index.ts の ALL_VERIFIERS に登録するだけで完了する(CLI の変更不要)。
 *
 * **検査の契約の置き場**: 検証の束ね(`lib/verify/`)は全種類の検査を import する側なので、検査が
 * 読む契約(この `Verifier` / `VerifyContext`)を束ねと同じディレクトリに置くと、全種類と verify が
 * 互いに依存し合う形になる(以前の `lib/verify/verifier.ts`)。契約は束ねの外のここに置く。
 * 検証結果 `Finding` は再輸出しない(使う側は `lib/kernel/finding.ts` を読む)。
 */

import type { Finding } from '../kernel/finding.js';
import type { CatalogInput } from '../kernel/input-state.js';
import type { SpecModel } from '../model/types.js';
import type { GuardServices } from '../guard/ast.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { ProductRoots } from '../model/product/types.js';

/**
 * 実装(app/src)の走査結果のうち、検証器が見る部分。
 *
 * `exportedNames` は「その名前で export された実体があるか」、`referencedNames` は
 * 「自分の宣言以外の場所から触れられているか(= 呼び出し口があるか)」である。2 つを別に
 * 持つのは、**export は残っていても呼び出し口だけが消える**という形が実在するためである
 * (束 ⑰-3 の実測)。I/O は application-ref-scan.ts。
 */
export interface ApplicationRefs {
  readonly exportedNames: ReadonlySet<string>;
  readonly referencedNames: ReadonlySet<string>;
}

/** 検証器に注入される共有サービス。検証器はここから受け取る(具象を import しない)。 */
export interface VerifyContext {
  readonly guards: GuardServices;
  /**
   * **検証対象の製品が宣言した根**(`product.md`)。
   *
   * 検証器が「どのファイルを直すか」を示すときのパスは、この宣言からしか組み立てない ——
   * `docs/specs/` のような綴りを検証器が持つと、根を動かした製品で嘘の道案内をする
   * (W3 が綴りの再発を止める)。組み立ての口は lib/model/product/paths.ts である。
   */
  readonly roots: ProductRoots;
  /**
   * app/src の走査結果(V10 の `enforced_by`(kind: application)の ref 実在検査と
   * 呼び出し口の検査が使う)。app/ が無い構成・単体テストでは省略でき、その場合は
   * これらの下位検査を何も見ない(K1 が app/ 不在で env 参照検査をスキップするのと同じ扱い)。
   */
  readonly applicationRefs?: ApplicationRefs;
  /**
   * action_spec の**入力の状態**(V16 が「その欄が入力に現れるか」を、V17 が「入力に現れないこと」を、V18 が計算値の宣言を
   * 見るのに使う)。任意の欄ではなく**必須**である。
   *
   * 以前は `actions?` で、欄が無い・読めないのどちらでも「入力に現れる欄が無い」と読んで**何も言わずに通った**。今は 3 つに分ける ——
   * **未選択**(製品が `actions` を採っていない)は、入力に現れる欄も計算値も**事実として無い**ので、その母集合(空)で判定してよい。
   * **阻害**(採ったのに無い・読めない・壊れている)は「分からない」ので、依る判定(入力に現れる enum の `labels` 必須・
   * `supplied_by: db` が入力に現れないこと・計算値の接地)は出さず、見ていないことを実行ログが 1 行ずつ報告する
   * (`verify/domain-input-notes.ts`)。**使えるのは読込済みのときだけ**(`inputValue`)。
   */
  readonly actions: CatalogInput<ActionSpecModel>;
  /**
   * data_table の**入力の状態**(V17 が `defaults` / `triggers[].supplies` / 作成 RPC の `params` を、V19 が遷移 RPC の
   * 引数の口を見るのに使う)。任意の欄ではなく**必須**である。
   *
   * 未選択・阻害のどちらでも、表を読む判定(機構の宣言・渡す口の有無・値の口)は出せない。**未選択は事実の母集合が空になる
   * のではなく、宣言の裏づけを見られない**(`supplied_by: db` を宣言した欄に機構があるかを見る先が無い)ので、どちらも
   * 見ていないことを報告する。読込済み(0 件もここ)だけが判定に使える。
   */
  readonly dataTables: CatalogInput<DataTableSpecModel>;
}

/** 全検証器が実装するインターフェース。 */
export interface Verifier {
  /** "V1"〜"V12"。domain-spec-writing.md の番号と一致させる。 */
  readonly id: string;
  /** 人間向けの短い説明(CLI のヘッダーに出す)。 */
  readonly title: string;
  /** モデル全体を検証し、違反を返す。違反ゼロなら空配列。 */
  verify(model: SpecModel, ctx: VerifyContext): Finding[];
}
