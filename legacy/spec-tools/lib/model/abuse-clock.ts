/**
 * 未ログインの作成の天井が**数える時刻の欄**の契約と選び方(R5-2 と生成器が共有する 1 本)。
 *
 * 天井は「期間の中にある行の数」を、行の日時の欄で切って数える。その欄が嘘をつけると数えをすり抜けられるので、
 * 欄は datetime で、**行で必ず値があり(NOT NULL)・DB が作成時に埋め(既定値 now())・作成の入力にも後の更新・遷移にも現れない**こと。
 * 仕様の上では `auto: true` の datetime 欄がこの 3 つを一度に満たす(それ以外は、空にできる・入力で過去や未来の時刻を入れられる・
 * 既定値が無い、のどれかで数えをすり抜けられる)。`at` を省略すると `auto: true` の datetime 欄がちょうど 1 つのときだけその欄になる。
 *
 * **欄の選び方の判定はここの 1 本である** —— 検査(`risk/verifiers/r5-abuse.ts`)も生成器(`model/data/ceiling-plan.ts`)も
 * この関数を呼ぶ。2 か所に書くと、検査が通したのに生成器が別の欄を数える(または支えられない)宣言が作れてしまう。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { AbuseWindow, AggregateSpecs } from './types.js';
import { writtenByDeclaration } from './written-after-create.js';

/** 時刻の欄を決めた結果(決まらなければ理由の並び)。 */
export type ClockResult =
  | { readonly ok: true; readonly column: string }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * 欄が編集・遷移で書き換えられる宣言を持つか(持てば数えを動かせる。定義の本体は `written-after-create.ts`。更新で発火する供給と `set_null` を
 * 数えない理由 —— 天井の約束は「未ログインの作成者が自分で数えを外せない」で、その 2 つは別の宣言の書き込みが起こす —— も同じ冒頭)。時刻の欄と鍵の欄(per_key)の両方に使う —— トリガは挿入の
 * 時にだけ数えるので、後から書き換えられる欄では数えの前提が崩れる(外部レビュー: 別々の鍵で作ってから同じ鍵へ更新)。
 *
 * @param column 欄
 * @param specs 集約の仕様
 * @param what 指摘の中の欄の呼び名
 * @returns 指摘(無ければ空)
 */
export function writtenProblems(column: string, specs: AggregateSpecs, what = '期間を切る欄'): string[] {
  return writtenByDeclaration(column, specs) ? [`${what} ${column} が編集・遷移の宣言で書き換えられます(数えを動かせます。生成器はこの宣言を支えられません)`] : [];
}

/**
 * 天井が数える時刻の欄を決める。
 *
 * @param at `abuse.at`(省略可)
 * @param specs 集約の仕様(欄・編集・遷移の宣言を引く)
 * @returns 決まった欄、または決まらない理由
 */
export function clockOf(at: string | undefined, specs: AggregateSpecs): ClockResult {
  const fields = specs.entity?.fields ?? [];
  const candidates = fields.filter((field) => field.type.kind === 'datetime' && field.auto);
  const column = at ?? (candidates.length === 1 ? candidates[0]?.name : undefined);
  if (at === undefined && column === undefined) {
    return {
      ok: false,
      problems: [`at が省略されていますが、auto: true の日時の欄がちょうど 1 つではありません(${candidates.length} 個)ので、期間を切る欄が決まりません`],
    };
  }
  if (column === undefined) return { ok: false, problems: [] };
  if (at !== undefined) {
    const target = fields.find((field) => field.name === at);
    if (target === undefined) return { ok: false, problems: [`at="${at}" は集約の欄にありません`] };
    if (target.type.kind !== 'datetime') return { ok: false, problems: [`at="${at}" は日時(datetime)の欄ではありません`] };
    if (!target.auto) {
      const why = [
        target.required ? null : '空にできる',
        '作成の入力で時刻を書ける',
        '作成時の既定値(now())が無い',
      ].filter((item): item is string => item !== null);
      return { ok: false, problems: [`at="${at}" は auto: true の日時の欄ではありません(${why.join('・')}ので、数えをすり抜けられます。生成器はこの宣言を支えられません)`] };
    }
  }
  const written = writtenProblems(column, specs);
  return written.length > 0 ? { ok: false, problems: written } : { ok: true, column };
}

/** 時刻の欄の契約の指摘(R5-2 が使う。決まれば空)。 */
export function clockProblems(at: string | undefined, specs: AggregateSpecs): readonly string[] {
  const result = clockOf(at, specs);
  return result.ok ? [] : result.problems;
}

/** 期間の幅の字面(読み込みの `PERIOD` と同じ閉じた語。モデルを直接組むテストと将来の別経路の保険。R5-2 と生成器の判定が共有する)。 */
const PERIOD = /^[1-9]\d{0,5} (?:minute|hour|day)s?$/;

/** 期間の幅の単位ごとの分(上限の判定に使う)。 */
const UNIT_MINUTES: Readonly<Record<string, number>> = { minute: 1, hour: 60, day: 1440 };

/** 天井の max の上限(生成する SQL の整数の字句で表せる範囲。PostgreSQL の integer の上限)。 */
const MAX_CEILING = 2147483647;

/** 期間の幅の上限(366 日。これを超える幅は「天井」でなく無制限と同じ)。 */
const MAX_PERIOD_MINUTES = 366 * 1440;

/** `abuse` の天井 1 つの形の指摘(無ければ空)。 */
export function windowProblems(what: string, window: AbuseWindow): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(window.max) || window.max < 1) problems.push(`${what}.max=${String(window.max)} は 1 以上の整数ではありません`);
  else if (window.max > MAX_CEILING) problems.push(`${what}.max=${String(window.max)} は ${MAX_CEILING} を超えます(生成器が SQL の整数として書けません)`);
  if (!PERIOD.test(window.per)) {
    problems.push(`${what}.per="${window.per}" は "{n} {minute|hour|day}" の形ではありません`);
    return problems;
  }
  const [count, unit] = window.per.split(' ');
  const minutes = Number(count) * (UNIT_MINUTES[(unit ?? '').replace(/s$/, '')] ?? Infinity);
  if (minutes > MAX_PERIOD_MINUTES) problems.push(`${what}.per="${window.per}" は 366 日を超えます(幅が大きすぎる天井は無制限と同じです)`);
  return problems;
}

