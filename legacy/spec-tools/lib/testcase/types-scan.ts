/**
 * app/ の走査結果の型(注釈・片方だけの注釈・guardEnv の鍵・テストブロックの事実・走査結果そのもの)。
 *
 * テストケースの共通の語彙の実装側の半分である —— `types.ts` が `test_cases` の宣言(仕様側)の形で、
 * ここは app/ を走査して得た事実(実装側)の形。どの仕様種の検査もこれを入力に受け取るので、
 * 種類に属さない `testcase/` に置く(走査の実装 `model/trace/extract-assertions.ts` はこの型を import する側で、
 * 型の置き場が実装に引きずられない)。
 */

/** ブロック内の呼び出し 1 件(ヘルパ判定の材料。位置は「ループの中か」だけ持つ)。 */
export interface CallSite {
  /** 呼ばれている識別子。 */
  readonly name: string;
  /** その呼び出しがループの本体の中にあるか。 */
  readonly inLoop: boolean;
}

/**
 * `@spec` はあるが `@tc` が無い行(片方だけの注釈)1 件。
 *
 * 注釈の名前空間は `@tc` 一本であり、`@spec` だけの行は突合キーを持たないので
 * どの検査の母集合にも現れない(書いた本人には「注釈を付けたつもり」に見えるのに、
 * A6 の uncovered/orphan にも A12 の無印判定にも引っかからず**静かに見落とされる**)。
 * A12 がこれを直接エラーにする(テスト義務の全域化 決定 #3)。
 */
export interface HalfTagRef {
  /** リポジトリルートからの相対パス(区切りは "/")。 */
  readonly file: string;
  /** 1 始まりの行番号。 */
  readonly line: number;
  /** `@spec` の値(空白区切りで複数書ける)。 */
  readonly specIds: readonly string[];
}

/**
 * `@tc-each {ひな形}` 1 件(**期待表の全数ループの注釈**)。
 *
 * 表ごとの `it` を手で並べるとテストファイルがアプリの表名の一覧になり、別題材では
 * 1 本も実行できない。ループに寄せると `it` の名前が実行時にしか定まらないので、静的な
 * ひな形だけを示し、台帳のテスト名がそれに当てはまる ID を「このループが実行している」
 * と読む(展開は lib/trace/expand-each.ts)。
 */
export interface EachTagRef {
  /** リポジトリルートからの相対パス(区切りは "/")。 */
  readonly file: string;
  /** 1 始まりの行番号。 */
  readonly line: number;
  /** 書かれたひな形(`{table} の列と制約が宣言どおりである` など)。 */
  readonly template: string;
  /**
   * ひな形の直後のループが実際に付けている `it` の名前(穴を `{}` に寄せたもの)。
   *
   * ひな形と食い違えば A12 が止める —— ひな形だけを書き換えて突合を空にできないようにする。
   * 直後にテスト宣言が見つからなければ null。
   */
  readonly loopName: string | null;
}

/** テストコード中の `// @spec ... @tc ...` 1 件と、それが飾るテストの名前。 */
export interface TestAnnotation {
  /** `@tc` の値(例: "TC-ENTRY-SUBMIT-001")。 */
  readonly tcId: string;
  /** `@spec` の値(空白区切りで複数書ける)。 */
  readonly specIds: readonly string[];
  /**
   * アノテーション直後の it / test の第 1 引数。
   * 見つからなかった場合は null(A6 が「テスト名を特定できない」として指摘する)。
   */
  readonly testName: string | null;
  /**
   * 注釈が**テスト宣言の直前の行**にあるか(挟めるのは例示の印 `// #region …` の行だけ)。
   *
   * 位置を規約で固定するのは、注釈を `it(...)` の**中**に書くと A16 がブロックを切り出せず
   * **中身の検査を丸ごと外せる**ためである(独立レビュー 束 ㉑ の 2-B の実測)。false の
   * 注釈は A12 が error にする。任意にしてあるのは、この型を組み立てる他群のテストヘルパが
   * 明示しなくても壊れないようにするため(読む側は `?? true` で既定に倒す)。
   */
  readonly decorates?: boolean;
  /** リポジトリルートからの相対パス(区切りは "/")。 */
  readonly file: string;
  /** 1 始まりの行番号。Finding の pointer に使う。 */
  readonly line: number;
}

/**
 * 注釈付きテストブロック 1 件の中身の事実(A16 の材料)。
 *
 * 「注釈があってテストが実在する」ことと「そのテストが何かを確かめている」ことは別である
 * (検査の漏れ探し 2026-09-12 §5: `expect(` を全部消しても全検査が緑だった)。
 */
export interface TestBlockRef {
  /** リポジトリルートからの相対パス。 */
  readonly file: string;
  /** `@tc` の値。 */
  readonly tcId: string;
  /** 注釈の行(1 始まり)。 */
  readonly line: number;
  /** ブロックを構文で切り出せたか(false なら A16 は warning で数だけ言う)。 */
  readonly readable: boolean;
  /** `expect(` の直接呼び出しの数。 */
  readonly directAssertions: number;
  /** `expect(` の直接呼び出しのうち、**ループの外**にあるものの数。 */
  readonly directAssertionsOutsideLoop: number;
  /**
   * ブロック内で呼ばれている識別子(出現ごと・位置つき)。
   *
   * assert を含むヘルパの判定(error 段の免除)と、**ヘルパ呼び出しがループの中にしか
   * 無いか**の判定(warning 段。独立レビュー 束 ㉑ の 2-C)の両方に使う。
   */
  readonly calls: readonly CallSite[];
}

/** 手書きの `guardEnv` が返す鍵 1 件(A14 の材料)。 */
export interface GuardEnvRef {
  /** リポジトリルートからの相対パス。 */
  readonly file: string;
  /** `guardEnv` が返すオブジェクトリテラルの最上位の鍵(出現順・重複なし)。 */
  readonly keys: readonly string[];
  /** 規約の形から外れていて鍵を確定できなかったか(A14 が「読めない」として報告する)。 */
  readonly unreadable: boolean;
}

/**
 * app/ の走査結果。
 *
 * 検証器はファイル I/O をしないため、「そのパスにファイルがあるか」も
 * ここに載せて渡す(規約: scripts-code-quality.md)。
 */
export interface TestScanResult {
  /** app/ ディレクトリが存在し走査できたか。false ならトレース検証はスキップする。 */
  readonly available: boolean;
  /** 見つかったテストファイル(リポジトリルートからの相対パス)。 */
  readonly testFiles: readonly string[];
  /** 見つかった `@tc` アノテーション。 */
  readonly annotations: readonly TestAnnotation[];
  /**
   * `@spec` はあるが `@tc` が無い行(片方だけの注釈。A12 が直接エラーにする)。
   *
   * 任意にしてあるのは、この型を組み立てる他群のテストヘルパ(screen-builder 等)が
   * 空リストを明示しなくても壊れないようにするため(読む側は `?? []` で既定値に倒す)。
   */
  readonly halfTags?: readonly HalfTagRef[];
  /**
   * `@tc-each` のひな形(**展開前**。A12 がひな形とループの食い違いを見る)。
   *
   * 検証器が読むのは展開後の `annotations` であり、ここは「ひな形がどこに何と書かれていたか」
   * という事実だけを持つ。任意にしてあるのは `halfTags` と同じ理由。
   */
  readonly eachTags?: readonly EachTagRef[];
  /** `app/src/app/_actions/**` に実在する実装ファイル(リポジトリルートからの相対パス)。 */
  readonly actionFiles: readonly string[];
  /**
   * 手書きの `guardEnv` が返す鍵(A14 が実行計画の導出と突き合わせる)。
   *
   * 任意にしてあるのは、この型を組み立てる他群のテストヘルパが空リストを明示しなくても
   * 壊れないようにするため(読む側は `?? []` で既定値に倒す。`halfTags` と同じ理由)。
   */
  readonly guardEnvs?: readonly GuardEnvRef[];
  /**
   * `app/src/operation/**` に実在する実装ファイル(リポジトリルートからの相対パス)。
   *
   * A10 が `scans[].implementation` の指す先の実在を確かめるために使う。走査の実体は
   * 起こすイベントの operation に同居する(ARCH-BE-0015 の「時間駆動のドメインイベント」)ため、
   * 母集合は operation 層である。
   */
  readonly operationFiles: readonly string[];
  /**
   * 注釈付きテストブロックの中身の事実(A16 の材料)。
   *
   * 任意にしてあるのは、この型を組み立てる他群のテストヘルパが空リストを明示しなくても
   * 壊れないようにするため(`halfTags` / `guardEnvs` と同じ理由。読む側は `?? []`)。
   */
  readonly testBlocks?: readonly TestBlockRef[];
  /**
   * テスト・テスト支援コードが宣言する「assert を含むヘルパ」の名前(A16 の許容)。
   *
   * これが無いと A16 は「ヘルパを使うな」という別の規則に化ける(実測で 7 種・104 ブロックが
   * ヘルパに依存している)。任意である理由は `testBlocks` と同じ。
   */
  readonly assertionHelpers?: readonly string[];
}
