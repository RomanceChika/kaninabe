/**
 * レイアウト宣言(3×3 スロット + 入れ子)のパーサー。
 *
 * screen_spec・chrome_spec・overlays が同じ形の `layout` を持つため、読み取りはここ 1 本に集める。
 * ファイル I/O は行わない(I/O は lib/model/screen/loader.ts に集約する。規約: scripts-code-quality.md)。
 *
 * ここが担うのは**形として読めるか**(マッピングか・値がリストか・要素が文字列か)だけであり、
 * スロット名が値域に入っているか・コンポーネント名が snake_case かの判定は S6 が行う。
 * パーサーで弾くと「知らないスロットを書いた」という違反が S6 の表から消え、
 * 検査の所在が文書と実装でずれる。
 *
 * 平坦化しても親を失わないよう、各スロットは**根からのフルパス**(`body.center.own_entry.footer`)を
 * 併せ持つ。これがそのまま testid の骨格になり、同じ部品名が 2 か所に現れても区別できる。
 *
 * 排他表示(`variants:`)の部品も**同じスロットの部品として平坦に**積む。排他は「同時に出ない」
 * という表示の性質であって構造の階層ではなく、階層にすると testid のパスが状態名を含んでしまう。
 */

import { asRecord, asArray, type SpecReporter } from '../parse-common.js';
import { splitForm } from './parse-layout-form.js';
import { splitLabel } from './parse-layout-label.js';
import type { LayoutComponent, LayoutSlot, ScreenLayout } from './types.js';

/** 入れ子の深さの上限。これを超える構造は「レイアウトではなく別の関心事」とみなす。 */
const MAX_DEPTH = 3;

/** 排他表示グループを開くキー。スロットの要素として書く(`- variants: { ... }`)。 */
const VARIANTS_KEY = 'variants';

const LAYOUT_SUGGESTION =
  'layout を "header: [...] / body: { left|center|right: [...] } / footer: [...]" の形で書く' +
  '(スロットはすべて任意。値はコンポーネント名のリスト)';

const COMPONENT_SUGGESTION =
  'スロットの要素はコンポーネント名の文字列か、入れ子の layout や label を持つ 1 キーのマッピング' +
  '(例: "- own_entry: { footer: [submit_bar] }" / "- page_title: { label: 催し一覧 }" / ' +
  '"- sample_form: { kind: form, action: sample.create }" / ' +
  '"- sample_table: { kind: table, reads: query-sample-list, edit: sample.update, actions: [sample.delete] }")、' +
  'または排他表示の "- variants: {状態名: 部品}" で書く';

const VARIANTS_SUGGESTION =
  'variants に "{状態名}: {部品名}" のマッピングを 1 つ以上書く' +
  '(例: "- variants: { own_entry: own_entry_panel, no_entry: entry_form }")。' +
  '部品は入れ子の layout を持つマッピングでもよい';

/** 平坦化の途中で持ち回る文脈(入れ子の親と、そこまでのフルパス)。 */
interface Nest {
  /** 入れ子の親コンポーネント名(トップレベルは null)。 */
  readonly owner: string | null;
  /** ここまでのフルパス(トップレベルは空文字)。 */
  readonly prefix: string;
  /** 現在の入れ子の深さ(トップレベルは 1)。 */
  readonly depth: number;
}

/** トップレベルの文脈。 */
const ROOT: Nest = { owner: null, prefix: '', depth: 1 };

/**
 * `layout` の値を平坦なスロット列に変換する。
 *
 * @param value フロントマターの `layout`(またはその入れ子)の生の値
 * @param pointer 違反位置に使う YAML パス(例: "layout" / "overlays[0].layout")
 * @param reporter 違反の記録先
 * @returns 平坦化したレイアウト。マッピングとして読めない場合も空のレイアウトを返す
 *   (読めないこと自体で仕様の構築を打ち切らない)
 */
export function parseLayout(value: unknown, pointer: string, reporter: SpecReporter): ScreenLayout {
  const slots: LayoutSlot[] = [];
  collectSlots(value, pointer, ROOT, slots, reporter);
  return { declared: true, slots, location: reporter.location(pointer) };
}

/**
 * `layout` が書かれていない場合のレイアウト。
 *
 * @param pointer 位置に使う YAML パス
 * @param reporter 位置の組み立てに使う記録器
 * @returns 宣言が無いことを表す空のレイアウト
 */
export function missingLayout(pointer: string, reporter: SpecReporter): ScreenLayout {
  return { declared: false, slots: [], location: reporter.location(pointer) };
}

/** 1 段ぶんのレイアウト(マッピング)を読み、slots に積む。 */
function collectSlots(
  value: unknown,
  pointer: string,
  nest: Nest,
  slots: LayoutSlot[],
  reporter: SpecReporter,
): void {
  const record = asRecord(value);
  if (record === null) {
    reporter.error(pointer, `${pointer} はマッピングで書きます`, LAYOUT_SUGGESTION, {
      value: String(value),
    });
    return;
  }

  for (const [key, slotValue] of Object.entries(record)) {
    const at = `${pointer}.${key}`;
    const list = asArray(slotValue);
    if (list !== null) {
      slots.push(readSlot(list, key, at, nest, slots, reporter));
      continue;
    }
    const group = asRecord(slotValue);
    if (group === null) {
      reporter.error(at, `${at} はリストかマッピングで書きます`, LAYOUT_SUGGESTION, {
        value: String(slotValue),
      });
      continue;
    }
    collectGroup(group, key, at, nest, slots, reporter);
  }
}

/** `body:` のような 1 段深いスロット群(left / center / right)を読む。 */
function collectGroup(
  group: Readonly<Record<string, unknown>>,
  key: string,
  pointer: string,
  nest: Nest,
  slots: LayoutSlot[],
  reporter: SpecReporter,
): void {
  for (const [subKey, subValue] of Object.entries(group)) {
    const at = `${pointer}.${subKey}`;
    const list = asArray(subValue);
    if (list === null) {
      reporter.error(at, `${at} はコンポーネント名のリストで書きます`, LAYOUT_SUGGESTION, {
        value: String(subValue),
      });
      continue;
    }
    slots.push(readSlot(list, `${key}.${subKey}`, at, nest, slots, reporter));
  }
}

/** 1 つのスロット(コンポーネント名のリスト)を読む。入れ子があればそれも slots に積む。 */
function readSlot(
  list: readonly unknown[],
  slot: string,
  pointer: string,
  nest: Nest,
  slots: LayoutSlot[],
  reporter: SpecReporter,
): LayoutSlot {
  const path = nest.prefix === '' ? slot : `${nest.prefix}.${slot}`;
  const components: LayoutComponent[] = [];
  let variantGroups = 0;
  list.forEach((item, index) => {
    const at = `${pointer}[${index}]`;
    if (typeof item === 'string') {
      components.push({ name: item, location: reporter.location(at) });
      return;
    }
    const nested = asRecord(item);
    const entries = nested === null ? [] : Object.entries(nested);
    const entry = entries.length === 1 ? entries[0] : undefined;
    if (entry === undefined) {
      reporter.error(at, `${at} をコンポーネントとして読めません`, COMPONENT_SUGGESTION, {
        value: String(item),
      });
      return;
    }
    if (entry[0] === VARIANTS_KEY) {
      readVariants(entry[1], `${at}.${VARIANTS_KEY}`, variantGroups, path, nest, components, slots, reporter);
      variantGroups += 1;
      return;
    }
    readComponent(entry[0], entry[1], at, undefined, path, nest, components, slots, reporter);
  });
  return { slot, path, owner: nest.owner, components, location: reporter.location(pointer) };
}

/**
 * 排他表示グループ(`variants:`)を読み、そこに並ぶ部品を**同じスロットの部品として**積む。
 *
 * 排他の状態名(キー)はスロットパスに現れない。DOM 上はどちらか一方しか存在しないため、
 * パスに状態名を含めるとテストが「いまどちらが出ているか」を先に知らないと部品を引けなくなる。
 * 状態名が効くのはワイヤーフレームの読みやすさ(「どちらか」の表示)だけである。
 *
 * @param value `variants:` の値(状態名 → 部品のマッピング)
 * @param pointer 違反位置に使う YAML パス
 * @param group このスロット内で何番目の排他グループか(0 始まり)
 * @param path このスロットのフルパス
 * @param nest 現在の入れ子の文脈
 * @param components 積み先(スロットの部品列)
 * @param slots 積み先(平坦化したスロット列)
 * @param reporter 違反の記録先
 */
function readVariants(
  value: unknown,
  pointer: string,
  group: number,
  path: string,
  nest: Nest,
  components: LayoutComponent[],
  slots: LayoutSlot[],
  reporter: SpecReporter,
): void {
  const record = asRecord(value);
  if (record === null) {
    reporter.error(pointer, `${pointer} はマッピングで書きます`, VARIANTS_SUGGESTION, {
      value: String(value),
    });
    return;
  }
  const entries = Object.entries(record);
  if (entries.length === 0) {
    reporter.error(pointer, '排他表示(variants)に部品が 1 つもありません', VARIANTS_SUGGESTION, {
      slot: path,
    });
    return;
  }
  for (const [key, componentValue] of entries) {
    const at = `${pointer}.${key}`;
    const variant = { group, key, location: reporter.location(at) };
    if (typeof componentValue === 'string') {
      components.push({ name: componentValue, variant, location: reporter.location(at) });
      continue;
    }
    const nested = asRecord(componentValue);
    const nestedEntries = nested === null ? [] : Object.entries(nested);
    const entry = nestedEntries.length === 1 ? nestedEntries[0] : undefined;
    if (entry === undefined) {
      reporter.error(at, `${at} をコンポーネントとして読めません`, VARIANTS_SUGGESTION, {
        value: String(componentValue),
      });
      continue;
    }
    readComponent(entry[0], entry[1], at, variant, path, nest, components, slots, reporter);
  }
}

/** 入れ子の layout・label を持つコンポーネント 1 つを読む(排他グループの中でも外でも同じ規則)。 */
function readComponent(
  name: string,
  nestedLayout: unknown,
  pointer: string,
  variant: LayoutComponent['variant'],
  path: string,
  nest: Nest,
  components: LayoutComponent[],
  slots: LayoutSlot[],
  reporter: SpecReporter,
): void {
  const labelled = splitLabel(nestedLayout, pointer, reporter);
  const { label } = labelled;
  const { kind, actionRefs, readRef, showRefs, editRef, buttonRefs, platformOpRef, platformOpRefs, rowActionRefs, rest } = splitForm(labelled.rest, pointer, reporter);
  components.push({
    name,
    ...(label === undefined ? {} : { label }),
    ...(variant === undefined ? {} : { variant }),
    ...(kind === undefined ? {} : { kind }),
    ...(actionRefs === undefined ? {} : { actionRefs }),
    ...(readRef === undefined ? {} : { readRef }),
    ...(showRefs === undefined ? {} : { showRefs }),
    ...(editRef === undefined ? {} : { editRef }),
    ...(buttonRefs === undefined ? {} : { buttonRefs }),
    ...(platformOpRef === undefined ? {} : { platformOpRef }),
    ...(platformOpRefs === undefined ? {} : { platformOpRefs }),
    ...(rowActionRefs === undefined ? {} : { rowActionRefs }),
    location: reporter.location(pointer),
  });
  // label・kind・action・reads・shows・edit・actions だけのマッピング(入れ子スロット無し)は入れ子ではない — 深さ制限にも掛けない。
  if (rest !== null && Object.keys(rest).length === 0) return;
  if (nest.depth >= MAX_DEPTH) {
    reporter.error(
      pointer,
      `レイアウトの入れ子が深すぎます(${MAX_DEPTH} 段まで)`,
      'これ以上の入れ子はコンポーネントの内部構造であり、仕様ではなく実装の自由に残す',
      { component: name },
    );
    return;
  }
  collectSlots(
    rest ?? nestedLayout,
    pointer,
    { owner: name, prefix: `${path}.${name}`, depth: nest.depth + 1 },
    slots,
    reporter,
  );
}

/**
 * 全コンポーネント名を列挙する(入れ子を含む)。
 *
 * `opened_by` の実在検査(S2)が使う。「その部品が画面のどこかに居るか」を問う検査なので、
 * スロットの区別は要らない。
 *
 * @param layout 平坦化済みのレイアウト
 * @returns コンポーネント名の集合
 */
export function componentNames(layout: ScreenLayout): ReadonlySet<string> {
  return new Set(layout.slots.flatMap((slot) => slot.components.map((component) => component.name)));
}
