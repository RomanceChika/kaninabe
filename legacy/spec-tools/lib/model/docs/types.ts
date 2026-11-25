/**
 * 文書整合検証(M 群)が扱うモデルの型定義。
 *
 * V 群がドメイン仕様の「意味」を、A 群が仕様⇔実装⇔テストの「対応」を見るのに対し、
 * M 群は docs/rules のルール文書と docs/specs の仕様文書そのものの「構文的な健康状態」
 * (フロントマターの充足・ID の一意性と形式・参照先の実在・リンク切れ・テンプレ準拠・循環)を見る。
 * 走査ルートは 2 つだが台帳(モデル)は 1 つで、ID の一意性はツリーをまたいで見る。
 *
 * 検証器は純粋関数であり fs に触れないため、実在判定など I/O が必要な情報は
 * すべてローダー(loader.ts / template.ts)がここに詰めて渡す
 * (規約: scripts-code-quality.md「I/O と純粋ロジックの分離」)。
 */
import type { ProductRoots } from '../product/types.js';

/** 本文中の見出し 1 つ。 */
export interface DocHeading {
  /** 見出しレベル(1〜6)。`##` なら 2。 */
  readonly level: number;
  /** 見出し文字列。アンカー(`{#id}`)と `(任意)` 等の注記を取り除いた正規形。 */
  readonly text: string;
  /** 正規化前の見出し文字列。テンプレート側の「任意」「繰り返し」の判定に使う。 */
  readonly raw: string;
  /** ファイル先頭からの行番号(1 始まり)。 */
  readonly line: number;
}

/** 本文中の相対リンク 1 つ。実在判定はローダーが済ませてある。 */
export interface DocLink {
  /** Markdown に書かれたリンク先そのもの(フラグメント込み)。 */
  readonly href: string;
  /** 解決先のリポジトリルート相対パス。 */
  readonly target: string;
  /** 解決先がファイル(または README.md/index.md を持つディレクトリ)として実在するか。 */
  readonly exists: boolean;
  /** ファイル先頭からの行番号(1 始まり)。 */
  readonly line: number;
}

/** テンプレートが定める H2 見出し 1 つ。 */
export interface TemplateHeading {
  /** 注記を取り除いた見出し名。 */
  readonly name: string;
  /** `(任意)` が付いており、文書側で省略してよいか。 */
  readonly optional: boolean;
}

/** template_policy の手順で解決されたテンプレート。 */
export interface TemplateSpec {
  /** テンプレートのリポジトリルート相対パス。 */
  readonly file: string;
  /** テンプレート自身の doc_type(汎用テンプレートで未指定なら null)。 */
  readonly docType: string | null;
  /** テンプレートが定める H2 見出しの並び。 */
  readonly h2: readonly TemplateHeading[];
  /**
   * `N:` や `{placeholder}` を含む繰り返しパターンの H2 を持つか。
   * true のテンプレートは見出しの集合が文書ごとに変わるため M5 の比較対象にしない。
   */
  readonly repeatable: boolean;
  /**
   * H2 の語彙が開いているか(テンプレートのフロントマター `h2_policy: open`)。
   *
   * true のテンプレートでは、h2 は「よく使う節の語彙」であって閉じた一覧ではない。
   * 文書ごとに固有の節を足してよく、M5 はテンプレートに無い H2 を咎めない
   * (必須節の欠落と「節がひとつも無い」ことだけを見る)。
   * ディレクトリごとに案内すべき中身が違う directory_guide のための逃がし口。
   */
  readonly openH2: boolean;
}

/**
 * 走査で読めた文書 1 件(docs/rules のルール文書と docs/specs の仕様文書の両方)。
 * template.md 自身は文書として扱わない。
 */
export interface ScannedDoc {
  /** リポジトリルート相対パス(Finding の location.file に入る)。 */
  readonly file: string;
  /** フロントマターの doc_type。無ければ null。 */
  readonly docType: string | null;
  /** フロントマターの id。無ければ null。 */
  readonly id: string | null;
  /** フロントマターの生の中身。M1 の必須項目チェックはここを見る。 */
  readonly frontmatter: Readonly<Record<string, unknown>>;
  /** 本文の見出し(AUTO-GENERATED ブロック内も含む)。 */
  readonly headings: readonly DocHeading[];
  /** template_policy の手順で解決したテンプレート。見つからなければ null。 */
  readonly template: TemplateSpec | null;
}

/** 相対リンクを読んだファイル 1 件(CLAUDE.md と docs/ の下の全部の Markdown。フロントマターの有無を問わない)。 */
export interface LinkedFile {
  /** リポジトリルート相対パス(Finding の location.file に入る)。 */
  readonly file: string;
  /** 本文の相対リンク(AUTO-GENERATED ブロック内とコード内は除く)。 */
  readonly links: readonly DocLink[];
}

/** M 群の検証入力。docs/rules と docs/specs を合わせて 1 つのモデルとして扱う。 */
export interface DocsModel {
  /** 読み込めた文書(走査ルートごとにファイルパス順)。 */
  readonly docs: readonly ScannedDoc[];
  /** リンクの実在を見る対象(M4。`docs` と別の閉じた集合: CLAUDE.md + docs/ の下の全部の .md)。 */
  readonly linked: readonly LinkedFile[];
  /** 製品が宣言した根(仕様の木・ドメイン知識の位置)。 */
  readonly roots: ProductRoots;
}
