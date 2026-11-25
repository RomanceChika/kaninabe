/**
 * screen_spec / chrome_spec 個別ファイルの本文ブロック(`screen-body` / `chrome-body`)の
 * ジェネレーター。
 *
 * screen_spec の YAML(入場・layout・actions・variants / overlays・navigations)を
 * 表と図に写すだけで、情報を足さない。actions の「誰が・どの状態で」はドメイン仕様の
 * 引き写しであり(正は state_spec / access_spec)、骨格の図は README のワイヤーフレームと
 * 同じレンダラーを使う(1 画面分だけを出す)。
 */

import type { SpecModel } from '../../model/types.js';
import type {
  ChromeSpec,
  ScreenLayout,
  ScreenSpec,
  ScreenSpecModel,
} from '../../model/screen/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { cell, markdownTable } from '../../gen-kit/state-machine-table.js';
import { fencedBlock } from './fenced.js';
import { chromeFrameLines, screenFrameLines, WIREFRAME_LEGEND } from './screen-wireframe.js';
import { groundingKindText, groundingRoles, groundingSummary, kvTable, testCaseTable } from './spec-body.js';
import { groundOperation } from '../../semantics/operation-ground.js';
import { specPath } from '../../model/product/paths.js';

/**
 * 画面仕様の本文ブロックを生成するジェネレーター。
 * 出力は各 screen_spec の `screen-body` と各 chrome_spec の `chrome-body` マーカー 1 か所ずつ。
 */
export const screenBodyGenerator: DocGenerator = {
  id: 'screen-body',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const screens = ctx.screens;
    if (screens === undefined || !screens.available) return [];
    const chromes = new Map(screens.chromes.map((chrome) => [chrome.id, chrome]));
    return [
      ...screens.screens.map((screen) => ({
        file: specPath(ctx.roots, `frontend/screens/${screen.relPath}`),
        marker: 'screen-body',
        content: renderScreenBody(
          model,
          screen,
          screen.chrome === undefined ? undefined : chromes.get(screen.chrome.id),
        ),
      })),
      ...screens.chromes.map((chrome) => ({
        file: specPath(ctx.roots, `frontend/chrome/${chrome.relPath}`),
        marker: 'chrome-body',
        content: renderChromeBody(chrome, screens),
      })),
    ];
  },
};

/**
 * screen_spec 1 枚の本文(入場・骨格・操作・排他 / 重ね表示・遷移・テストケース)を組み立てる。
 *
 * @param model ドメイン仕様全体(actions の接地先)
 * @param screen 対象の画面
 * @param chrome 継承する共有クローム(継承していなければ undefined)
 * @returns Markdown 断片(末尾に改行を含まない)
 */
export function renderScreenBody(
  model: SpecModel,
  screen: ScreenSpec,
  chrome: ChromeSpec | undefined,
): string {
  const sections = [
    '### 入場と読み取り',
    '',
    entryTable(screen),
    '',
    '### 骨格',
    '',
    WIREFRAME_LEGEND,
    '',
    fencedBlock('text', screenFrameLines(screen, chrome)),
    ...actionsSection(model, screen),
    ...variantsSection(screen),
    ...overlaysSection(screen),
    ...navigationsSection(screen),
    '',
    '### テストケース',
    '',
    testCaseTable(screen.testCases),
  ];
  return sections.join('\n');
}

/** 入場と読み取りの表(route / chrome / for / requires_auth / subject / precondition / reads / 表示義務)。 */
function entryTable(screen: ScreenSpec): string {
  return kvTable([
    ['route', `\`${screen.route}\``],
    ['chrome', screen.chrome?.id ?? ''],
    ['閲覧ロール（for）', screen.forRoles.join(', ')],
    ['entry_point', screen.entryPoint ? '✓' : '—'],
    ['requires_auth', screen.requiresAuth ? '✓' : '—'],
    ['subject', screen.subject?.entity ?? ''],
    ['precondition', screen.precondition === undefined ? '' : `\`${screen.precondition.source}\``],
    ['on_fail', screen.onFail?.raw ?? ''],
    ['reads（query_spec）', screen.reads.map((read) => read.id).join(', ')],
    ['表示義務（states.requires）', screen.requiredStates.join(', ')],
  ]);
}

/** 操作の表(画面と重ね表示の actions を 1 母集合にし、ドメイン仕様の導出を併記する)。 */
function actionsSection(model: SpecModel, screen: ScreenSpec): string[] {
  const rows: string[][] = [];
  const push = (id: string, declaredIn: string): void => {
    const grounding = groundOperation(model, id);
    rows.push([
      `\`${cell(id)}\``,
      cell(groundingKindText(grounding)),
      cell(groundingRoles(grounding).join(', ')),
      cell(groundingSummary(grounding)),
      cell(declaredIn),
    ]);
  };
  for (const action of screen.actions) push(action.id, '画面');
  for (const overlay of screen.overlays) {
    for (const action of overlay.actions) push(action.id, `overlay: ${overlay.id}`);
  }
  if (rows.length === 0) return ['', '### 操作（actions）', '', 'この画面から発火できる操作はない（読むだけの画面）。'];
  const table = markdownTable(['操作', '種別', 'by', '前提（ドメイン仕様からの導出）', '宣言元'], rows);
  return ['', '### 操作（actions）', '', table];
}

/** 排他表示の表(layout / overlays の variants 所属部品を平坦に並べる)。無ければ節ごと出さない。 */
function variantsSection(screen: ScreenSpec): string[] {
  const rows = [
    ...variantRows(screen.layout),
    ...screen.overlays.flatMap((overlay) => variantRows(overlay.layout)),
  ];
  if (rows.length === 0) return [];
  const table = markdownTable(['スロット', 'グループ', '状態（key）', '部品'], rows);
  return ['', '### 排他表示（variants）', '', table];
}

/** 1 つのレイアウトから variants 所属の部品の行を集める。 */
function variantRows(layout: ScreenLayout): string[][] {
  const rows: string[][] = [];
  for (const slot of layout.slots) {
    for (const component of slot.components) {
      if (component.variant === undefined) continue;
      rows.push([
        cell(slot.path),
        `排他${component.variant.group + 1}`,
        cell(component.variant.key),
        cell(component.name),
      ]);
    }
  }
  return rows;
}

/** 重ね表示の表。無ければ節ごと出さない(骨格の図には常に出ている)。 */
function overlaysSection(screen: ScreenSpec): string[] {
  if (screen.overlays.length === 0) return [];
  const table = markdownTable(
    ['overlay', 'opened_by', 'actions', 'closes_on'],
    screen.overlays.map((overlay) => [
      cell(overlay.id),
      cell(overlay.openedBy ?? ''),
      cell(overlay.actions.map((action) => action.id).join(', ')),
      cell(overlay.closesOn.join(', ')),
    ]),
  );
  return ['', '### 重ね表示（overlays）', '', table];
}

/** 遷移の表(共有クロームから展開された遷移は宣言元にその chrome を出す)。 */
function navigationsSection(screen: ScreenSpec): string[] {
  if (screen.navigations.length === 0) {
    return ['', '### 遷移（navigations）', '', 'この画面から出る遷移はない。'];
  }
  const table = markdownTable(
    ['きっかけ（on）', '遷移先（to）', '宣言元'],
    screen.navigations.map((navigation) => [
      cell(navigation.on),
      cell(navigation.to),
      navigation.viaChrome === undefined ? '画面' : cell(navigation.viaChrome),
    ]),
  );
  return ['', '### 遷移（navigations）', '', table];
}

/**
 * chrome_spec 1 枚の本文(骨格・遷移・継承している画面)を組み立てる。
 *
 * @param chrome 対象のクローム
 * @param model 画面仕様全体(この chrome を継承している画面の一覧に使う)
 * @returns Markdown 断片(末尾に改行を含まない)
 */
export function renderChromeBody(chrome: ChromeSpec, model: ScreenSpecModel): string {
  const inheritors = model.screens.filter((screen) => screen.chrome?.id === chrome.id);
  const sections = [
    '### 骨格',
    '',
    fencedBlock('text', chromeFrameLines(chrome)),
    '',
    '### 遷移（navigations）',
    '',
    chrome.navigations.length === 0
      ? 'この共有部から出る遷移はない。'
      : markdownTable(
          ['きっかけ（on）', '遷移先（to）'],
          chrome.navigations.map((navigation) => [cell(navigation.on), cell(navigation.to)]),
        ),
    '',
    '### 継承している画面',
    '',
    inheritors.length === 0
      ? 'この chrome を継承している画面はまだない。'
      : markdownTable(
          ['画面', 'route'],
          inheritors.map((screen) => [cell(screen.id), `\`${cell(screen.route)}\``]),
        ),
  ];
  return sections.join('\n');
}
