/**
 * 実装(app/)側から読み取った、ルートに関する事実の型。
 *
 * lib/model/screen/types.ts が「仕様が宣言したもの」の型であるのに対し、ここは**実装が持っている事実**の型である。
 * S7 はこの 2 つを突き合わせるためだけに存在し、突合の向きが混ざらないよう置き場を分けてある
 * (走査そのものは lib/screen/app-loader.ts、変換規則は lib/screen/route-match.ts)。
 */

/** 画面の器の `generateMetadata` の形(S7 が関門のある画面で見る。読むのは `lib/screen/page-metadata.ts`)。 */
export type PageMetadataForm =
  /** 置いていない。 */
  | { readonly kind: 'none' }
  /** 最初の文が `symbol` の呼び出しを待つ。 */
  | { readonly kind: 'gated'; readonly symbol: string }
  /** 許可の形の外(別名の export・再 export・関門の前の文など)。 */
  | { readonly kind: 'unreadable' };

/** 実装側のルート 1 本(`app/src/app` の `page.tsx` 1 枚)。 */
export interface AppRoute {
  /** ファイル配置から導いた route(仕様と同じ URL の形。例: `/workshops/:id`)。 */
  readonly route: string;
  /** リポジトリルートからの相対パス(Finding の location に入る)。 */
  readonly file: string;
  /** ファイルの `generateMetadata` の形(S7 が関門のある画面で見る。読めないファイルは許可の形の外)。 */
  readonly metadata: PageMetadataForm;
}

/**
 * リクエスト前段(`app/src/proxy.ts`)の `matcher` 宣言。
 *
 * **静的パースであり、実行時の挙動そのものではない**。matcher に正規表現や
 * オブジェクト形式を書かれると解釈できないため、その場合は `patterns` に生の文字列を残しつつ
 * S7 が「検査の範囲外」として警告する(黙って緑にしない)。
 */
export interface ProxyMatcherModel {
  /** `src/proxy.ts` を読めて `matcher` の配列を取り出せたか。 */
  readonly available: boolean;
  /** リポジトリルートからの相対パス。 */
  readonly file: string;
  /** matcher に書かれた文字列(宣言順)。 */
  readonly patterns: readonly string[];
}

/**
 * 実装(app/)側から読み取った、ルートに関する事実。S7 の突合先。
 *
 * 仕様側の検証器が実装のファイルシステムを見る初のケースであり、走査の起点は
 * **CLI から渡す**(検証器・ローダーがパスを決め打ちしないので、fixture で試験できる)。
 */
export interface AppRoutesModel {
  /** `app/src/app` を読めたか。false なら S7 は実行しない(app/ が無い構成でも壊れない)。 */
  readonly available: boolean;
  /** 見つかった実ルート(名前順)。 */
  readonly routes: readonly AppRoute[];
  readonly proxy: ProxyMatcherModel;
  /** 画面の器の走査で読めなかった場所(リポジトリルート相対)。空でなければ S7 が赤にする(読めない木を「ルートが無い」と読まない。点検 14 回目 C14-1)。省略は無し。 */
  readonly unreadable?: readonly string[];
  /**
   * **実装の木があるのに、置き場の配置が画面の器の走査を決められない**ときの理由(`available: false` と一緒に持つ)。**「実装の木がまだ無い」(スキップ)とは別物**:
   * S7 が前提の失敗として指し、実行ログも「実装の木が無いためスキップ」と言わない(配置の欠落を、実装が無いことと読ませない)。省略は「理由なし」。
   */
  readonly placementProblem?: string;
  /**
   * 置き場の配置にリクエスト前段の役割(`request-gate`)が無い(`true`)。そのスタックには前段の `matcher` が無い概念なので、要ログイン画面の被覆の突合は**できない**
   * (緑でも警告でもない — 実行ログが「未実施」と名指す)。省略は「配置にある」。
   */
  readonly requestGateMissing?: true;
}
