/**
 * **変異の目録の実測結果**(データ)と、その行の読み方。
 *
 * 変異の目録を**回す**のは生成器と検査器を実際に動かす側(`lib/mutation/` の `matrix.ts` / `detectors.ts`)で、
 * 人向けの本(保証の章)はその結果を**データとして受け取る** —— 本が自分で変異を回すと、
 * 本の生成器の依存が SQL の生成器(DDL・RLS・RPC 本文)まで広がる(設計メモ §11)。
 * 後段は中間表現とデータだけを受け取る(§7 教訓 1)。回した結果は組み立ての根
 * (起動は `lib/mutation/context-report.ts`、載せるのは `generate/generate-context.ts`)が `GenerateContext.mutation` に載せる。
 * 生成器の側が変異の層(`lib/mutation/`)を読まずにこの型を受け取れるよう、kernel に置く(設計メモ §13)。
 *
 * ここが持つのは**型と、行を読む純関数だけ**である(検出器も生成器も import しない)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

/**
 * **宣言された例外**(捕る検査は無いが、仕様が「本文は手で持つ」と宣言している場所)。
 *
 * 免除リストではない。**根拠は仕様の宣言そのもの**であり、機械が読む —— action_spec の
 * `runner`(生成に乗らない操作。A15 が両方向を見る)・data_table の `functions[].handwritten`
 * (本文が手写しの RPC。T6 が理由を必須にする)・data_table の `functions[].enforces`
 * (`composite` の関数が執行点になる `writes` の規則。T18 が実在を見る)の 3 つだけである。どれも
 * **見張りテストの宣言(`test_cases`)が無ければ例外として認めない** —— テストの宣言が無い手写しは
 * 宣言ではなく、ただの穴である(T4 と同じ流儀)。
 */
export interface MutationExemption {
  /** どの宣言が根拠か。 */
  readonly kind: 'runner' | 'handwritten' | 'enforces';
  /** 人が読む 1 行(対応表にそのまま出る)。 */
  readonly label: string;
  /** その手写しの見張りテストのテストケース ID。 */
  readonly canaries: readonly string[];
}

/**
 * **検査器が報告している漏れ**(捕る検査は無いが、`verify` がその所在を警告として出している)。
 *
 * 免除ではない —— 警告は消えないし、消すには仕様を直すしかない。区別する理由は、検査の漏れには
 * 2 つの種類があるからである: **誰も知らない穴**(誰かが踏むまで存在しないことになっている)と、
 * **場所が判っていて毎回 verify に出ている穴**である。前者を後者に変えることが「穴を検査器に
 * 変える」であり、変異テストが赤で要求しているのはそこまでである(塞ぐかどうかは仕様側の判断)。
 */
export interface MutationNamedHole {
  /** 示す検査器の ID(例: `A18`)。 */
  readonly verifier: string;
  /** 人が読む 1 行(対応表にそのまま出る)。 */
  readonly label: string;
}

/** 対応表の 1 行(変異 1 件 × 全検査の実測)。 */
export interface MutationRow {
  readonly subject: string;
  readonly operator: string;
  readonly at: string;
  /** 捕った検査の ID(宣言順)。空なら誰も気づかなかった変異である。 */
  readonly caughtBy: readonly string[];
  /** 捕る検査が無かった変異のうち、**仕様が「本文は手で持つ」と宣言している**もの。 */
  readonly exemption?: MutationExemption;
  /**
   * 捕る検査は無いが、**検査器が警告でその所在を示している**もの。
   *
   * `caughtBy` が空で、`exemption` も `named` も無い行が**検査の漏れ**である
   * (誰も気づかず、どこにも出ない変異。`holesOf`)。
   */
  readonly named?: MutationNamedHole;
}

/** まだ壊す変異器を持たない宣言(示すための 1 件)。 */
export interface UnmutatedDeclaration {
  /** 仕様の DSL に現れる語。 */
  readonly declaration: string;
  /** 人が読む「それは何か」。 */
  readonly label: string;
  /** いつ投入するか(**免除ではない** —— 消すには変異器を足すしかない)。 */
  readonly pending: string;
}

/** 変異器 1 つの表示用の情報(壊し方そのものは持たない)。 */
export interface MutationOperatorInfo {
  readonly id: string;
  /** 人が読む「何を壊すか」。 */
  readonly title: string;
  /** 壊す宣言の名前(仕様の DSL に現れる語)。 */
  readonly breaks: string;
}

/** 検査 1 つの表示用の情報(指紋の取り方そのものは持たない)。 */
export interface MutationDetectorInfo {
  readonly id: string;
  /** 人が読む「何を見ている検査か」。 */
  readonly title: string;
}

/**
 * 変異の目録の**実測結果**(1 題材ぶん)。
 *
 * 人向けの本が表を組むのに要るものだけを、データで持つ。
 */
export interface MutationReport {
  /** 変異 1 件ごとの実測(出現順)。 */
  readonly rows: readonly MutationRow[];
  /** 登録された変異器の全数(表の行の並び)。 */
  readonly operators: readonly MutationOperatorInfo[];
  /** 登録された検査の全数(表の列の並び)。 */
  readonly detectors: readonly MutationDetectorInfo[];
  /** この題材で「壊せる場所が 1 つも無かった」変異器の ID。 */
  readonly withoutSite: readonly string[];
  /** この目録が壊す対象の種類(1 語)。 */
  readonly scope: string;
  /** まだ壊す変異器を持たない宣言の全数(消し込み式。空もある)。 */
  readonly unmutated: readonly UnmutatedDeclaration[];
}

/**
 * 変異の目録を**回した結果**(起動の口が返すもの。回せなかったときは理由を持つ)。
 *
 * 回せなかった(`unavailable`)のは材料が足りないとき(保証台帳やテーブル仕様が読めていない等)で、
 * **回さなかった**(`not_run`。`MutationOutcome`)とは別の事実である —— 前者は製品の側の都合・後者は入口の方針。
 */
export type MutationRunOutcome =
  | { readonly state: 'ran'; readonly report: MutationReport }
  | {
      readonly state: 'unavailable';
      /** 回せなかった原因の句(「…ので出さない」の前に入る形。例: 「テーブル仕様が読めていない」)。 */
      readonly reason: string;
    };

/**
 * 生成の文脈が持つ**変異の目録の状態**(`GenerateContext.mutation`)。
 *
 * 保証の章が「目録 0 行」と「回していない」を取り違えないための欄である(0 行は「壊せる宣言が無かった」とも読める)。
 *   - `ran` … 回して実測を得た
 *   - `unavailable` … 回そうとしたが材料が無くて回せなかった(理由つき)
 *   - `not_run` … この入口は変異を回さない(ハンドブックだけを出す入口。変異の層を読み込まない)
 */
export type MutationOutcome = MutationRunOutcome | { readonly state: 'not_run' };

/**
 * **検査の漏れ**(捕る検査が 1 つも無く、宣言された例外でも報告された漏れでもない変異)。
 *
 * 対応表・テスト・報告がこの 1 つの定義を共有する —— 「穴」の意味が 3 か所で別々になると、
 * 表は緑・テストは赤のような食い違いが入る。
 *
 * @param rows 実測した行
 * @returns 検査の漏れの行(出現順)
 */
export function holesOf(rows: readonly MutationRow[]): readonly MutationRow[] {
  return rows.filter(
    (row) => row.caughtBy.length === 0 && row.exemption === undefined && row.named === undefined,
  );
}

/**
 * 捕る検査は無いが、仕様が「本文は手で持つ」と宣言している変異。
 *
 * @param rows 実測した行
 * @returns 宣言された例外に当たった行(出現順)
 */
export function exemptedOf(rows: readonly MutationRow[]): readonly MutationRow[] {
  return rows.filter((row) => row.caughtBy.length === 0 && row.exemption !== undefined);
}

/**
 * 捕る検査は無いが、検査器が警告でその所在を示している変異(**報告された漏れ**)。
 *
 * @param rows 実測した行
 * @returns 報告された漏れの行(出現順)
 */
export function namedOf(rows: readonly MutationRow[]): readonly MutationRow[] {
  return rows.filter((row) => row.caughtBy.length === 0 && row.named !== undefined);
}

/** 対応表に出す見張りテストの宣言の件数(残りは「ほか N 件」)。 */
const SHOWN_CANARIES = 2;

/**
 * 宣言された例外を 1 行で宣言する(対応表と報告で同じ字面にする)。
 *
 * @param exemption 宣言された例外
 * @returns 「根拠(見張りテスト: …)」の 1 行
 */
export function exemptionText(exemption: MutationExemption): string {
  const shown = exemption.canaries.slice(0, SHOWN_CANARIES).join(' / ');
  const rest = exemption.canaries.length - SHOWN_CANARIES;
  const canaries = rest > 0 ? `${shown} ほか ${rest} 件` : shown;
  return `${exemption.label}(見張りテスト: ${canaries})`;
}
