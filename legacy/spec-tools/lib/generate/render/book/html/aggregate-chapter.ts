/**
 * 集約の章(`domain/{集約}.html`)の HTML 版。
 *
 * 章の形は **章頭 → 読む量の 4 枚 → 前提の語 → 凡例 → 上段(公理)→ 下段(導出)→ 数の出どころ**。数は集約の章の集計(`faceFacts`)から出し、
 * 4 枚・本文の項目・「数の出どころ」が同じ集計を読む。骨格のうち凡例・前提の語・受け入れの節は層の章と共有する(`layer-chapter.ts`)。
 * 集約の章はどの集約でも同じ形で出す(人向けの表示を重さの上位の章に絞る文脈でも、集計が引ける限り同じ形にする)。
 *
 * 章頭から、同じ集約の新しい形の章(`../spec/{集約}.html`。流れ・できること・見える範囲・決めごとの 4 節)へ戻れる。
 * 上段は `aggregate-upper.ts` と `aggregate-rules.ts`、下段は `aggregate-lower.ts`、数の出どころの行は `aggregate-origin.ts`。
 */

import path from 'node:path';

import type { SpecModel } from '../../../../model/types.js';
import { systemRoleId } from '../../../../model/role-hierarchy.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import { aggregateTitle, bookFile } from '../chapters.js';
import { chapterLoads } from '../chapter-loads.js';
import { aggregateLabel, faceFacts, type FaceFacts } from '../face-facts.js';
import { NOT_WRITTEN } from '../face-html.js';
import { pendingWords } from '../face-budget.js';
import { specRelative } from '../face-sign.js';
import { bookLayout } from '../face-scope.js';
import { ownAxiomCount, readingTotals, testTotal, type ReaderTotals } from '../face-totals.js';
import { acceptSection, glossaryOf, legend, Outline, signFold, termsSection, type AcceptInput } from './layer-chapter.js';
import { carriedSection, changedSection, flowSection, sideboxSection, ownSection, subordinateSection, UPPER_BULLETS } from './aggregate-upper.js';
import { accessSection, examplesSection } from './aggregate-rules.js';
import { lowerSection } from './aggregate-lower.js';
import { originRows } from './aggregate-origin.js';
import { domainEnv, link, specHref, type DomainEnv } from './aggregate-env.js';
import { bold, grid, kv, kvs, mark, mono, prose, pts, term, valueOf, type GridCell } from './face-parts.js';
import { table, type ChapterBody } from './chapter-parts.js';
import { el, join, text, type Html } from './markup.js';
import type { LifecycleFacts } from '../../../../semantics/spec-book/lifecycle-facts.js';

/** 章の題。 */
export function domainTitle(model: SpecModel, name: string): string {
  return aggregateTitle(name, model.aggregates.get(name)?.entity?.label);
}

/** 誰が(章の集約を動かす人。内部実行のロールは除く)。 */
function operatorsRow(env: DomainEnv): Html[] {
  const { model, facts } = env;
  const system = systemRoleId(model.roles.roles);
  const roles = new Set<string>();
  for (const machine of facts.specs.stateMachines) for (const event of machine.events) for (const role of event.by) roles.add(role);
  for (const rule of facts.specs.access?.creates ?? []) roles.add(rule.by);
  for (const rule of facts.specs.access?.writes ?? []) roles.add(rule.by);
  const known = model.roles.roles.filter((role) => roles.has(role.id) && role.id !== system);
  if (known.length === 0) return [];
  return [
    kv(
      '誰が',
      join(
        known.map((role) => (role.label === undefined ? mono(role.id) : join([`${role.label} `, mono(role.id)]))),
        text('、'),
      ),
    ),
  ];
}

/** 章頭のラベル行(誰が / 状態 / 原本)。 */
function headRows(env: DomainEnv): Html | null {
  const machines = env.facts.specs.stateMachines;
  const entityFile = env.facts.specs.entity?.location.file;
  return kvs([
    ...operatorsRow(env),
    kv(
      '状態',
      machines.length === 0 ? 'なし' : valueOf([`状態機械 ${machines.length} 本`, ...machines.map((machine) => join([mono(machine.machine), ` ${machine.states.length} 段`]))]),
    ),
    ...(entityFile === undefined ? [] : [kv('原本', mono(`${specRelative(path.posix.dirname(entityFile), env.ctx)}/`))]),
  ]);
}

/** 読み手 1 人ぶんの受け入れの件数(理由つき + まだ通していない)。 */
function readerAccept(load: ReaderTotals): number {
  return load.reasoned + (load.pending ?? 0);
}

/** 読む量の 4 枚。 */
function budget(facts: FaceFacts): Html {
  const reading = readingTotals(facts);
  const { handwritten, manual, accepted, overrides } = facts.accept;
  const breakdown = facts.own.map((group) => `${aggregateLabel(group.specs)} ${group.invariants.length}`).join('、');
  const cells: GridCell[] = [
    {
      id: 'axiom',
      label: '必読',
      mark: 'axiom',
      value: `業務 ${reading.byReader.business.required} / 開発者 ${reading.byReader.developer.required}`,
      verify: true,
      body: [
        pts([
          `公理 ${reading.axioms} 本。不変条件はこの章 ${ownAxiomCount(facts)}、写した ${facts.carried.length}`,
          `不変条件の内訳 ${breakdown}`,
          `ほかに、アクセスの宣言 ${reading.axiomParts.access} 行、状態の意味 ${reading.axiomParts.states}、要約の文 ${reading.axiomParts.summaries}、計算の例の表 ${reading.axiomParts.examples} 行`,
          `受け入れ ${reading.accept} 件を足す`,
          `業務 ${reading.byReader.business.required} 件。公理 ${reading.byReader.business.axioms} 本と、受け入れ ${readerAccept(reading.byReader.business)} 件。業務の判断をする人が読む`,
          `開発者 ${reading.byReader.developer.required} 件。受け入れ ${readerAccept(reading.byReader.developer)} 件。開発者が通した理由と、未処理の警告`,
        ]),
      ],
    },
    {
      id: 'changed',
      label: '今回変わった',
      mark: 'changed',
      value: reading.changed === null ? '—' : String(reading.changed),
      body: [
        facts.changes === null
          ? pts(['基点が無いので数えない', join(['基点は ', mono('generate -- --base'), ' で渡す'])])
          : pts([join([`基点 `, mono(facts.changes.ref)]), `公理の側の動き ${facts.changes.items.length} か所`]),
      ],
    },
    {
      id: 'acceptance',
      label: '受け入れ',
      mark: 'acceptance',
      value: String(reading.accept),
      verify: true,
      body: [
        pts([
          `理由をつけて通した分 ${reading.reasoned} 件`,
          pendingWords(facts.pending === null ? null : facts.pending.length),
          `理由つきの内訳 手書き ${handwritten.length}、定型外 ${manual.length}、確認の上書きとリント ${overrides.length}、タスクの受け入れ ${accepted.length}`,
        ]),
      ],
    },
    {
      id: 'derive',
      label: '導出(畳んだまま可)',
      mark: 'derive',
      value: String(reading.derived),
      body: [
        pts([
          `遷移 ${facts.transitions} 手、執行点 ${facts.enforcementOwn} か所、テスト ${testTotal(facts.tests)} 件、ジョブ ${facts.jobs} 件`,
          `マトリクス ${facts.matrixCells} マスは別に数える`,
          `写した公理の執行点 ${facts.enforcementCarried} か所は、数に含める`,
        ]),
      ],
    },
  ];
  return grid(cells);
}

/** 章頭の数の約束(4 枚の数・数の出どころ・標識と判断ポイント・手引き)。 */
function countHint(env: DomainEnv): Html {
  const load = chapterLoads(env.model, env.ctx).find((candidate) => candidate.chapter.file === env.countKey);
  return pts(
    [
      '4 枚の数は、この章に並ぶ項目の数と一致する',
      join(['数え方と章の範囲は', link('#origin', '数の出どころ')]),
      ...(load === undefined
        ? []
        : [
            join([
              term(env.glossary, 'signpost', '標識'),
              ` ${load.signCount} 本、`,
              term(env.glossary, 'pause_point', '判断ポイント'),
              ` ${load.declCount} 件。単位が違うので足さない`,
            ]),
            join(['ブロックごとの数は', link('../review-guide.html', 'レビューの手引き')]),
          ]),
    ],
    true,
  );
}

/** 受け入れの節の材料。 */
function acceptInput(env: DomainEnv): AcceptInput {
  const { facts } = env;
  const { handwritten, manual, accepted, overrides } = facts.accept;
  const groups = [
    { kind: join(['テーブルの手書き(', mono('handwritten'), ')']), items: handwritten },
    { kind: join(['定型に乗らない操作(', mono('runner'), ')']), items: manual },
    { kind: join(['確認の上書き(', mono('ux'), ')とリントの受け入れ(', mono('exceptions'), ')']), items: overrides },
    { kind: join(['タスクの受け入れ(', mono('accept:'), ')']), items: accepted },
  ].filter((group) => group.items.length > 0);
  return {
    groups,
    pending: facts.pending,
    signsDecision: facts.signs.decision,
    signFiles: [...new Set([...facts.actions.map((action) => action.location.file), ...facts.tables.map((tableSpec) => tableSpec.location.file)])],
    signPlaces: '操作と表',
  };
}

/** 本文のうち「(まだ書かれていない)」の数(数えるのは出力の側で、数え漏れが無い)。 */
function countUnwritten(body: string): number {
  return body.split(NOT_WRITTEN).length - 1;
}

/**
 * 集約の章の本文と目次。
 *
 * @param model ドメイン仕様全体
 * @param ctx 生成コンテキスト
 * @param name 章の集約(`bookLayout(...).roots` の 1 つ)
 * @param lifecycle 状態機械 1 本の流れの事実を引く口(新しい形の章と同じ事実。図を描く)
 */
export function domainChapter(
  model: SpecModel,
  ctx: GenerateContext,
  name: string,
  lifecycle: (aggregate: string, machine: string) => LifecycleFacts | undefined,
): ChapterBody | null {
  const specs = model.aggregates.get(name);
  if (specs === undefined) return null;
  const facts = faceFacts(model, ctx, specs);
  const env = domainEnv(
    model,
    ctx,
    facts,
    bookLayout(model, ctx),
    bookFile(ctx.roots, `domain/${name}.html`),
    bookFile(ctx.roots, `domain/${name}.md`),
    glossaryOf(model, ctx),
    lifecycle,
  );
  const reading = readingTotals(facts);
  const product = ctx.roots.name === null ? '' : `${ctx.roots.name} `;
  const entityFile = specs.entity?.location.file;

  const legendOutline = new Outline();
  const upperOutline = new Outline();
  const lowerOutline = new Outline();
  const termsOutline = new Outline();
  const originOutline = new Outline();

  const head = join([
    el('p', { class: 'bf-note' }, `${product}ハンドブック · ドメインの章 · 重さは ${facts.aggregateCount} 章中の ${facts.rank} 位`),
    el('p', { class: 'bf-note' }, link(specHref(name), '新しい形の章'), 'へ。流れ、できること、見える範囲、決めごとはそちらに載る'),
    prose(specs.entity?.summary, true),
    headRows(env),
    budget(facts),
    countHint(env),
    entityFile === undefined ? null : signFold(entityFile, ctx, env.pageFile),
  ]);
  const legendHtml = legend(reading, legendOutline, env.glossary);
  const upper = join([
    upperOutline.h2('upper', join(['上段 — 公理 ', mark('axiom')])),
    pts(UPPER_BULLETS, true),
    flowSection(env, upperOutline),
    sideboxSection(env, upperOutline),
    ownSection(env, upperOutline),
    subordinateSection(env, upperOutline),
    accessSection(env, upperOutline),
    examplesSection(env, upperOutline),
    carriedSection(env, upperOutline),
    changedSection(env, upperOutline),
    acceptSection(acceptInput(env), ctx, env.pageFile, upperOutline),
  ]);
  const lower = join([
    lowerOutline.h2('lower', join(['下段 — 導出 ', mark('derive')])),
    pts(['ここにあるのは、上段から機械が出したもの', bold('読まなくても公理の判定は変わらない'), '上段を疑うときに開く', 'ここに違和感があるときに直すのは、上段の側'], true),
    lowerSection(env),
  ]);
  const body = `${head}${legendHtml}${upper}${lower}`;
  const terms = termsSection(model, ctx, body, termsOutline);
  const origin = join([
    originOutline.h2('origin', '数の出どころ'),
    pts(['この章に出る数は、すべて仕様の宣言を数えたもの', '数えられないものは未集計と書く'], true),
    table(['数 / 語', '数え方・定義'], originRows(env, countUnwritten(body))),
  ]);
  return {
    body: join([el('h1', null, domainTitle(model, name)), head, terms, legendHtml, upper, lower, origin]),
    headings: [...termsOutline.headings, ...legendOutline.headings, ...upperOutline.headings, ...lowerOutline.headings, ...originOutline.headings],
  };
}
