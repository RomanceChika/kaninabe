/**
 * **配信されるコードが引ける Node の組み込みを閉じた表にする**(点検 14 回目 B14-3)。
 *
 * `no-module-state` を避けた次の手として、`node:fs` の一時ファイルは要求をまたいで値を持てる(温まった実行環境で別の利用者へ渡る)。製品の配信コードが使う組み込みは表のものだけなので、
 * 推測はせず表の外の全部の組み込みを赤にする(`node:` つき・なしの両方。静的 import・再 export・動的 `import()`・`require()`)。表は設定の `allow`(`node:` を除いた名前)。掛かる範囲は設定が決める(テストと支援コードは外す)。
 */

import { builtinModules } from "node:module";
import { moduleVisitors } from "./danger-helpers.mjs";

/** @type {import("eslint").Rule.RuleModule} */
export const nodeBuiltinClosed = {
  meta: {
    type: "problem",
    docs: { description: "配信されるコードが引ける Node の組み込みは閉じた表だけ" },
    schema: [{
      type: "object",
      properties: { allow: { type: "array", items: { type: "string" } } },
      required: ["allow"],
      additionalProperties: false,
    }],
    messages: {
      module: "`{{module}}` は配信されるコードから引けません(表: {{allowed}})。ファイルや環境は要求をまたいで値を持てます。要るなら設定の `allow` に理由つきで足す。",
    },
  },
  create(context) {
    const allowed = context.options[0]?.allow ?? [];
    const closed = new Set(builtinModules.filter((name) => !allowed.includes(name)));
    return moduleVisitors(context, closed, (node, module) => context.report({ node, messageId: "module", data: { module, allowed: allowed.join(" / ") } }));
  },
};
