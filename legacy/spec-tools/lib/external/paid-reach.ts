/**
 * 有料の口の検査(X8)が使う **import の閉包の道具**: 入口が有料の連携のアダプタに届くか・閉包が欠けているか(字句でない指定子と、
 * 素の指定子の許可表の外。点検 6 回目 B6-1・7 回目 B7-2)・口が import する指定子が有料の連携 / meter の RPC に届くか。
 *
 * 閉包の解決は C24 の鮮度の hash と同じ部品(`semantics/import-closure.ts`)で、素の指定子の許可表は製品の `package.json` の依存と
 * `node:` の組み込み(`semantics/bare-specifiers.ts`)。ファイルの読み取りはリポジトリルートの実ファイル。
 */

import path from 'node:path';
import { tryReadText } from '../io/read-text.js';
import type { OutboundIntegrationDecl } from '../model/external/types.js';
import { sourceAliasOf } from '../model/product/layout.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import { dependencyNamesOf, isListedBareSpecifier } from '../semantics/bare-specifiers.js';
import { computeClosure } from '../semantics/import-closure.js';
import type { SourceReader } from '../semantics/import-closure.js';
import { sourceCallsRpc } from './rpc-call-scan.js';

/** 閉包の道具の入力。 */
export interface ReachInput {
  readonly repoRoot: string;
  readonly roots: ProductRoots;
  readonly layout: ProductLayout;
}

/**
 * 閉包を求める道具を作る(ファイル 1 本ごとに、指定子ごとの分類を使い回す)。
 *
 * @param input リポジトリルート・製品の根・配置
 * @param adapters 有料の連携のアダプタのパス → 連携
 * @returns 読む口・届く連携・閉包の欠け・指定子の分類
 */
export function paidReachOf(input: ReachInput, adapters: ReadonlyMap<string, OutboundIntegrationDecl>) {
  const read: SourceReader = (relative) => tryReadText(path.join(input.repoRoot, relative));
  const alias = sourceAliasOf(input.layout, input.roots);
  // 素の指定子の許可表(製品の package.json の依存と node: の組み込み)。表の外は閉包の欠け(点検 7 回目 B7-2)。
  const dependencies = dependencyNamesOf(input.roots.app === null ? null : read(path.posix.join(input.roots.app, 'package.json')));
  const bare = (specifier: string): boolean => isListedBareSpecifier(specifier, dependencies);
  return {
    read,
    /** この口が有料の連携のアダプタに届くなら、その連携(複数に届けば全部)。 */
    reached: (route: string) => {
      const closure = computeClosure(route, read, alias, undefined, bare);
      return closure === null ? [] : [...new Set(closure.files.flatMap((file) => adapters.get(file.path) ?? []))];
    },
    /**
     * この入口の閉包の中の、指定子が字句でない import(行き先が字面から決まらない。点検 6 回目 B6-1)と、素の指定子の許可表の外の import
     * (`#…` などの束ねる道具が自分のソースに解く綴り。7 回目 B7-2)。
     * 1 本でもあれば「届かない」は言えない —— 閉包が欠けているので、届くかどうかで判定する指摘を信じず別に赤にする(fail-closed)。
     */
    opaque: (entry: string) => (computeClosure(entry, read, alias, undefined, bare)?.unresolved ?? []).filter((item) => item.opaque === true || item.unlisted === true),
    /** 指定子の分類(口が import する先が、有料の連携に届くか・meter の RPC を呼ぶか)。 */
    classOf: (route: string, meter: string) => (specifier: string) => {
      const closure = computeClosure(route, read, alias, new Set([specifier]), bare);
      const files = closure?.files ?? [];
      return {
        paid: files.some((file) => adapters.has(file.path)),
        meter: files.some((file) => file.path !== route && sourceCallsRpc(file.path, read(file.path) ?? '', meter)),
      };
    },
  };
}

