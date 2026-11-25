/**
 * UX 経験則の検査(U 群)の入力と閾値。
 *
 * チェック内容の正: docs/rules/process/frontend/specification/standards/ux-lint.md
 *
 * U 群が S 群と決定的に違うのは**指摘がすべて warning** であることだ。S 群が問うのは
 * 「仕様どうしが食い違っていないか」という真偽の決まる問いだが、U 群が問うのは
 * 「その UI は使いやすいか」という**正解が一意でない**問いであり、機械が言えるのは
 * 「経験則から外れている」までである。外れていること自体が正しい設計でありうるので、
 * 判断は人間に残し、受け入れたときは理由を画面の `ux:` に書く。
 */

import type { SpecModel } from '../types.js';
import type { ScreenSpecModel } from '../screen/types.js';
import type { Finding } from '../../kernel/finding.js';

/**
 * 1 つの状態で同時に並べてよい操作の数(U4)。
 *
 * 根拠は Hick の法則(選択肢が増えるほど決定時間が伸びる)とミラーの 7±2(短期記憶の幅)で、
 * **7 という数そのものに理論的な必然性は無い**。ここは「プロジェクトごとに変えてよい定数」であり、
 * 業務用の管理画面のように操作の一覧性が価値になる製品では上げてよい(ux-lint.md §閾値)。
 */
export const MAX_SIMULTANEOUS_ACTIONS = 7;

/**
 * 1 つの状態で同時に編集できるフィールドの数(U5)。
 *
 * 根拠と可変性は MAX_SIMULTANEOUS_ACTIONS と同じ。フォームの長さは離脱率に効く古典的な指標だが、
 * 「長いフォームを分割すべきか」は業務の性質で変わるため、超過は警告に留める。
 */
export const MAX_WRITABLE_FIELDS = 7;

/** UX 検証器(U1〜U5)への唯一の入力。 */
export interface UxInput {
  /** ドメイン仕様全体(終端状態・物理削除・遷移表・編集可能フィールドの正)。 */
  readonly domain: SpecModel;
  /** 画面仕様(chrome 展開済み)。`available: false` なら U 群は何も見ない。 */
  readonly screens: ScreenSpecModel;
}

/**
 * U4 / U5 の閾値(超えたときだけ指摘する。閾値ちょうどは指摘しない)。
 *
 * 値は UX 原則の台帳(ux-principles.md の `budget`)から引く(`lib/ux-principles/limits.ts`)。
 * 台帳が無いときの既定値が上の 2 つの定数である。
 */
export interface UxLimits {
  /** 1 つの状態で同時に並べてよい操作の数(U4)。 */
  readonly maxSimultaneousActions: number;
  /** 1 つの状態で同時に編集できるフィールドの数(U5)。 */
  readonly maxWritableFields: number;
}

/** 台帳が無いときの閾値(定数をそのまま束ねたもの)。 */
export const DEFAULT_UX_LIMITS: UxLimits = {
  maxSimultaneousActions: MAX_SIMULTANEOUS_ACTIONS,
  maxWritableFields: MAX_WRITABLE_FIELDS,
};

/**
 * UX 検査の指摘 1 件。
 *
 * Finding に `check` と `screens` と `subject` を添えた形にしてあるのは、**受け入れ(`ux:`)の突合を
 * 検証器から外に出す**ためである。受け入れの照合と用済み宣言の検出は run.ts が 1 箇所で行い、
 * 各検証器は「経験則から外れているか」だけを見る純粋関数のままでいられる。
 */
export interface UxIssue {
  /** 検査 ID(`U1` 〜 `U5`)。受け入れの `principle` と突き合わせる。 */
  readonly check: string;
  /**
   * この指摘を受け入れられる画面の id。ほとんどの指摘は 1 画面のものだが、画面をまたぐ指摘(U2)は
   * 食い違う語を出している画面すべてが入り、どれか 1 つの画面の `ux:` で受け入れられる。
   */
  readonly screens: readonly string[];
  /**
   * 受け入れの突合キーの 1 つ。`screen-{name}/` の接頭辞を除いた部分(画面そのものへの指摘は空文字)で、
   * `ux:` の `subject` に書く文字列そのもの。指摘の `counterexample.subject` にも出る(書き写せる形にするため)。
   */
  readonly subject: string;
  readonly finding: Finding;
}
