/**
 * 約束事のモデル検査(C24)の共有型。
 *
 * `formal/*.tla` は仕組み側の約束事(outbox とリトライ / コミット時評価 / 期待状態の
 * 楽観制御 / 作成の冪等キー)を写した模型であり、推論と探索は既製品(TLC)が行う。
 * ここに置くのは**写像と突合の型だけ**である(scripts-code-quality.md の
 * 「推論・探索は既製品に任せ、写像だけを自作する」)。
 *
 * どのモジュールも throw せず、問題は必ず `FormalFinding`(何が・どこで・どう直すか)で返す。
 */

/** 検査 ID。enforcement-matrix の行と一致させる。 */
export const FORMAL_CHECK_ID = 'C24';

/** 検査結果の 1 件。verify の Finding と同じ「何が・どこで・どう直すか」を揃える。 */
export interface FormalFinding {
  /** error = 受理できない / warning = 受理するが人間の確認を促す。 */
  readonly severity: 'error' | 'warning';
  /** 何が問題か(1 文、日本語)。 */
  readonly message: string;
  /** どこで(ファイル、または ファイル:行)。 */
  readonly location: string;
  /** どう直すか。 */
  readonly suggestion: string;
  /** 反例・詳細(そのまま字下げして印字される行の並び)。 */
  readonly detail?: readonly string[];
}

/** `.tla` の先頭が宣言する写し元の 1 行。 */
export interface SourceDeclaration {
  /**
   * 宣言の形。
   *
   *   - `path` … その場で書き換わるファイル(生成器の TS・アプリの TS)を直に指す。
   *   - `function` … DB の関数を名前で指す。**migration は追記専用の歴史**なので、
   *     関数を直すと新しい番号のファイルができ、旧ファイルは 1 バイトも動かない ——
   *     パスで指すと実装を直しても鮮度が赤くならないため、名前で指して最新を解決する。
   */
  readonly kind: 'path' | 'function';
  /** パス(`kind: path`)または関数名(`kind: function`)。 */
  readonly target: string;
  /** 宣言された sha256(小文字 16 進 64 桁)。 */
  readonly sha256: string;
  /** `.tla` の中での行番号(1 始まり)。 */
  readonly line: number;
}

/** 性質 1 つぶんの宣言(`formal/expectations.json` の 1 要素)。 */
export interface PropertyExpectation {
  /** 性質の名前(`S1`〜`S13` / `L1`)。 */
  readonly id: string;
  /**
   * TLC に渡す検査の種別。
   *
   * `DEADLOCK` だけは性質の式ではなく**遷移の側**を見る —— `CHECK_DEADLOCK TRUE` で回し、
   * 「ここから先へ進めない状態がある」= 待ちの循環を反例にする。掴む順が 1 つであることは
   * 不変条件として書けない(「いまの状態」の話ではない)ので、この口が要る。
   */
  readonly check: 'INVARIANT' | 'PROPERTY' | 'DEADLOCK';
  /** 日本語の意図(反例の先頭に出す)。 */
  readonly intent: string;
  /** 機械の答えがどうなるはずか。 */
  readonly verdict: 'holds' | 'violated';
  /** violated のときだけ: なぜ破れるのか(実装の交錯の説明)。 */
  readonly reason?: string;
  /** violated のときだけ: 実装のどこか(`ファイル:行`)。 */
  readonly where?: string;
  /** violated のときだけ: 直すなら何をするか。 */
  readonly remedy?: string;
}

/**
 * モデル 1 本を**1 つの定数の組で**回すぶんの宣言。
 *
 * 同じモデルを違う定数で回す行を並べてよい —— 実装の比を写した側と、前提を外した側の
 * 両方を持つためである(`Outbox.cfg` と `Outbox-lease-breach.cfg`)。前提を外した側は
 * 「その前提が効いている」ことの裏返しであり、免除ではない。
 */
export interface ModelExpectation {
  /** モジュール名(= `formal/{model}.tla`)。 */
  readonly model: string;
  /** 定数の組(= `formal/{cfg}`)。省略時は `{model}.cfg`。 */
  readonly cfg: string;
  /** その定数の組が置いている前提(人が読む 1 文)。 */
  readonly premise: string;
  readonly properties: readonly PropertyExpectation[];
}

/** 反例の 1 状態。 */
export interface TraceState {
  /** 1 始まりの通し番号。 */
  readonly index: number;
  /** その状態に至った動作の名前(初期状態なら `初期状態`)。 */
  readonly action: string;
  /** 変数名 → 値(1 行に畳んだもの)。 */
  readonly values: ReadonlyMap<string, string>;
}

/** TLC を 1 回実行した答え。 */
export type TlcResult =
  | { readonly kind: 'timeout'; readonly seconds: number }
  | { readonly kind: 'holds'; readonly states: number; readonly distinct: number; readonly depth: number }
  | { readonly kind: 'violated'; readonly trace: readonly TraceState[] }
  | { readonly kind: 'error'; readonly reason: string; readonly output: readonly string[] };
