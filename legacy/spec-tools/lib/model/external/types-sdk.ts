/**
 * external_spec の SDK の置き場の宣言(`vocabulary.service[].client_ui`)のモデル型(点検 9 回目 B9-4)。
 *
 * `types.ts` の service の語彙の行が持つ欄の部品である(`types.ts` が再 export する)。
 */

/** `client_ui` の 1 行(ファイルと、そのファイルが値で引いてよいパッケージ)。 */
export interface ExternalClientUiDecl {
  /** クライアントの部品のファイル(リポジトリルート相対)。 */
  readonly file: string;
  /** 値で引いてよいパッケージ(同じ service の `sdkPackages` のどれかに当たる綴り。グロブは書けない)。 */
  readonly packages: readonly string[];
}
