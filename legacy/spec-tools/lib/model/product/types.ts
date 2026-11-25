/**
 * 製品の根の宣言(リポジトリ直下の `product.md`)のモデル。
 *
 * **仕組みの側がパスの綴りを持たないための唯一の入口**である。検査器・生成器・通し実行は
 * `app/` `docs/specs/` `supabase/migrations/` のような綴りを 1 つも持たず、ここに載った値だけを
 * 組み合わせて実際のパスを作る(W3 が綴りの再発を止める)。
 *
 * 散文の正は placement_policy.md「根は製品が宣言する」/ ARCH-SP-BE-0001「根は製品が宣言する」。
 * なぜこの形なのかは、仕組みと製品の分離の設計(経緯は非公開の開発記録)の全数表と決定 2-A。
 */

/**
 * 製品の木の根(どれもリポジトリルートからの相対パス。区切りは "/")。
 *
 * **省略できる 3 つ**(`app` / `knowledge` / `previews`)は「持たない製品が正当な形」である根で、
 * 省略されたら `null` になる —— 仕組みはその木を読む項を**エラーにせず飛ばす**。残り 4 つは
 * どの製品にも要る(仕様の木が無ければ正が無く、生成物の置き場が無ければ書き出せない)。
 */
export interface ProductRoots {
  /**
   * 製品の名前(**パスではない**)。**必須**である。読めなかったときだけ null。
   *
   * ここに書く理由は 1 つだけである: **W1 / W2 の値域に入れるため**。仕組み側のコードに
   * 製品の名前が書かれていたら、それは「軸は仕組み・語はアプリ」の破れであり、集約名や状態名と
   * まったく同じ種類の漏れである(束 ①-c-b のレビューが実測: `_template/actor-roles.ts` の散文に
   * 製品名が生き残っていた。**名前が語彙に無いから落ちなかった**)。
   *
   * 生成物・ハンドブックの露出には使わない(あちらの見出しは `APP_NAME` の設定と章の文言が正)。
   *
   * **一般語を置かない。** `orders` のような普通名詞を製品名にすると、仕組み側コードの散文に
   * 素で現れて誤検出になる(題材のフィクスチャは `sample-*` という名前を持つ)。
   */
  readonly name: string | null;
  /**
   * 製品が何かを 1 行で言う文(`product.md` の `summary`。**任意**)。書いていなければキー自体が無い。
   *
   * **推測で作らず、既定の文も入れない。** 製品の名前などから文を作ると、読み手は仕様に書かれた言葉と区別できない。
   * 書かれていれば、ハンドブックの表紙に出す(文字列として扱い、HTML・Markdown としては解釈しない)。
   * 値域は `parse-summary.ts`(空でない・1 行・長さの上限・制御文字なし)。
   */
  readonly summary?: string;
  /** 仕様の木(この製品の正)。 */
  readonly specs: string;
  /** 生成される読み物(ハンドブック)の置き場。 */
  readonly book: string;
  /** 生成物の総置き場(zod・遷移表・実行計画・トークン)。 */
  readonly generated: string;
  /** 追記専用の migration の置き場。 */
  readonly migrations: string;
  /** 実装の木。持たない製品(仕様だけ・別スタック)では null。 */
  readonly app: string | null;
  /** ドメイン知識(W 層)の置き場。持たない製品では null。 */
  readonly knowledge: string | null;
  /** 画面の SSR プレビュー断片の置き場。書き出す道具を持たない製品では null。 */
  readonly previews: string | null;
  /**
   * 用語の台帳(M8 / M9)が、仕組み自身の置き場(規約・スキル)とブック・仕様・実装の木に**加えて**読む、この製品の散文とスクリプト。
   * 宣言が無ければ空(`NO_TERM_SCAN`)—— 仕組みが開発用リポジトリの置き場(設計メモ・引き継ぎ文書・案内・フック・CI)を知らないための口である。
   */
  readonly termScan: ProductTermScan;
}

/**
 * 製品が宣言する、用語の台帳(M8 / M9)の追加の走査範囲(`product.md` の `term_scan`)。
 *
 * **仕組みは置き場の綴りを持たない。** 設計メモの木・引き継ぎ文書・リポジトリ直下の案内・git フック・CI の設定は
 * 開発用リポジトリだけにある置き場で、配布の木には無い。あるものは製品がここで宣言し、無い製品は空のまま
 * (その分の走査は行われない —— 範囲は `verify` の実行ログの「N 枚の本文」に出る)。
 */
export interface ProductTermScan {
  /** 本文の全行を読む Markdown の木。 */
  readonly proseTrees: readonly string[];
  /** 読む Markdown のファイル(リポジトリ直下の案内など)。 */
  readonly proseFiles: readonly string[];
  /** `#` コメントを読む木(シェルと YAML)。 */
  readonly scriptTrees: readonly string[];
  /** `proseTrees` の中で読まない歴史の記録。名指しのファイル。末尾が `/` なら木ごと外す。 */
  readonly history: readonly string[];
}

/** 何も宣言しない製品の走査範囲(追加の木もファイルも無い)。 */
export const NO_TERM_SCAN: ProductTermScan = { proseTrees: [], proseFiles: [], scriptTrees: [], history: [] };

/**
 * 宣言の読み込み結果。
 *
 * 他のカタログのローダー(config / notification / job)と同じ 2 状態を持つ ——
 * `available: false` は「宣言ファイルがまだ無い」(スキャフォールド前)であり、
 * `available: true` で `roots` が null なら「宣言はあるが読めなかった」である。
 */
export interface ProductRootsModel {
  /** 宣言ファイルが実在したか。 */
  readonly available: boolean;
  /** 読めた根。読めなければ null。 */
  readonly roots: ProductRoots | null;
}

/**
 * 根の名前(P1 のエラー文面と W3 の値域が共有する語)。
 *
 * `name` と `summary` は**パスではない**ので根の名前ではない(W3 は「パスの綴りを持つな」を見る規則であり、
 * 製品の名前はその相手ではない)。`termScan` は根の置き場ではなく走査範囲の宣言(複数の木とファイル)なので、これも根の名前に入れない。
 */
export type ProductRootName = Exclude<keyof ProductRoots, 'name' | 'summary' | 'termScan'>;

/** 省略できない根の名前。 */
export const REQUIRED_ROOT_NAMES: readonly ProductRootName[] = [
  'specs',
  'book',
  'generated',
  'migrations',
];

/** 省略できる根の名前(持たない製品が正当な形)。 */
export const OPTIONAL_ROOT_NAMES: readonly ProductRootName[] = ['app', 'knowledge', 'previews'];
