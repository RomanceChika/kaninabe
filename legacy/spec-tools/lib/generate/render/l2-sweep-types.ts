/**
 * L2 網羅スイープ(docs/book/sweep.md)の行モデル。
 *
 * BACKLOG「E2E拡張束 — 4層テスト戦略」の L2(網羅スイープ)を「生成物」として実装したもの。
 * L2 は「一通り試すとは何か」の母集合を仕様から機械的に導き、各行に既存の突合
 * (action_spec / screen_spec / query_spec / notification_spec / job_spec の
 * `test_cases`)から証拠を充てるだけの**台帳**である。**この章は判定しない**(赤くしない)
 * — verify のどの検査もこの母集合を使って合否を出さない。5 種類の行組み立て
 * (l2-sweep-transitions.ts 等)が返す行はすべてこの形に揃える。
 */

import { cell } from '../../gen-kit/state-machine-table.js';

/**
 * 行の属するグループ(BACKLOG の①〜⑤にそのまま対応)。
 *
 * `状態` は S13〜S15(状態×ロール・画面の全域性)の追加にあわせた 6 グループ目。
 * 状態遷移の行が「遷移それ自体」を主語にするのに対し、こちらは state_spec の**状態**を
 * 主語にする ── 遷移とは主語も列(「到達」「着地」でなく「可視性」)も異なるため、
 * 既存グループへ相乗りさせず独立させた。
 */
export type L2Section = '状態遷移' | '状態' | '画面 × 操作' | '読み取り経路' | '通知' | 'ジョブ';

/**
 * 証拠の由来。通知・ジョブの行(帰属規則。束⑪a)だけが持つ区別で、他の行(状態遷移・
 * 画面 × 操作・読み取り経路)は常に `undefined`(区別しない)。
 *
 * - `derived` … state_spec の `effects` から辿った遷移の action_spec の成功ケース
 * - `direct`  … その通知・ジョブ自身の ID を `spec_ids` に挙げる test_cases(カタログ
 *   全体の整合を確かめる test_cases もここに含める —— 個別の遷移から辿ったものではない、
 *   という意味で「導出ではない」側にまとめる)
 */
export type L2EvidenceOrigin = 'derived' | 'direct';

/** 「この行を確かめている」テストケース 1 件(表示に使う最小限だけを持つ)。 */
export interface L2Evidence {
  /** テストケース ID(`TC-...`)。 */
  readonly id: string;
  /** `implementation` の書かれたままの文字列(`{パス}::{テスト名}`)。 */
  readonly implementation: string;
  /** 証拠の由来(通知・ジョブの行だけが持つ。他の行は undefined)。 */
  readonly origin?: L2EvidenceOrigin;
}

/** L2 網羅台帳の 1 行。 */
export interface L2Row {
  readonly section: L2Section;
  /** 何についての行か(遷移 ID / `画面 id × 操作 ID` / `クエリ id × ロール` / 通知 ID / ジョブ ID)。 */
  readonly subject: string;
  /** この行が確かめる観点(成立・不成立の種別・実行ロール・trigger・source)。 */
  readonly aspect: string;
  /** 読み手の手がかり(遷移の from→to、画面のルート、クエリの scope、通知・ジョブの概要)。 */
  readonly detail: string;
  /** この行を確かめているテストケース(既存の突合から機械的に埋める。0 件もありうる)。 */
  readonly evidence: readonly L2Evidence[];
  /**
   * グループ固有の追加列(任意。今のところ「状態遷移」の「到達」「着地」・「状態」の「可視性」)。
   * ラベルは `sweep-page.ts` の `EXTRA_HEADERS` が持ち、ここは値だけを順番どおりに並べる
   * (この章は**判定しない**ため、値は事実の記述であって合否ではない ── S13〜S15 が判定する側)。
   */
  readonly extra?: readonly string[];
}

/**
 * `ActionTestCase` 系(action_spec / screen_spec / query_spec / notification_spec / job_spec で共通の形)から証拠 1 件を作る。
 *
 * @param tc 証拠にするテストケース宣言
 * @param origin 証拠の由来(通知・ジョブの行の呼び出しだけが渡す。他の行は省略 = undefined)
 */
export function toEvidence(
  tc: { readonly id: string; readonly implementation: { readonly raw: string } },
  origin?: L2EvidenceOrigin,
): L2Evidence {
  return { id: tc.id, implementation: tc.implementation.raw, ...(origin === undefined ? {} : { origin }) };
}

/**
 * 証拠の一覧を表のセルにする(0 件は EMPTY_CELL)。
 *
 * `origin` を持つ証拠(通知・ジョブの行)は ID の後ろに `(導出)` / `(直接)` を添える —
 * 「どの遷移から」導いた証拠か、そのジョブ・通知自身の直接のテストケースかを読み手が区別できるようにする
 * (帰属規則。束⑪a)。
 */
export function evidenceCell(evidence: readonly L2Evidence[]): string {
  return cell(evidence.map((e) => e.id + originSuffix(e.origin)).join(', '));
}

/** origin の表示用サフィックス(無ければ空文字)。 */
function originSuffix(origin: L2EvidenceOrigin | undefined): string {
  if (origin === undefined) return '';
  return origin === 'derived' ? '(導出)' : '(直接)';
}
