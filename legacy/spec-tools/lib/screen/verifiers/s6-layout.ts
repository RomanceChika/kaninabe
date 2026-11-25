/**
 * S6 レイアウトのチェック。
 *
 * screen-spec-writing.md の S6:「スロット名が値域(header / body.left / body.center /
 * body.right / footer)に入り、コンポーネント名が snake_case で、1 つのスロットの中で
 * 部品名が重複せず、1 画面の中で重ね表示の id が重複せず、スロットが 1 つも無い layout を書かない」。
 *
 * スロットを値域にするのは、スロットパスが**そのまま testid の骨格**(`{name}.body.center.{部品}`)に
 * なるからである。語彙が開いていると画面ごとに骨格が変わり、「見た目を変えてもテストが壊れない」
 * という性質が成り立たなくなる。中身をどう作るかは自由で、縛るのは骨格だけである。
 * 同じ理由で、1 スロット内の部品名の重複もエラーにする(testid が 2 つの物を指してしまう)。
 *
 * 排他表示(`variants:`)の部品は**同じスロットの部品**として扱う。したがって部品名の一意性も
 * ここで一緒に見る(排他だからといって同じ名前を 2 つ置けるわけではない — testid のパスに
 * 状態名は現れないので、名前が同じなら排他であっても 2 つの物を指してしまう)。状態名の側は
 * 自由語彙だが、形(snake_case)とグループ内の一意性だけを見る。
 *
 * **chrome と画面のスロットは衝突しない。** chrome は外枠で、画面の layout はその内側に入る
 * (Next.js の layout.tsx の入れ子と同型)。testid の名前空間も別で、chrome の部品は
 * `{chrome_name}.{スロット}.{部品}`、画面の部品は `{screen_name}.{スロット}.{部品}` になる。
 */

import type { Finding, ScreenVerifier } from '../verifier.js';
import { screenFinding } from '../verifier.js';
import type { ScreenInput, ScreenLayout } from '../../model/screen/types.js';

/** スロット名の値域。3×3(header / body の左中右 / footer)。 */
const SLOTS: readonly string[] = ['header', 'body.left', 'body.center', 'body.right', 'footer'];

/** コンポーネント名・重ね表示の id(snake_case)。 */
const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

/**
 * 部品名に使えない予約語。
 *
 * `variants:` はスロットの要素として現れた時点で常に排他グループの宣言として読まれるため
 * (lib/model/screen/parse-layout.ts)、この名前の部品は「置いたつもりの宣言が別の意味に読まれる」
 * 状態にしかならない。文字列としてなら書けてしまうので、ここでエラーにする。
 */
const RESERVED_COMPONENT_NAMES: readonly string[] = ['variants'];

/** S6: レイアウトの語彙・部品名・重複を検証する。 */
export const layoutVerifier: ScreenVerifier = {
  id: 'S6',
  title: 'レイアウト — スロットが値域で、部品名が snake_case かつ重複しない',

  verify(input: ScreenInput): Finding[] {
    const findings: Finding[] = [];
    for (const chrome of input.screens.chromes) {
      findings.push(...checkLayout(chrome.layout, `chrome ${chrome.name}`));
    }
    for (const screen of input.screens.screens) {
      findings.push(...checkLayout(screen.layout, `画面 ${screen.name}`));
      findings.push(...checkOverlayIds(screen));
      for (const overlay of screen.overlays) {
        findings.push(...checkLayout(overlay.layout, `画面 ${screen.name} の重ね表示 ${overlay.id}`));
      }
    }
    return findings;
  },
};

/** 1 つのレイアウトのスロット語彙・部品名・空宣言を見る。 */
function checkLayout(layout: ScreenLayout, subject: string): Finding[] {
  // 宣言そのものが無い場合は S0 がエラーにしている(1 つの書き忘れに 2 つのエラーを出さない)。
  if (!layout.declared) return [];
  if (layout.slots.length === 0) return [emptyLayout(layout, subject)];

  const findings: Finding[] = [...checkLabels(layout, subject)];
  for (const slot of layout.slots) {
    if (!SLOTS.includes(slot.slot)) {
      findings.push(
        screenFinding('S6', {
          message: `${subject} のスロット ${slot.path} はレイアウトの語彙にありません`,
          location: slot.location,
          suggestion:
            `スロットは ${SLOTS.join(' / ')} の 5 つだけ。収まらないものは、` +
            'スロットではなくコンポーネントの内側(実装の自由)か、入れ子の layout で表す',
          counterexample: { slot: slot.path, allowed: SLOTS.join(', ') },
        }),
      );
    }
    findings.push(...checkComponents(slot, subject));
  }
  return findings;
}

/**
 * 1 つのレイアウトの中で部品の label(表示名)が重複していないか。
 *
 * label は「内部名で配線・label で表示」の表示側なので、同じ画面(またはクローム・重ね表示)に
 * 同じ表示名の部品が 2 つあると、見ている人には区別が付かない。検査はこの重複だけに留める
 * (「label を書いたのにどこも使っていない」は検査しない — 導出の配線は実装側の関心である)。
 */
function checkLabels(layout: ScreenLayout, subject: string): Finding[] {
  const findings: Finding[] = [];
  const seen = new Map<string, string>();
  for (const slot of layout.slots) {
    for (const component of slot.components) {
      if (component.label === undefined) continue;
      const first = seen.get(component.label);
      if (first !== undefined) {
        findings.push(
          screenFinding('S6', {
            message: `${subject} で label "${component.label}" が ${first} と ${component.name} で重複しています`,
            location: component.location,
            suggestion: '表示名は 1 つのレイアウトの中で一意にする(同じ見出しが 2 つ並ぶと画面で区別できない)',
            counterexample: { label: component.label, components: `${first}, ${component.name}` },
          }),
        );
        continue;
      }
      seen.set(component.label, component.name);
    }
  }
  return findings;
}

/** スロット 1 つの部品名(形式と重複)と、排他表示の状態名を見る。 */
function checkComponents(slot: ScreenLayout['slots'][number], subject: string): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const variantKeys = new Set<string>();
  for (const component of slot.components) {
    const variant = component.variant;
    if (variant !== undefined) {
      if (!SNAKE_CASE.test(variant.key)) {
        findings.push(
          screenFinding('S6', {
            message: `排他表示の状態名 ${variant.key} が snake_case ではありません`,
            location: variant.location,
            suggestion:
              '状態名を no_entry のように snake_case で書く(語彙は自由だが形は揃える)。' +
              '状態名は testid には現れず、ワイヤーフレームで「どちらが出るか」を読むためだけに使う',
            counterexample: { variant: variant.key, slot: slot.path },
          }),
        );
      }
      const scoped = `${variant.group}:${variant.key}`;
      if (variantKeys.has(scoped)) {
        findings.push(
          screenFinding('S6', {
            message: `${subject} のスロット ${slot.path} に排他表示の状態 ${variant.key} が 2 つあります`,
            location: variant.location,
            suggestion:
              '1 つの排他グループの中で状態名は一意にする(同じ状態に 2 つの部品があると「どちらか 1 つ」が成り立たない)',
            counterexample: { slot: slot.path, variant: variant.key },
          }),
        );
      }
      variantKeys.add(scoped);
    }
    if (RESERVED_COMPONENT_NAMES.includes(component.name)) {
      findings.push(
        screenFinding('S6', {
          message: `${component.name} は予約語なので部品名に使えません`,
          location: component.location,
          suggestion:
            'スロットの要素に現れた "variants:" は常に排他表示グループの宣言として読まれる。' +
            '部品には別の名前を付ける',
          counterexample: { slot: slot.path, component: component.name },
        }),
      );
    }
    if (!SNAKE_CASE.test(component.name)) {
      findings.push(
        screenFinding('S6', {
          message: `コンポーネント名 ${component.name} が snake_case ではありません`,
          location: component.location,
          suggestion:
            'コンポーネント名を entry_form のように snake_case で書く' +
            '(名前はそのまま testid のスロットパスの末尾になる)',
          counterexample: { component: component.name },
        }),
      );
    }
    if (seen.has(component.name)) {
      findings.push(
        screenFinding('S6', {
          message: `${subject} のスロット ${slot.path} に部品 ${component.name} が 2 つあります`,
          location: component.location,
          suggestion:
            '同じスロットに同じ名前の部品を並べると、testid のスロットパスが 2 つの物を指す。' +
            '別の名前にするか、1 つにまとめる',
          counterexample: { slot: slot.path, component: component.name },
        }),
      );
    }
    seen.add(component.name);
  }
  return findings;
}

/** スロットが 1 つも無い layout。 */
function emptyLayout(layout: ScreenLayout, subject: string): Finding {
  return screenFinding('S6', {
    message: `${subject} の layout にスロットが 1 つもありません`,
    location: layout.location,
    suggestion:
      'どのスロットに何が載るかを 1 つ以上書く(例: body: { center: [content] })。' +
      '空の宣言は「骨格を決めていない」ことを意味し、testid の骨格も生成できない',
    counterexample: { subject },
  });
}

/** 1 画面の中で重ね表示の id が重複していないか。 */
function checkOverlayIds(screen: ScreenInput['screens']['screens'][number]): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const overlay of screen.overlays) {
    if (seen.has(overlay.id)) {
      findings.push(
        screenFinding('S6', {
          message: `画面 ${screen.name} に重ね表示 ${overlay.id} が 2 つあります`,
          location: overlay.location,
          suggestion:
            '重ね表示の id は画面の中で一意にする(closes_on や testid がどちらを指すか決まらない)',
          counterexample: { screen: screen.name, overlay: overlay.id },
        }),
      );
    }
    seen.add(overlay.id);
  }
  return findings;
}
