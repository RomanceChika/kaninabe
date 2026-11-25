/**
 * 画面の章の上段(公理): 画面 1 枚 = 1 行。
 *
 * 行は誰が見るか(`for`・要ログイン)・主語・入場の条件と行き先・入口か・決まること(読むもの・できること・部品の宣言)。
 * **部品は別の単位にしない**: 部品の宣言(読む・見せる・編集する・操作する)は、画面 1 枚の判断(この人がこの画面で
 * これを見て、これをしてよいか)の一部として、行の中に並べる。数える単位は `semantics/reading-layers.ts` の 1 か所で、
 * 行はその単位から組む。行頭の見出しは画面名(内部名)で、日本語名が宣言されていれば添える。見出しの `id` は
 * 遷移図の節点のリンク先(画面名から導いたアンカー)。
 */

import type { ComponentKind, LayoutComponent, ScreenSpec } from '../../../model/screen/types.js';
import { declaredActionIds } from '../../../model/screen/declared-actions.js';
import type { LayerUnit } from '../../../semantics/reading-layers.js';
import { headingSlug } from '../html.js';
import { axiomRowHtml } from './face-chapter.js';
import { esc, kv, mono, none, valueOf } from './face-html.js';

/** 部品の種類(フレームワーク固定の値域)の言い方。 */
export const KIND_WORDS: Readonly<Record<ComponentKind, string>> = {
  form: 'フォーム',
  table: '表',
  detail: '詳細',
  actions: '操作ボタン',
  platform_read: '認証基盤の操作の表',
  platform_actions: '認証基盤の操作ボタン',
};

/** 参照の並び(等幅。読点でつなぐ)。 */
function monos(ids: readonly string[]): string {
  return ids.map((id) => mono(id)).join('、');
}

/** 画面の全部品(入れ子のスロットも含む。宣言順)。 */
export function allComponents(screen: ScreenSpec): readonly LayoutComponent[] {
  return screen.layout.slots.flatMap((slot) => slot.components);
}

/** 生成物として宣言された部品(`kind` を持つもの)。 */
export function declaredParts(screen: ScreenSpec): readonly (LayoutComponent & { readonly kind: ComponentKind })[] {
  return allComponents(screen).flatMap((component) => (component.kind === undefined ? [] : [{ ...component, kind: component.kind }]));
}

/** 宣言された部品 1 つの行(読む・見せる・操作する・編集する・ボタンにする)。 */
function partItem(part: LayoutComponent & { readonly kind: ComponentKind }): string {
  const shows =
    part.kind === 'table' || part.kind === 'detail'
      ? [part.showRefs === undefined ? '見せる 全欄' : `見せる ${monos(part.showRefs.map((ref) => ref.id))}`]
      : [];
  const pieces = [
    ...(part.readRef === undefined ? [] : [`読む ${mono(part.readRef.id)}`]),
    ...shows,
    ...(part.actionRefs === undefined || part.actionRefs.length === 0 ? [] : [`操作 ${monos(part.actionRefs.map((ref) => ref.id))}`]),
    ...(part.editRef === undefined ? [] : [`編集 ${mono(part.editRef.id)}`]),
    ...(part.buttonRefs === undefined || part.buttonRefs.length === 0 ? [] : [`ボタン ${monos(part.buttonRefs.map((ref) => ref.id))}`]),
  ];
  return `${mono(part.name)} ${esc(KIND_WORDS[part.kind])}${pieces.length === 0 ? '' : ` — ${pieces.join('、')}`}`;
}

/**
 * 排他表示(同じスロットで同時には出ない部品)の項目。スロットと、同じ `variants:` ブロックの部品を、状態名つきで並べる。
 * 排他は照合相手の無い宣言なので、行の中で人が読む(画面のテストは実装が守ることだけを見る)。
 */
function variantItems(screen: ScreenSpec): string[] {
  return screen.layout.slots.flatMap((slot) => {
    const groups = new Map<number, string[]>();
    for (const component of slot.components) {
      if (component.variant === undefined) continue;
      groups.set(component.variant.group, [...(groups.get(component.variant.group) ?? []), `${esc(component.variant.key)} → ${mono(component.name)}`]);
    }
    return [...groups.values()].map((members) => `同時には出ない ${mono(slot.path)} — ${members.join(' / ')}`);
  });
}

/** 「決まること」の項目(読むもの・できること・保存点・部品の宣言・排他表示・手書きの部品)。 */
function settles(screen: ScreenSpec): string[] {
  const actions = declaredActionIds(screen);
  const handwritten = allComponents(screen).filter((component) => component.kind === undefined);
  return [
    ...(screen.reads.length === 0 ? [] : [`読むもの ${monos(screen.reads.map((ref) => ref.id))}`]),
    ...(actions.length === 0 ? [] : [`できること ${monos(actions)}`]),
    ...(screen.usecases.length === 0 ? [] : [`タスクの保存点 ${monos(screen.usecases.map((ref) => ref.id))}`]),
    ...declaredParts(screen).map(partItem),
    ...variantItems(screen),
    ...(handwritten.length === 0 ? [] : [`手書きの部品 ${monos(handwritten.map((component) => component.name))}`]),
  ];
}

/** 画面 1 枚の行。 */
export function screenRow(screen: ScreenSpec, unit: LayerUnit, labels: ReadonlyMap<string, string>): string {
  const roles = screen.forRoles.map((role) => (labels.has(role) ? `${esc(labels.get(role) ?? role)} ${mono(role)}` : mono(role)));
  const items = settles(screen);
  const head = `${mono(screen.name)}${screen.label === undefined ? '' : ` ${esc(screen.label)}`}`;
  return axiomRowHtml(
    head,
    [
      kv('誰が', valueOf([...roles, ...(screen.requiresAuth ? ['要ログイン'] : [])])),
      ...(screen.subject === undefined ? [] : [kv('主語', mono(screen.subject.entity))]),
      ...(screen.precondition === undefined ? [] : [kv('条件', mono(screen.precondition.source))]),
      ...(screen.onFail === undefined ? [] : [kv('どこへ', `満たさなければ ${mono(screen.onFail.screen)} へ`)]),
      ...(screen.entryPoint ? [kv('状態', '入口の画面')] : []),
      kv('決まること', items.length === 0 ? none('読み・操作・部品の宣言なし') : valueOf(items)),
    ],
    unit.elements,
    headingSlug(screen.name),
  );
}

/** 画面の行を、仕様のディレクトリ(グループ)ごとに並べる。 */
export function screenRows(
  screens: readonly ScreenSpec[],
  groupOf: (screen: ScreenSpec) => string,
  groups: readonly string[],
  unitOf: ReadonlyMap<string, LayerUnit>,
  labels: ReadonlyMap<string, string>,
): string[] {
  return groups.flatMap((group) => {
    const members = screens.filter((screen) => groupOf(screen) === group);
    return [
      `<p class="bf-group">${esc(group)}<small>${members.length} 枚</small></p>`,
      ...members.flatMap((screen) => {
        const unit = unitOf.get(screen.name);
        return unit === undefined ? [] : [screenRow(screen, unit, labels)];
      }),
    ];
  });
}
