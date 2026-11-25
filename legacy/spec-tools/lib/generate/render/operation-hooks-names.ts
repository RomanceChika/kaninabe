/**
 * 単発の操作の **hooks**(application 執行の不変条件のチェック)の名前。
 *
 * hooks は「操作の実装で手書きしてよい唯一の場所」であり(束 ⑰ 設計 §3)、生成 Composition Root が
 * 名指しで import する。名前の規約が生成器と閉世界で 1 つであるよう、ここに 1 か所だけ持つ。
 * **hooks は「生成物ではないものの名前」**なので、生成物の名前を持つ `operation-app-names.ts` とは
 * 別のファイルにしてある(生成物の名前と手書きの名前を同じファイルに混ぜない)。
 */

import { toCamelCase, toPascalCase } from '../../gen-kit/code-emit.js';
import { splitOperation } from './operation-app-names.js';

// 手書きの hooks のモジュール指定子は置き場の配置の役割 `operation-hooks` が決める(`body-modules.ts` の `operationHooks`)。ここが持つのは export 名だけ。

/** 手書きの hooks の export 名(`{camel(イベント)}{Pascal(集約)}Hooks`)。 */
export function hooksExportOf(op: string): string {
  const { aggregate, event } = splitOperation(op);
  return `${toCamelCase(event)}${toPascalCase(aggregate)}Hooks`;
}
