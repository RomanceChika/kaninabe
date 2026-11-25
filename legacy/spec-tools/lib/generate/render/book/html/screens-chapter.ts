/**
 * 「アプリの見える側(画面)」の章の HTML 版。
 *
 * 中身は `screens-upper.ts` / `screens-lower.ts` の事実と語で、骨格は `layer-chapter.ts`。上段は画面 1 枚 = 1 行
 * (誰が見るか・入場の条件・読むもの・できること・部品の宣言)を、仕様のディレクトリごとに並べる。下段(`screens-lower-chapter.ts`)の表の行
 * (testid・遷移・テスト)と折りたたみの見出しは `screens-lower.ts` のものを使う。
 *
 * 実物の SSR プレビュー(実装が描いた HTML の断片)は、出力の口の `previewFragment` が画面プレビューの許可表に通してから置く(重ね表示は開いた姿で、状態ごとの見え方も同じ)。
 * 図は次の 2 つで、どちらも画面の事実を落とさず表と箇条で示す:
 * - 動線の図(mermaid)は、同じ辺(`collectNavEdges`)を遷移元・きっかけ・遷移先の表にする。節の名前は上段の画面の行へのリンク
 * - 構造の図(CSS の入れ子ボックス)は、同じ木(`layoutTree`)をスロットと部品の入れ子の箇条にする
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import type { ComponentKind, LayoutComponent, ScreenSpec, ScreenSpecModel } from '../../../../model/screen/types.js';
import { declaredActionIds } from '../../../../model/screen/declared-actions.js';
import { specPath } from '../../../../model/product/paths.js';
import { acceptCounts, acceptItems } from '../../../../semantics/reading-load.js';
import { screenUnits, type LayerUnit } from '../../../../semantics/reading-layers.js';
import { collectSigns } from '../../../prose.js';
import { headingSlug } from '../../html.js';
import { screenGroup } from '../../screen-nav-graph.js';
import { screenGroups } from '../../screen-flow-graphs.js';
import { roleLabels } from '../access-view.js';
import { pendingFindings, pendingOfChapter } from '../finding-placement.js';
import { bookLayout } from '../face-scope.js';
import { allComponents, declaredParts, KIND_WORDS } from '../screens-upper.js';
import { ownNavigations, screenDerivedRows } from '../screens-lower.js';
import { bold, kv, mono, none, valueOf } from './face-parts.js';
import { axiomRow, items, layerChapter, signFold, type Outline } from './layer-chapter.js';
import { el, join, text, type Child, type Html } from './markup.js';
import { lowerBlocks, monos } from './screens-lower-chapter.js';
import type { ChapterBody } from './chapter-parts.js';

/** 章の題。 */
export const SCREENS_TITLE = '画面';

/** 宣言された部品 1 つの行(読む・見せる・操作する・編集する・ボタンにする)。 */
function partItem(part: LayoutComponent & { readonly kind: ComponentKind }): Html {
  const shows = part.kind === 'table' || part.kind === 'detail' ? [part.showRefs === undefined ? '見せる 全欄' : join(['見せる ', monos(part.showRefs.map((ref) => ref.id))])] : [];
  const pieces: Child[] = [
    ...(part.readRef === undefined ? [] : [join(['読む ', mono(part.readRef.id)])]),
    ...shows,
    ...(part.actionRefs === undefined || part.actionRefs.length === 0 ? [] : [join(['操作 ', monos(part.actionRefs.map((ref) => ref.id))])]),
    ...(part.editRef === undefined ? [] : [join(['編集 ', mono(part.editRef.id)])]),
    ...(part.buttonRefs === undefined || part.buttonRefs.length === 0 ? [] : [join(['ボタン ', monos(part.buttonRefs.map((ref) => ref.id))])]),
  ];
  return join([mono(part.name), ` ${KIND_WORDS[part.kind]}`, pieces.length === 0 ? null : join([' — ', join(pieces, text('、'))])]);
}

/** 排他表示(同じスロットで同時には出ない部品)の項目。 */
function variantItems(screen: ScreenSpec): Html[] {
  return screen.layout.slots.flatMap((slot) => {
    const groups = new Map<number, Html[]>();
    for (const component of slot.components) {
      if (component.variant === undefined) continue;
      groups.set(component.variant.group, [...(groups.get(component.variant.group) ?? []), join([`${component.variant.key} → `, mono(component.name)])]);
    }
    return [...groups.values()].map((members) => join(['同時には出ない ', mono(slot.path), ' — ', join(members, text(' / '))]));
  });
}

/** 「決まること」の項目(読むもの・できること・保存点・部品の宣言・排他表示・手書きの部品)。 */
function settles(screen: ScreenSpec): Child[] {
  const actions = declaredActionIds(screen);
  const handwritten = allComponents(screen).filter((component) => component.kind === undefined);
  return [
    ...(screen.reads.length === 0 ? [] : [join(['読むもの ', monos(screen.reads.map((ref) => ref.id))])]),
    ...(actions.length === 0 ? [] : [join(['できること ', monos(actions)])]),
    ...(screen.usecases.length === 0 ? [] : [join(['タスクの保存点 ', monos(screen.usecases.map((ref) => ref.id))])]),
    ...declaredParts(screen).map(partItem),
    ...variantItems(screen),
    ...(handwritten.length === 0 ? [] : [join(['手書きの部品 ', monos(handwritten.map((component) => component.name))])]),
  ];
}

/** 画面 1 枚の行。 */
function screenRow(screen: ScreenSpec, unit: LayerUnit, labels: ReadonlyMap<string, string>): Html {
  const roles = screen.forRoles.map((role) => (labels.has(role) ? join([`${labels.get(role) ?? role} `, mono(role)]) : mono(role)));
  const settled = settles(screen);
  return axiomRow(
    join([mono(screen.name), screen.label === undefined ? null : ` ${screen.label}`]),
    [
      kv('誰が', valueOf([...roles, ...(screen.requiresAuth ? ['要ログイン'] : [])])),
      ...(screen.subject === undefined ? [] : [kv('主語', mono(screen.subject.entity))]),
      ...(screen.precondition === undefined ? [] : [kv('条件', mono(screen.precondition.source))]),
      ...(screen.onFail === undefined ? [] : [kv('どこへ', join(['満たさなければ ', mono(screen.onFail.screen), ' へ']))]),
      ...(screen.entryPoint ? [kv('状態', '入口の画面')] : []),
      kv('決まること', settled.length === 0 ? none('読み・操作・部品の宣言なし') : valueOf(settled)),
    ],
    unit.elements,
    headingSlug(screen.name),
  );
}

/** 画面の行を、仕様のディレクトリ(グループ)ごとに並べる。 */
function screenRows(screens: ScreenSpecModel, unitOf: ReadonlyMap<string, LayerUnit>, labels: ReadonlyMap<string, string>): Child[] {
  return screenGroups(screens).flatMap((group) => {
    const members = screens.screens.filter((screen) => screenGroup(screen) === group);
    return [
      el('p', { class: 'bf-group' }, group, el('small', null, `${members.length} 枚`)),
      members.map((screen) => {
        const unit = unitOf.get(screen.name);
        return unit === undefined ? null : screenRow(screen, unit, labels);
      }),
    ];
  });
}

/**
 * 画面の章の本文と目次。画面が 1 枚も無ければ、案内と共有クロームの標識だけ。
 *
 * @param countKey 章の数の鍵(`chapters.ts` の章のファイル)
 * @param file 書き出すファイル(リポジトリルート相対)
 */
export function screensChapter(model: SpecModel, ctx: GenerateContext, screens: ScreenSpecModel, countKey: string, file: string): ChapterBody {
  if (screens.screens.length === 0) {
    return {
      body: join([
        el('h1', null, SCREENS_TITLE),
        el('p', null, 'まだ画面が無い(仕様を書くと、ここに画面の一覧と動線の表が生成される)。'),
        screens.chromes.map((chrome) => signFold(chrome.location.file, ctx, file)),
      ]),
      headings: [],
    };
  }
  const units = screenUnits(screens.screens);
  const unitOf = new Map(units.map((unit) => [unit.id, unit] as const));
  const specFiles = [...screens.screens.map((screen) => screen.location.file), ...screens.chromes.map((chrome) => chrome.location.file)];
  const all = pendingFindings(ctx);
  const accepted = acceptItems(acceptCounts([], [], [], screens.screens));
  const withParts = screens.screens.filter((screen) => declaredParts(screen).length > 0).length;
  const testids = screens.screens.reduce((sum, screen) => sum + screenDerivedRows(screen).filter((row) => row[0] === 'testid').length, 0);
  const navs = screens.screens.reduce((sum, screen) => sum + ownNavigations(screen).length, 0);
  const tests = screens.screens.reduce((sum, screen) => sum + screen.testCases.length, 0);
  const inherited = screens.screens.reduce((sum, screen) => sum + screen.navigations.length, 0) - navs;
  const groups = screenGroups(screens);
  return layerChapter(model, ctx, {
    title: SCREENS_TITLE,
    countKey,
    file,
    crumb: { layer: '画面の章', count: `画面は ${screens.screens.length} 枚` },
    intro: [
      'アプリの見える側の全体像',
      '画面 1 枚が、上段の 1 行',
      'どの操作をどの画面に束ねるかは、人の意図の領分',
      '機械は何が要るかまでしか言えない。行の決まることが、意図と合っているかを読む',
    ],
    axiomBreakdown: `画面 ${screens.screens.length} 枚(部品の宣言を持つもの ${withParts} 枚)`,
    upperBullets: [
      '画面 1 枚が 1 行。誰が見るか、入場の条件、読むもの、できること、部品を並べる',
      '部品の宣言は、画面の行の中で読む。別には数えない',
      '人が判定するのは、この人がこの画面でこれを見て、これをしてよいかどうか',
      '機械が保証するのは、参照の実在と、入場条件の文法と、遷移の対応だけ',
    ],
    upper: (outline: Outline): Child[] => [outline.h3('screens', `画面(${screens.screens.length})`), screenRows(screens, unitOf, roleLabels(model))],
    accept: {
      groups: accepted.length === 0 ? [] : [{ kind: join(['画面の UX 原則の受け入れ(', mono('ux:'), ')']), items: accepted }],
      pending: all === null ? null : pendingOfChapter(all, model, ctx.roots, countKey, bookLayout(model, ctx)),
      signsDecision: specFiles.reduce((sum, specFile) => sum + collectSigns(ctx.specSources?.get(specFile) ?? '').length, 0),
      signFiles: specFiles,
      signPlaces: '画面の仕様',
    },
    reasonedWords: `画面の UX 原則の受け入れ(ux:) ${accepted.length} 件。手書きの部品に理由を書く欄は無い`,
    lower: lowerBlocks(screens, ctx, file),
    derived: {
      count: testids + navs + tests,
      lines: [`testid ${testids} 件、遷移 ${navs} 件、テスト ${tests} 件`, `共有クロームから継承した遷移 ${inherited} 本は含めない`, '実物のプレビューと図は、数える項目ではない'],
    },
    originRows: [
      [
        bold('章の範囲'),
        items([
          `画面の仕様 ${screens.screens.length} 枚と、共有クロームの仕様 ${screens.chromes.length} 枚`,
          join([
            `仕様のディレクトリ ${groups.length} つ(`,
            join(
              groups.map((group) => mono(group)),
              text('、'),
            ),
            ')',
          ]),
          bold('この章で「全部」と言うのは、この仕様の木に載っている画面だけ'),
          `共有クロームは画面の枠なので、公理の単位にしない。標識は ${specPath(ctx.roots, 'frontend/chrome')} の分も、受け入れの下に置く`,
        ]),
      ],
      [
        bold('公理の数え方'),
        items([
          '数える単位は画面 1 枚。誰が見るか・入場の条件・読むもの・束ねる操作・部品の宣言を、まとめて 1 本',
          '部品の宣言(表・詳細・フォーム・操作ボタン)は、画面の行の中で読む。別の単位にはしない',
          '束ねる操作は、画面の操作と重ね表示の操作を合わせた集合',
          '手書きの部品は、名前を並べて示す。手書きの理由を書く欄は仕様に無いので、受け入れには数えない',
          '表示の義務の状態・testid・遷移・テストは導出で、下段に出す',
        ]),
      ],
    ],
  });
}
