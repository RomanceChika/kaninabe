/**
 * 視覚層(デザイントークン)の型定義。
 *
 * 仕様の正は `docs/specs/frontend/design/tokens.md` のフロントマターであり、ここはその
 * 型付きの写像である。読み方・検査の正は
 * `docs/rules/process/frontend/system/standards/conventions/styling.md`(G0〜G4)。
 */
import type { ProductRoots } from '../product/types.js';

/** palette の 1 件。ここだけが hex を持つ(トークンは ref で指す)。 */
export interface PaletteEntry {
  /** palette の名前(例: `indigo-600`)。 */
  readonly name: string;
  /** `#rrggbb` 形式の実値。 */
  readonly hex: string;
}

/** 意味を持つトークン 1 件。 */
export interface DesignToken {
  /** トークン名 = CSS custom property 名(`--` を除いたもの。例: `color-accent`)。 */
  readonly name: string;
  /** 属するグループ(名前の接頭辞と一致する)。 */
  readonly group: string;
  /** 解決済みの実値。`ref` があれば palette の hex、無ければ宣言した直値。 */
  readonly value: string;
  /** palette の名前。色以外のトークンでは null。 */
  readonly ref: string | null;
  /** 用途の短い説明(生成物のコメントに出る)。 */
  readonly note: string | null;
  /**
   * 「実際には重ねないので contrast 網羅の床(G3)の対象外」という理由(1 行)。
   * 色トークン(`ref` を持つトークン)だけが持ちうる。**受け入れの記録**であって
   * 検査を消す操作ではない ―― `decorative` を持つのに `contrast` にも現れるトークンは
   * G3 が矛盾としてエラーにする(重ねないと言った色を重ねている)。
   */
  readonly decorative: string | null;
}

/** トークンのグループ(色・余白・字組…)。 */
export interface DesignGroup {
  /** グループ名(例: `color`)。 */
  readonly group: string;
  /** このグループが何を決めるか。 */
  readonly purpose: string;
  /** 所属トークン(宣言順)。 */
  readonly tokens: readonly DesignToken[];
}

/**
 * トークン層の外から供給される CSS custom property。
 *
 * 「実在しないトークンの参照」(G2)と区別するために、供給元と理由つきで宣言して受け入れる。
 */
export interface DesignExternal {
  /** 変数名(`--` を除いたもの)。 */
  readonly name: string;
  /** 供給元のファイル(リポジトリルート相対)。 */
  readonly from: string;
  /** なぜ仕様側で値を持てないか。 */
  readonly reason: string;
}

/** 前景 / 背景の組み合わせと、満たすべきコントラスト比。 */
export interface ContrastPair {
  /** 前景のトークン名。 */
  readonly fg: string;
  /** 背景のトークン名。 */
  readonly bg: string;
  /** 満たすべき比(4.5 = WCAG AA の本文 / 3 = 大きい文字・UI 部品の境界)。 */
  readonly min: number;
}

/**
 * 「実物のロゴが無い期間だけ」の受け入れの記録。
 *
 * 書くと G8 の (b)(実在) (c)(既定と不一致) が error から warning に格下げされる。
 * (a)(宣言の有無)と (d)(favicon.ico 残骸)は placeholder があっても常に error のまま
 * ―― 「アイコンを宣言していない」「既定の残骸が残っている」は仮のロゴの有無とは無関係の
 * 別の不備だからである。
 */
export interface DesignBrandPlaceholder {
  /** なぜ仮のロゴのままか(実物への差し替え時期・仮アイコンの説明)。 */
  readonly reason: string;
}

/**
 * ロゴ(アプリのアイコン)の宣言。
 *
 * Next.js の Metadata Files 規約(`icon.png` | `icon.svg` 等)に従うファイルへの
 * パス(リポジトリルート相対)を持つ。`icon` 以外は任意。
 */
export interface DesignBrand {
  /** `app/src/app/icon.png` | `icon.svg` へのパス。宣言が無ければ null(G8(a) がエラーにする)。 */
  readonly icon: string | null;
  /** `app/src/app/apple-icon.png` へのパス。任意。 */
  readonly appleIcon: string | null;
  /** `app/src/app/opengraph-image.png` へのパス。任意。 */
  readonly ogImage: string | null;
  /** 実物のロゴ待ちの受け入れ。無ければ null。 */
  readonly placeholder: DesignBrandPlaceholder | null;
}

/** トークン仕様 1 ファイル分。 */
export interface DesignTokenSpec {
  /** テーマ名(snake_case)。 */
  readonly theme: string;
  /** 仕様ファイル(リポジトリルート相対)。生成物のヘッダに出す。 */
  readonly file: string;
  /** palette(宣言順)。 */
  readonly palette: readonly PaletteEntry[];
  /** グループ(宣言順)。 */
  readonly groups: readonly DesignGroup[];
  /** 全トークンを平らに並べたもの(グループ順・宣言順)。 */
  readonly tokens: readonly DesignToken[];
  /** 外部供給の CSS 変数。 */
  readonly externals: readonly DesignExternal[];
  /** 検査するコントラストの組み合わせ。 */
  readonly contrast: readonly ContrastPair[];
  /** ロゴ(アプリのアイコン)の宣言。`brand:` の節そのものが無ければ null。 */
  readonly brand: DesignBrand | null;
}

/**
 * 読み込み済みのトークン仕様。
 *
 * `available: false` は「`specs/frontend/design/tokens.md` がまだ無い」を意味する
 * (query_spec / screen_spec と同じ流儀)。生成器も検証器もその場合は何もしない。
 */
export interface DesignTokenModel {
  /** トークン仕様を読めたか。 */
  readonly available: boolean;
  /** 読めた仕様。読めなければ null。 */
  readonly spec: DesignTokenSpec | null;
}

/** 走査した CSS ファイル 1 枚。 */
export interface ScannedCssFile {
  /** ファイル(リポジトリルート相対)。 */
  readonly file: string;
  /** 中身。 */
  readonly source: string;
  /** 生成物か(生成物は G1 の対象外 —— palette の実値はそこにしか置けない)。 */
  readonly generated: boolean;
}

/** 実装側の CSS の走査結果。 */
export interface CssScanResult {
  /** `app/src` を読めたか。false なら G1・G2 は実行しない。 */
  readonly available: boolean;
  /** 見つかった CSS(パス順)。 */
  readonly files: readonly ScannedCssFile[];
}

/** ブランドファイル 1 件の実在チェック結果。 */
export interface BrandFileCheck {
  /** 仕様に書かれたパス(リポジトリルート相対)。 */
  readonly declaredPath: string;
  /** ファイルが実在するか。 */
  readonly exists: boolean;
  /** 実在するファイルの SHA-256(16 進)。実在しなければ null。 */
  readonly sha256: string | null;
}

/**
 * `brand` が指す各ファイルの実在チェック結果(G8 の材料)。
 *
 * ファイル I/O(実在確認・ハッシュ計算)は loader.ts が済ませ、検証器は結果だけを受け取る
 * (規約: scripts-code-quality.md「I/O と純粋ロジックの分離」)。
 */
export interface BrandFileStatus {
  /** `brand.icon` のチェック結果。宣言が無ければ null。 */
  readonly icon: BrandFileCheck | null;
  /** `brand.apple_icon` のチェック結果。宣言が無ければ null。 */
  readonly appleIcon: BrandFileCheck | null;
  /** `brand.og_image` のチェック結果。宣言が無ければ null。 */
  readonly ogImage: BrandFileCheck | null;
  /**
   * ハンドブック側の写し(読み物の `assets/brand-icon.<拡張子>`)のチェック結果。
   * SVG は生成物として写されるので null。PNG 等の二値ファイルは生成の文字列経路に載らないため
   * 手で写し、G8 が実装側と同じハッシュであることを見る。宣言が無ければ null。
   */
  readonly bookCopy: BrandFileCheck | null;
  /** 既定の favicon.ico が(Next のテンプレート既定の残骸として)残っているか。 */
  readonly faviconIcoExists: boolean;
  /**
   * その favicon.ico の置き場(リポジトリルート相対)。実装の木を持たない製品では null。
   *
   * 検証器は純粋関数なので、**パスの綴りをローダーから受け取る** —— 製品が実装の木を
   * どこに置いたかを検証器が知っていてはならない(W3)。
   */
  readonly faviconIcoPath: string | null;
  /**
   * app/ の木があるか = ロゴの実ファイルを突き合わせられる環境か。
   *
   * false(仕様だけを持つリポジトリ)では実ファイルが存在しえないので、G8 は実在を見る
   * (b)(c)(d) を飛ばす —— placeholder を宣言し続ける以外に消せない warning を作らない
   * (X1・J2・S7 と同じ扱い。束 ⑲-1)。
   */
  readonly appGrounded: boolean;
}

/** G 群の検証器が受け取る入力。 */
export interface DesignInput {
  /** トークン仕様。 */
  readonly tokens: DesignTokenModel;
  /** 実装側の CSS。 */
  readonly css: CssScanResult;
  /** ブランドファイル(ロゴ)の実在チェック結果。 */
  readonly brand: BrandFileStatus;
  /** 製品が宣言した根(道案内のパスを組み立てる)。 */
  readonly roots: ProductRoots;
}
