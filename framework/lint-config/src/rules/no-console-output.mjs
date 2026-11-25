/**
 * `console` を製品の実行コードから直接使わせない(ASVS V13.4.2。本番でデバッグの機能を止める)。
 *
 * 出力の口は**ロガーだけ**にする(構造化した 1 行 JSON を出す `ConsoleLogger` と、セキュリティログの出力器)。
 * 設定側は、その**ロガー自身の置き場の 2 本だけ**を `console` の使用から外す(理由つき。ほかに免除の口は無い)。
 * 止めるもの: `console.log` / `console.error` などの全メンバ・`console` を値として渡す形・`window.console` / `globalThis['console']`・
 * `const c = console` の別名・分割代入の取り出し(`const { log } = console` は `console` の参照として止まる。
 * `const { console: c } = window` も止める)。型の位置(`typeof console`)は対象外。束縛で見る(自前の `console` は対象外)。
 * `debugger` 文は ESLint 本体の `no-debugger` が止める(設定側で併せて掛ける)。
 * **下限として残る形**: `process.stdout.write` / `process.stderr.write`・計算した鍵(`globalThis[key]`)。
 */

import { globalNameVisitors } from "./danger-helpers.mjs";

/** 対象のグローバル。 */
const NAMES = new Set(["console"]);

/** @type {import("eslint").Rule.RuleModule} */
export const noConsoleOutput = {
  meta: {
    type: "problem",
    docs: { description: "console を直接使わせない(出力はロガーだけ)。ASVS V13.4.2" },
    schema: [],
    messages: {
      console: "`console` を直接使わない(本番に残るデバッグ出力になる。ASVS V13.4.2)。出力はロガー(構造化した 1 行 JSON を出す口)を通す。",
      destructure: "`globalThis` / `window` / `self` から `console` を分割代入で取り出さない(取り出した名前は検査から外れる)。",
    },
  },
  create(context) {
    return globalNameVisitors(context, NAMES, (node, _name, via) => {
      context.report({ node, messageId: via === "destructure" ? "destructure" : "console" });
    });
  },
};
