/**
 * 用語の台帳(term_ledger。`terms.md`)のモデル型。
 *
 * 仕組みの**説明語**(規約・ブック・設計メモで使う造語・借用語)は、これまで綴りの規則が無かった。
 * 1 つの概念に 3 つの綴りができると grep が効かず、AI への指示がぶれ、レビューで「これは前に読んだ
 * あれと同じか」が毎回起きる。台帳は**1 語 1 行**で語を宣言し、**使わない綴り(`avoid`)を禁じる**
 * ことで、1 概念 1 語を機械に見張らせる。
 *
 * 業務の語を厚く書く `docs/knowledge/TERM-*.md`(W 層)とは別物である —— こちらは仕組み側の
 * 説明語だけを持ち、語釈は 1 行である。
 *
 * 書き方の正: docs/rules/process/common/specification/standards/term-ledger-writing.md。
 */

import type { SourceLocation } from '../types.js';

/**
 * 語の出どころ(値域)。
 *
 *   - `borrowed` … 借用(他分野の語をそのまま持ってきた。`閉世界` / `接地` / `見張りテスト`)
 *   - `coined` … 造語(この仕組みが作った語。`注釈` / `執行点`)
 *   - `literal` … 直訳(英語の概念を日本語にした語。`母集合` / `全域性`)
 *   - `english` … 英語のまま(日本語にして意味が復元できないので綴りを戻した語。`fixture`)
 */
export const TERM_ORIGINS = ['borrowed', 'coined', 'literal', 'english'] as const;

/** 語の出どころ。 */
export type TermOrigin = (typeof TERM_ORIGINS)[number];

/**
 * 語が出る場(`face`。値域)。
 *
 *   - `framework` … 仕組みの説明語(規約・設計メモ・ブックの本文で使う語)
 *   - `book` … ブックの生成文が読者に出す語(表紙の「この本に出てくる言葉」に載る)
 *
 * 2 つを 1 つの台帳の 2 つの `face` として持つので、「ブックが台帳に無い語を読者に出していないか」も
 * 同じ台帳で見られる。
 */
export const TERM_FACES = ['framework', 'book'] as const;

/** 語が出る場(`face`)。 */
export type TermFace = (typeof TERM_FACES)[number];

/** 台帳の 1 行(1 語)。 */
export interface TermDecl {
  /** 本文で使う綴り(日本語、または英語のまま)。 */
  readonly term: string;
  /** 英語の識別子(コード・仕様の綴り。スネークケース。台帳の中で一意)。 */
  readonly id: string;
  /** 1 行の定義。ブックの表に出る。 */
  readonly gloss: string;
  /** 語の出どころ。 */
  readonly origin: TermOrigin;
  /** 初出(この語を導入している文書のリポジトリルート相対パス)。M7 が語の実在を見る。 */
  readonly first: string;
  /** 語が出る場(`face`)。 */
  readonly face: TermFace;
  /** **使わない綴り**(1 概念 1 語の執行点)。別名を許すのではなく禁じる。M9 が見る。 */
  readonly avoid: readonly string[];
  /**
   * **この語を使わない用法**(1 行。例: 「samples:db などの通し実行はこの語で呼ばない」)。無ければ null。
   *
   * `gloss` は語の意味を 1 文で言う欄であり、禁じる用法は持たせない(多義になった語の線引きが
   * `gloss` に混ざると、1 文を守れず読み手に「この語は何の語か」が分からなくなる)。綴りの禁止
   * (`avoid`)は機械が見張るが、こちらは**用法の禁止**であり、人が読む。
   */
  readonly not: string | null;
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** 台帳 1 ファイル分の宣言。 */
export interface TermLedgerSpec {
  /** 文書 ID(`term-ledger` 固定 — 1 プロジェクト 1 台帳)。 */
  readonly id: string;
  /** 語の全数(宣言順)。 */
  readonly terms: readonly TermDecl[];
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** 台帳を読み終えたあとのモデル。 */
export interface TermLedgerModel {
  /** 台帳のファイルがあったか。false なら M7〜M9 は実行しない(台帳をまだ開設していない製品)。 */
  readonly available: boolean;
  /** 読み込んだ台帳。ファイルが無い・読めないときは null。 */
  readonly ledger: TermLedgerSpec | null;
}

/** 本文の 1 行(フロントマターと HTML コメント行を除いたもの)。 */
export interface ProseLine {
  /** ファイル先頭からの行番号(1 始まり)。 */
  readonly line: number;
  /** 行の本文(原文のまま)。 */
  readonly text: string;
  /** 例示の印(`例:`)がある行か。M9 はこの行を走査から外す。 */
  readonly example: boolean;
}

/** 走査した文書 1 枚の本文。 */
export interface ProseFile {
  /** リポジトリルート相対パス。 */
  readonly file: string;
  /** 本文の行(出現順)。 */
  readonly lines: readonly ProseLine[];
}

/**
 * M9 の走査範囲(どの木・どのファイルを読むか)。**範囲を決めるのはここだけ**で、検証器は読んだ結果だけを受け取る。
 *
 * 範囲外は `scope.ts` の `TERM_OUT_OF_SCOPE` が理由つきで宣言する(黙って外れるものを作らない)。
 */
export interface TermScanScope {
  /** 本文の全行を読む Markdown の木(規約・設計メモ・ブック・スキル・引き継ぎ文書)。 */
  readonly proseTrees: readonly string[];
  /** `proseTrees` の中で読まない Markdown のファイル(歴史の記録。リポジトリルート相対)。 */
  readonly proseOutOfScope: readonly string[];
  /** 生成ブロックを除いて読む Markdown の木(仕様の本文。図・表は生成物)。 */
  readonly specTrees: readonly string[];
  /** 読む Markdown のファイル(リポジトリ直下の案内)。 */
  readonly proseFiles: readonly string[];
  /** コメントと日本語を含む文字列リテラルを読むコードの木(生成物は目印で外す)。 */
  readonly codeTrees: readonly string[];
  /** 実装の木の根(`codeTrees` がその根を歩くとき、出力の閉じた表を当てる。無ければ null)。 */
  readonly appRoot?: string | null;
  /** 文字列リテラルを読まないコードのファイル(リポジトリルート相対。理由は `TERM_OUT_OF_SCOPE`)。コメントは読む。 */
  readonly literalOutOfScope: readonly string[];
  /** `#` コメントを読む木(シェルと YAML。`.githooks` と `.github`)。 */
  readonly hashCommentTrees: readonly string[];
  /** 人が書く文(`summary:`)を集める木(ドメイン仕様。M12 が文体を見る)。 */
  readonly summaryTrees: readonly string[];
}

/** 人が書く文 1 つ(仕様の `summary:` の値)。M12 が文体を見る。 */
export interface HumanSentence {
  /** 書かれているファイル(リポジトリルート相対)。 */
  readonly file: string;
  /** その文の仕様内の位置(frontmatter の YAML パス。例: `machines[0].states[1].summary`)。 */
  readonly pointer: string;
  /** 文の本文。 */
  readonly text: string;
}

/**
 * M7〜M10・M12 が見る入力。**ファイルシステムを読んだ結果**であり、検証器は fs に触れない
 * (規約: scripts-code-quality.md「I/O と純粋ロジックの分離」)。
 */
export interface TermCorpus {
  /** 走査範囲(規約の木・設計メモの木・ブック)の文書の本文。 */
  readonly files: readonly ProseFile[];
  /**
   * 台帳の `first` が指す文書の生テキスト。読めなかった(実在しない)パスは null。
   * 走査範囲の外のファイルも指せるので、`files` とは別に持つ。
   */
  readonly firstTexts: ReadonlyMap<string, string | null>;
  /** 人が書く文(仕様の `summary:`)。M12 が文体を、M10 が語の接地を見る。 */
  readonly summaries: readonly HumanSentence[];
  /**
   * ドメイン仕様の frontmatter の値(`summary` を除く)をつなげた本文。M10 が「仕様に書かれた語」を引く
   * 語彙で、`summary` 自身は入れない(自分で自分の語を接地させない)。
   */
  readonly specText: string;
}
