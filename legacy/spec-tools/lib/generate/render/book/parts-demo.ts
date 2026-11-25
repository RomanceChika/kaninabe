/**
 * パーツ見本(living styleguide)のレンダラー。ハンドブック「デザイン」の章に、
 * 実装の UI 部品を**本物の CSS**(docs/book/assets/ へ写した globals.css / ui.module.css)で
 * 静的に再現して並べる。
 *
 * トークン表は「値」を、スクリーンショットは「実データ込みの画面」を見せるが、
 * その中間 — 「この値の組み合わせが、部品 1 つとしてどう見えるか」— はどちらにも無い。
 * この見本は実 CSS のクラスをそのまま使うため、実装のスタイルが変われば
 * (assets の再生成を経て)見本も同じに変わる。
 *
 * 各見本にはラベル(部品名と、使っているトークン名)を添える。トークン名は CSS から
 * 機械的に読み取ったもの(ui-css.ts)であり、この生成器が対応を発明することはない。
 * 状態バッジの「状態 → 意味色」だけは実装(state-badge.tsx)のソースから写す(tone-map.ts)。
 */

import { allMachines, type SpecModel, type StateMachineSpec } from '../../../model/types.js';
import { escapeHtml } from '../html.js';
import { cssClassInfo, type CssClassInfo } from './ui-css.js';
import { parseToneMap, type BadgeTone } from './tone-map.js';
import { demoSamples, type DemoSample } from './parts-demo-samples.js';
import type { BookInputs } from '../../../gen-kit/book-inputs.js';

/** 実装 CSS を読めていない環境での表記。 */
export const UNAVAILABLE =
  '実装の CSS(app/src/app/_styles/ui.module.css)を読めなかったため、パーツ見本を生成していません。';

/** 見本の前置き(定型)。 */
export const PARTS_DEMO_LEAD =
  '以下は実装の UI 部品を静的 HTML で再現した見本である。**CSS は本物**' +
  '(`app/src/app/globals.css` と `app/src/app/_styles/ui.module.css` を `.parts-demo` 配下へ' +
  'スコープして docs/book/assets/ に写したもの)なので、実装のスタイルが変われば見本も同じに変わる。' +
  '文言はすべて「◯◯の見本」の定型で、実データではない(実物の文言は画面カードのスクリーンショットで見る)。';

/** 見本の部品が使うトークン名の和集合(CSS から機械的に読んだもの。出現順)。 */
function sampleTokens(sample: DemoSample, info: Map<string, CssClassInfo>): string[] {
  const tokens: string[] = [];
  for (const name of sample.names) {
    const entry = info.get(name.replace(/^\./, ''));
    for (const token of entry?.tokens ?? []) if (!tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

/** パーツ見本の事実(HTML の本は舞台の HTML を出力の口の許可表に通して描く)。 */
export interface PartsDemoFacts {
  readonly lead: string;
  /** 見本ごとの見出し・舞台の HTML(生成器のコードの定数と、仕様の表示名を逃がしたもの)・部品名・使うトークン名。 */
  readonly samples: readonly { readonly title: string; readonly stage: string; readonly names: readonly string[]; readonly tokens: readonly string[] }[];
  /** 状態バッジの対応(状態機械ごとの、状態・表示名・意味色)。 */
  readonly badges: readonly { readonly machine: string; readonly states: readonly { readonly state: string; readonly label: string; readonly tone: BadgeTone }[] }[];
  /** 見本に未掲載の部品クラス。 */
  readonly uncovered: readonly string[];
}

/**
 * パーツ見本の事実を返す(`renderPartsDemo` と同じ入力・同じ母集合)。
 *
 * @returns 実装の CSS を読めていない環境では null
 */
export function partsDemoFacts(model: SpecModel, book: BookInputs | undefined): PartsDemoFacts | null {
  const uiCss = book?.uiCss;
  if (uiCss === undefined) return null;
  const info = cssClassInfo(`${book?.globalsCss ?? ''}\n${uiCss}`);
  const samples = demoSamples(badgeSample(model, book?.stateBadgeSource));
  const tones = book?.stateBadgeSource === undefined ? new Map<string, Readonly<Record<string, BadgeTone>>>() : parseToneMap(book.stateBadgeSource);
  return {
    lead: PARTS_DEMO_LEAD,
    samples: samples.map((sample) => ({ title: sample.title, stage: sample.stage.join('\n'), names: sample.names, tokens: sampleTokens(sample, info) })),
    badges: allMachines(model).map(({ machine }) => ({
      machine: machine.machine,
      states: machine.states.map((state) => ({ state, label: machine.stateLabels[state] ?? state, tone: tones.get(machine.machine)?.[state] ?? 'neutral' })),
    })),
    uncovered: uncoveredClasses(uiCss, samples),
  };
}

/** 見本に未掲載の部品クラスの注意(定型)。 */
export const UNCOVERED_LEAD = '見本に未掲載の部品クラス(実装にはあるが見本が追いついていない印):';

/** 状態バッジの見本(全状態機械の全状態。文言は仕様の label、色は実装の対応を写す)。 */
function badgeSample(model: SpecModel, stateBadgeSource: string | undefined): DemoSample {
  const tones =
    stateBadgeSource === undefined
      ? new Map<string, Readonly<Record<string, BadgeTone>>>()
      : parseToneMap(stateBadgeSource);
  const stage = allMachines(model).flatMap(({ machine }) => machineBadges(machine, tones));
  return {
    title: '状態バッジ(全状態機械の全状態。状態 → 意味色の対応の出典: app/src/app/_components/state-badge.tsx)',
    names: ['.badge', '.badgeInfo', '.badgePositive', '.badgeNeutral', '.badgeCritical'],
    stage: [`<div class="stack">`, ...stage, `</div>`],
  };
}

/** 状態機械 1 つぶんのバッジの行。 */
function machineBadges(
  machine: StateMachineSpec,
  tones: ReadonlyMap<string, Readonly<Record<string, BadgeTone>>>,
): string[] {
  const map = tones.get(machine.machine) ?? {};
  const badges = machine.states.map((state) => {
    // 実装(StateBadge)と同じフォールバック: 対応が無い状態は neutral、label が無い状態は ID のまま。
    const tone = map[state] ?? 'neutral';
    const label = machine.stateLabels[state] ?? state;
    const toneClass = `badge${tone.charAt(0).toUpperCase()}${tone.slice(1)}`;
    return `<span class="badge ${toneClass}" title="${escapeHtml(`${machine.machine}.${state} → ${tone}`)}">${escapeHtml(label)}</span>`;
  });
  return [
    `<div>`,
    `<p class="note">状態機械 ${escapeHtml(machine.machine)}</p>`,
    `<div class="bar">`,
    ...badges,
    `</div>`,
    `</div>`,
  ];
}

/** ui.module.css にあるのに、どの見本のマークアップにも現れないクラス。 */
function uncoveredClasses(uiCss: string, samples: readonly DemoSample[]): string[] {
  const used = new Set<string>();
  for (const sample of samples) {
    for (const line of sample.stage) {
      for (const match of line.matchAll(/class="([^"]+)"/g)) {
        for (const name of (match[1] ?? '').split(/\s+/)) used.add(name);
      }
    }
  }
  return [...cssClassInfo(uiCss).keys()].filter((name) => !used.has(name));
}
