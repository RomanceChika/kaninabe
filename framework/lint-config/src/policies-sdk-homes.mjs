/**
 * **外部の SDK の置き場**の分類とポリシー(層の境界 `boundaries/dependencies` に足す。点検 9 回目 B9-4)。
 *
 * 表の正は仕様である —— 外部連携カタログの `vocabulary.service[].sdk_packages` / `client_ui` と、置き場の配置の土台の
 * `sdkPackages`。生成器 `code-sdk-homes` がそれを製品の生成物 `sdk-homes.json` に写し、製品の `eslint.config.mjs` が
 * ここへ渡す(規則の置き場は製品の生成物を読まない —— `createLayerPlugin(frameworkStructure)` と同じ裏返し)。
 * 同じ表を検証器の X1 の (d) が仕様から直に読み、製品の木の全部の import を閉世界で見る。
 *
 * 作るもの:
 *   - 置き場ごとの分類 `sdk-home:{誰の}`(ディレクトリの下の全ファイル)と、その分類からだけ表の SDK を値で引ける許可
 *   - SDK の UI 部品を引くクライアントの部品ごとの分類 `sdk-client-ui:{ファイル}` と、名指した包みだけの許可
 * 基盤の層の既定のポリシー(`BOUNDARY_POLICIES`)は枠の基盤のパッケージしか許さないので、表に無い置き場から SDK を引くと
 * 既定の disallow で落ちる。
 */

/**
 * 包みの綴り(`ai` / `@ai-sdk/*`)を、`boundaries` の外部モジュールの `source` の綴り(下位パスを含む)にする。
 *
 * @param {string} pattern 包みの綴り
 * @returns {string[]} `source` の綴り
 */
export function packageSources(pattern) {
  return [pattern, `${pattern}/**`];
}

/**
 * 生成物 `sdk-homes.json` の表から、`boundaries` の分類(`boundaries/files` に足すもの)とポリシー
 * (`BOUNDARY_POLICIES` の後ろに足すもの)を組む。
 *
 * @param {{ homes: readonly { owner: string, dir: string, packages: readonly string[] }[], clientUi: readonly { owner: string, file: string, packages: readonly string[] }[] }} table 生成物の表
 * @returns {{ categories: { category: string, pattern: string }[], policies: object[] }} 分類とポリシー
 */
export function sdkHomeBoundaries(table) {
  const categories = [];
  const policies = [];
  for (const home of table.homes) {
    const category = `sdk-home:${home.owner}`;
    categories.push({ category, pattern: `${home.dir}/**` });
    policies.push({
      from: { file: { categories: category } },
      allow: { to: { module: { origin: "external", source: home.packages.flatMap(packageSources) } } },
      message: `${home.dir} は宣言した SDK(${home.packages.join(" / ")})を値として import してよい(external.md の sdk_packages / 置き場の配置の土台の sdkPackages)。`,
    });
  }
  for (const row of table.clientUi) {
    const category = `sdk-client-ui:${row.file}`;
    categories.push({ category, pattern: row.file });
    policies.push({
      from: { file: { categories: category } },
      allow: { to: { module: { origin: "external", source: row.packages.flatMap(packageSources) } } },
      message: `${row.file} は自サイトの口を読む SDK の UI 部品(${row.packages.join(" / ")})だけを値として import してよい(external.md の client_ui)。`,
    });
  }
  return { categories, policies };
}
