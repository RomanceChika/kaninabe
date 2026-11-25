
import type { SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { termGloss } from './term-gloss.js';

/** 「この本に出てくる言葉」の語(テンプレート。HTML 版の表紙も使う)。 */
export const GLOSSARY_WORDS = {
  heading: 'この本に出てくる言葉',
  lead: 'どのページでも同じ意味で使う。ここだけ読めば迷子にならない。',
  none: '(用語の台帳 `terms.md` に `face: book` の語がまだ無い)',
  headers: ['言葉', '意味'],
  implHeading: '実装の側の 3 語(読まなくてよいが、コードを開くと出てくる)',
  implLead: [
    'この本の言葉と実装のディレクトリ名は 1 対 1 ではない。**同じ綴りが世間では別の意味で使われている**',
    'ものがあるので、対応表を置く(ADR-0012 §5)。',
  ],
  implHeaders: ['コードの語', 'この本の言葉', '何であって、何でないか', 'Clean Architecture の同じ綴り'],
  implRows: [
    ['`operation`', '**操作**', '書き込み 1 つ分の手順(1 操作 = 手順が 1 つの保存点)。判断は持たず、実行計画を実行器が実行するだけである', '— (DDD で言えば application service に当たる)'],
    ['`usecase`', '**タスク**', '人が 1 回で終わらせたい目的の単位。操作を並べたもので、**ドメインの正しさは変えない**(操作の組み合わせだけを決める)', 'Clean Architecture の `usecase` は「ビジネスルールの置き場」だが、ここにルールは 1 つも無い'],
    ['`composition`', '(本には出ない)', '配線だけ。IF と実装を結んで返すファクトリで、分岐も計算も無い', 'Clean Architecture の `interactor` **ではない**。あちらは手順を持つが、こちらは持たない(だから Composition Root と呼ぶ)'],
  ],
  tail: [
    '「この操作を足したい」は `operation`、「この一連の作業を 1 画面で終わらせたい」は `usecase`、',
    '「本番の実装をつなぐ」は `composition` である。',
  ],
} as const;

/** 「この本に出てくる言葉」の行(台帳の `face: book` の行。宣言順。語と語釈)。 */
export function glossaryRows(model: SpecModel, ctx: GenerateContext): readonly { readonly term: string; readonly gloss: string }[] {
  return (ctx.terms?.ledger?.terms ?? []).filter((decl) => decl.face === 'book').map((decl) => ({ term: decl.term, gloss: termGloss(decl, model) }));
}

/** 規模の要約の行(すべて仕様からの数え上げ。HTML 版の表紙も使う)。 */
export function scaleRows(model: SpecModel, ctx: GenerateContext): [string, string][] {
  const aggregates = [...model.aggregates.values()];
  const withMachines = aggregates.filter((specs) => specs.stateMachines.length > 0);
  const events = aggregates.flatMap((specs) => specs.stateMachines.flatMap((machine) => machine.events));
  const accessRules = aggregates.reduce(
    (sum, specs) =>
      sum +
      (specs.access === undefined
        ? 0
        : specs.access.creates.length + specs.access.writes.length + specs.access.deletes.length),
    0,
  );
  const rows: [string, string][] = [
    ['集約', `${model.aggregates.size}(うち状態機械を持つもの: ${withMachines.map((s) => s.name).join(', ') || 'なし'})`],
    ['ロール', String(model.roles.roles.length)],
    ['状態遷移(イベント)', String(events.length)],
    ['作成・編集・削除の宣言', String(accessRules)],
  ];
  if (ctx.actions !== undefined) rows.push(['Server Action(書き込みの入口)', String(ctx.actions.actions.length)]);
  if (ctx.queries?.available === true) rows.push(['読み取り経路(query)', String(ctx.queries.queries.length)]);
  if (ctx.screens?.available === true) {
    rows.push(['画面', `${ctx.screens.screens.length}(共有クローム ${ctx.screens.chromes.length})`]);
  }
  const design = ctx.design?.spec;
  if (design !== undefined && design !== null) {
    rows.push(['デザイントークン', `${design.tokens.length}(テーマ: ${design.theme})`]);
  }
  return rows;
}

/** 集約関係図の節の語(HTML 版の表紙も使う)。 */
export const GRAPH_WORDS = {
  heading: '集約はどう結びついているか',
  none: 'まだエンティティが無い(仕様を書くと、ここに関係図が生成される)。',
} as const;
