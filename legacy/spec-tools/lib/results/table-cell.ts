/**
 * 結果表の**1 マスと凡例**(束 ⑳-5b)。
 *
 * 1 マスには複数の組み合わせが畳まれている —— 行(実行者)と列(状態 / 手順)を決めても、
 * ガード変数の軸が残るからである。畳んだ結果が全部同じなら印 1 つで足りるが、**分かれたら
 * そこが境界である**: 「締切前は通る / 締切後は落ちる」がまさに人が読みたいことなので、
 * 分かれたときは**どの値でどちらになったか**をマスの中に書く。
 *
 * 拒否の理由の中身(許されるロール・成立しなかった条件の日本語・仕様が書いた禁止の理由)は
 * **凡例**に出す。マスに全文を入れると同じ文が何十マスにも並び、表として読めなくなる ——
 * マスに出るのは番号つきの ❌ だけで、番号の説明は表の下に 1 回だけ並ぶ。
 *
 * 純関数(凡例だけは 1 つの表のあいだ番号を覚える)であり throw しない。
 * **アプリの語彙は 1 語も持たない。**
 */

import { RESULT_ABSENT, RESULT_ALLOWED, RESULT_REFUSED, RESULT_WORDS } from '../messages/messages-results.js';
import type { ResultDecision } from './decide.js';
import type { ResultAxisValue } from './cases.js';

/** マスに畳まれる組み合わせ 1 つ。 */
export interface CellCase {
  readonly axis: readonly ResultAxisValue[];
  readonly decision: ResultDecision;
  /** 判定に届かなかった(保存点の後ろの手順)。 */
  readonly notReached?: boolean;
}

/** 表の語(仕様の label と、ガード式の日本語訳)。 */
export interface ResultLabels {
  /** ロール ID → `id(label)`。 */
  readonly role: (id: string) => string;
  /** 状態 ID → `id(label)`。 */
  readonly state: (id: string) => string;
  /** 欄名 → `name(label)`。 */
  readonly field: (name: string) => string;
  /** ガード式の原文 → 日本語訳。 */
  readonly guard: (source: string) => string;
}

/** 1 つの表のあいだ、拒否の理由に番号を振る帳面。 */
export interface ResultLegend {
  /** その拒否に対応する印(`❌1` など)。 */
  readonly markOf: (decision: ResultDecision) => string;
  /** 凡例の行(番号順)。 */
  readonly lines: () => readonly string[];
  /**
   * 凡例の**文面**(番号順・重複なし)。
   *
   * 章ぜんたいの判断ポイントを数えるときは、表ごとの本数ではなくこちらの**集合**を取る ——
   * 同じ宣言から出た同じ理由を何マス・何表に並べても、人がする判断は 1 つである
   * (独立レビュー ⑳-5b 観点 5b)。
   */
  readonly texts: () => readonly string[];
}

/**
 * 拒否の理由の帳面を開く(表 1 つにつき 1 冊)。
 *
 * @param labels 表の語
 * @returns 番号を振る帳面
 */
export function openLegend(labels: ResultLabels): ResultLegend {
  const order: string[] = [];
  const texts = new Map<string, string>();
  return {
    markOf: (decision: ResultDecision): string => {
      const text = reasonText(decision, labels);
      if (!texts.has(text)) {
        texts.set(text, text);
        order.push(text);
      }
      return `${RESULT_REFUSED}${order.indexOf(text) + 1}`;
    },
    lines: (): readonly string[] =>
      order.map((text, index) => `- ${RESULT_REFUSED}${index + 1} — ${text}`),
    texts: (): readonly string[] => [...order],
  };
}

/**
 * 拒否 1 つの説明(engine が返した診断そのものから組む)。
 *
 * @param decision engine の拒否
 * @param labels 表の語
 * @returns 凡例に出る一文
 */
export function reasonText(decision: ResultDecision, labels: ResultLabels): string {
  const head = RESULT_WORDS.reasons[decision.reason] ?? RESULT_WORDS.unmappedReason;
  const notes: string[] = [];
  if (decision.allowedRoles.length > 0) {
    // 同じ役が 2 度並ぶことがある —— 1 つの欄に同じ役の規則が 2 本あると engine の
    // `allowedRoles` に 2 回入る(規則の本数は読み手の判断には効かない)。
    notes.push(RESULT_WORDS.allowedRoles([...new Set(decision.allowedRoles.map(labels.role))].join(' / ')));
  }
  if (decision.guardSource !== null) notes.push(RESULT_WORDS.guardNote(labels.guard(decision.guardSource)));
  if (decision.otherwiseForbidden !== null) notes.push(decision.otherwiseForbidden);
  return notes.length === 0 ? head : `${head}(${notes.join('・')})`;
}

/**
 * マス 1 つの字面。
 *
 * @param cases そのマスに畳まれた組み合わせ(1 つも無ければ列挙に無いマス)
 * @param legend 拒否の理由の帳面
 * @returns マスの字面
 */
export function cellText(cases: readonly CellCase[], legend: ResultLegend): string {
  if (cases.length === 0) return RESULT_ABSENT;
  const groups = groupByOutcome(cases, legend);
  if (groups.length === 1) return groups[0]?.mark ?? RESULT_ABSENT;
  const shown = shownAxes(groups, varyingAxes(cases));
  return groups.map((group) => `${group.mark}${axisNote(group.cases, shown)}`).join(' / ');
}

/** 同じ結末の組み合わせをまとめたもの。 */
interface OutcomeGroup {
  readonly mark: string;
  readonly cases: readonly CellCase[];
}

/** 結末ごとにまとめる(通った側が先)。 */
function groupByOutcome(cases: readonly CellCase[], legend: ResultLegend): readonly OutcomeGroup[] {
  const groups = new Map<string, CellCase[]>();
  for (const found of cases) {
    const mark = markOf(found, legend);
    groups.set(mark, [...(groups.get(mark) ?? []), found]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => order(left) - order(right) || left.localeCompare(right))
    .map(([mark, found]) => ({ mark, cases: found }));
}

/** 通った印を先に、届かなかった印を最後に。 */
function order(mark: string): number {
  if (mark === RESULT_ALLOWED) return 0;
  return mark === RESULT_WORDS.notReached ? 2 : 1;
}

/** 組み合わせ 1 つの印。 */
function markOf(found: CellCase, legend: ResultLegend): string {
  if (found.notReached === true) return RESULT_WORDS.notReached;
  return found.decision.allowed ? RESULT_ALLOWED : legend.markOf(found.decision);
}

/** そのマスの中で値が分かれている軸(分かれていない軸は注記に出さない)。 */
function varyingAxes(cases: readonly CellCase[]): readonly string[] {
  const keys = cases[0]?.axis.map((axis) => axis.key) ?? [];
  return keys.filter((key) => new Set(labelsOf(cases, key)).size > 1);
}

/** その軸の値の並び。 */
function labelsOf(cases: readonly CellCase[], key: string): readonly string[] {
  return cases.map((found) => found.axis.find((axis) => axis.key === key)?.label ?? '');
}

/** 表示する値の上限(これを超えたら省略の印を足す)。 */
const MAX_LABELS = 2;

/**
 * 注記に出す軸。
 *
 * **結末を分けている軸だけを出す。** 分かれている軸を全部並べると、どの値が効いているのか
 * 読めない注記になる(実測: 6 手順 × 2 軸の保存点で 1 マスが 400 字を超えた)。ある軸が
 * 結末を分けているとは、**どの 2 つの結末のあいだでも値の集合が交わらない**ことである ——
 * 交わる軸はその結末の原因ではないので、名前を出しても読む人の助けにならない。
 *
 * 1 本も見つからないときは分かれている軸を全部出す(そのときは組み合わせで決まっている)。
 */
function shownAxes(groups: readonly OutcomeGroup[], varying: readonly string[]): readonly string[] {
  const separating = varying.filter((key) => separates(groups, key));
  return separating.length > 0 ? separating : varying;
}

/** その軸がどの 2 つの結末のあいだでも値の集合を分けているか。 */
function separates(groups: readonly OutcomeGroup[], key: string): boolean {
  const sets = groups.map((group) => new Set(labelsOf(group.cases, key)));
  return sets.every((set, index) =>
    sets.every((other, candidate) => candidate === index || [...set].every((label) => !other.has(label))),
  );
}

/** その結末になった軸の値の注記(結末を分けている軸だけ)。 */
function axisNote(cases: readonly CellCase[], shown: readonly string[]): string {
  const parts = shown.map((key) => {
    const labels = [...new Set(labelsOf(cases, key))].map(shortLabel);
    const head = labels.slice(0, MAX_LABELS).join('|');
    return `${key}=${labels.length > MAX_LABELS ? `${head}…` : head}`;
  });
  return parts.length === 0 ? '' : RESULT_WORDS.axisNote(parts.join(' '));
}

/**
 * 注記に出す値の字面(日の境目だけの日時は日付に縮める)。
 *
 * 縮めるのは注記だけである —— 畳む前の全列挙(json)は置いた値そのままを持つので、辿るときに
 * 困らない。
 */
function shortLabel(label: string): string {
  return label.replace(/T00:00:00\.000Z$/, '');
}
