/**
 * 認証基盤の操作(auth_spec の `platform_ops`。ADR-0019)から導く app 側の期待ファイル。`structure-usecase-expectations.ts` が保存点の期待を出すのと同型で、
 * 操作 1 つ = 入口(Server Action)1 本 + 組み立ての根 1 本(どちらも生成物)の期待を、置き場の配置の役割(`platform-op-entry` / `platform-op-composition`)から引く
 * (**製品の根からの相対** — 期待ファイル木は製品の根の外を知らない)。宣言の無い製品・実装の木を持たない製品は期待が無い。
 *
 * 入口と組み立ての根は `{層}/platform/{グループ}/{名前}.ts` の 2 階層(保存点の置き場と同じ形)なので、構造テストの「2 階層の置き場の閉世界」の母集合に
 * 保存点の期待と並べて載せる(`event` は操作 ID)。
 */

import type { GenerateContext } from '../../gen-kit/generator.js';
import { buildPlatformPlan } from './platform-ops-plan.js';
import { appPlacedPath } from './app-placement.js';
import type { SpecModel } from '../../model/types.js';
import { usecaseExpectations } from './structure-usecase-expectations.js';
import type { ExpectedFile } from './structure-usecase-expectations.js';

/**
 * 認証基盤の操作 → 入口と組み立ての根の期待(パス順ではなく、呼び手が並べる)。
 *
 * @param ctx 生成の文脈(auth_spec と置き場の配置)
 * @returns 期待ファイル
 */
export function platformOpExpectations(ctx: GenerateContext): ExpectedFile[] {
  if (ctx.roots.app === null) return [];
  const location = ctx.auth?.flow?.location;
  if (location === undefined) return [];
  const base = { app: '' };
  return buildPlatformPlan(ctx.auth).ops.flatMap((op): ExpectedFile[] => [
    { event: op.id, file: appPlacedPath(ctx.layout, base, { role: 'platform-op-entry', key: op.id, what: `認証基盤の操作 ${op.id} の Server Action`, location }), export: `${op.base}Action` },
    { event: op.id, file: appPlacedPath(ctx.layout, base, { role: 'platform-op-composition', key: op.id, what: `認証基盤の操作 ${op.id} の組み立ての根`, location }), export: op.base },
  ]);
}

/**
 * 2 階層(`{層}/{グループ}/{名前}.ts`)の生成物の置き場の期待 —— 保存点と認証基盤の操作を同じ母集合に並べる(構造テストの 2 階層の置き場の閉世界・空の置き場の判定が読む)。
 *
 * @param model ドメイン仕様モデル(保存点の接地に使う)
 * @param ctx 生成の文脈
 * @returns 期待ファイル(パス順)
 */
export function twoLevelExpectations(model: SpecModel, ctx: GenerateContext): ExpectedFile[] {
  return [...usecaseExpectations(model, ctx), ...platformOpExpectations(ctx)].sort((a, b) => a.file.localeCompare(b.file));
}
