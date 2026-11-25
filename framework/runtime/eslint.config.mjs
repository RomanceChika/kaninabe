/**
 * このパッケージの lint 設定。
 *
 * **規則は 1 行も書かない** —— 正は `@kaninabe/lint-config` の `frameworkSourceConfig()` であり、
 * ここはそれを自分のディレクトリに当てるだけの入口である。フラット config が config ファイルの
 * あるディレクトリの外を lint しないので、パッケージごとに 1 枚要る（設計メモ
 * `docs/design/runtime-package.md` §9-3）。
 */

import { frameworkSourceConfig } from "@kaninabe/lint-config/framework-source";

// 置き場(`import.meta.url`)を渡す: 転送の規則の例外は、このパッケージの行だけに当たる(点検 10 回目 B10-6)。
export default frameworkSourceConfig(import.meta.url);
