/**
 * 新しい形の章(`spec/{集約}.html` と `spec/index.html`)の本文を、出力の口(`markup.ts`)で組む。
 *
 * 事実と語は `spec/*.ts`(`words.ts` など)と事実の層から引く。書き出し方は: 表は `<table>`、状態と役の印は `<span>`、
 * 流れの図は mermaid ではなく自前の SVG(`flow-diagram.ts`)。語は `spec/words.ts` のものを使い、ここに語は持たない
 * (Markdown の記号を含む語 `axisHeading` だけは使わず、見出しをここで組む)。
 */

import type { AggregateAccessFacts } from '../../../../semantics/spec-book/access-facts.js';
import type { InvariantFact } from '../../../../semantics/spec-book/invariant-facts.js';
import type { LifecycleFacts, StateFact } from '../../../../semantics/spec-book/lifecycle-facts.js';
import type { LifecycleAxes, MachineFollowers } from '../../../../semantics/spec-book/lifecycle-followers.js';
import { mergedRows } from '../spec/access-section.js';
import {
  ACCEPTED_WORDS,
  ACCESS_WORDS,
  AUTONOMY_WORDS,
  CATEGORY_WORDS,
  FLOW_WORDS,
  FOLLOW_KIND_WORDS,
  INVARIANT_CATEGORY_WORDS,
  OPERATION_WORDS,
  OVERVIEW_WORDS,
  RULE_WORDS,
  originWords,
  scopeWords,
} from '../spec/words.js';
import { flowDiagram } from './flow-diagram.js';
import { el, join, text, type Child, type Html, url } from './markup.js';
import type { PageHeading } from './page.js';
import { code, section, table, type ChapterBody } from './chapter-parts.js';
import { stateChip } from './chips.js';

/** 段(`h3`)。 */
function subsection(id: string, title: Html, headings: PageHeading[], content: () => Child): Html {
  headings.push({ level: 3, id, title });
  return join([el('h3', { id }, title), content()]);
}

/** 流れ 1 本(図・状態の表・遷移の表・注)。 */
function flow(facts: LifecycleFacts, roleLabel: (role: string) => Html): Html {
  const chip = new Map(facts.states.map((state) => [state.id, stateChip(facts, state)]));
  const named = (ids: readonly string[]): Html =>
    join(
      ids.map((id) => chip.get(id) ?? id),
      el('wbr', null),
    );
  const anywhere = facts.transitions.filter((transition) => transition.fromAnywhere);
  const unwired = facts.transitions.filter((transition) => transition.autonomy === 'system-unwired');
  const notes = [
    ...(anywhere.length === 0 ? [] : [FLOW_WORDS.fromAnywhere(anywhere.map((transition) => `「${transition.label}」`).join('・'))]),
    ...unwired.map((transition) => FLOW_WORDS.unwired(transition.label, transition.unwiredReason)),
  ];
  return join([
    facts.summary === undefined ? null : el('p', null, facts.summary),
    flowDiagram(facts, FLOW_WORDS.figureNote + (anywhere.length > 0 ? FLOW_WORDS.figureAnywhere : '')),
    table(
      FLOW_WORDS.statesHeaders,
      facts.states.map((state) => [
        stateChip(facts, state),
        CATEGORY_WORDS[state.category] + (state.final ? `・${FLOW_WORDS.final}` : ''),
        state.settles.join('・'),
        state.summary ?? '',
      ]),
    ),
    table(
      FLOW_WORDS.transitionsHeaders,
      facts.transitions.map((transition) => [
        el('b', null, transition.label),
        transition.fromAnywhere ? FLOW_WORDS.anywhereCell : named(transition.from),
        named([transition.to]),
        join([...new Set(transition.by)].map(roleLabel), el('wbr', null)),
        el('span', { class: 'bf-nowrap' }, AUTONOMY_WORDS[transition.autonomy]),
        transition.origins.map(originWords).join('・'),
      ]),
      'bf-table--transitions',
    ),
    notes.length === 0
      ? null
      : el(
          'ul',
          { class: 'bf-notes' },
          notes.map((note) => el('li', null, note)),
        ),
  ]);
}

/** 章の頭の 1 文のうち、残りの節の在りかを言う語。 */
const DOMAIN_LEAD_ANCHOR = '旧い集約の章';

/** 頭の 1 文。残りの節の在りかを言う語(「旧い集約の章」)は、この集約が載る章へのリンクにする。 */
function leadWords(lead: string, domain: string | undefined): Child {
  const at = lead.indexOf(DOMAIN_LEAD_ANCHOR);
  if (domain === undefined || at < 0) return lead;
  return join([lead.slice(0, at), el('a', { href: url(domain) }, DOMAIN_LEAD_ANCHOR), lead.slice(at + DOMAIN_LEAD_ANCHOR.length)]);
}

/** 名前を引く口。 */
export interface ChapterNames {
  /** この集約が載る旧い集約の章(`../domain/{章}.html`)への URL。 */
  readonly domain?: string;
  readonly role: (role: string) => Html;
  readonly field: (field: string) => string;
  readonly entity: (entity: string) => string;
}

/**
 * 集約の章の本文。
 *
 * @param title 章の題
 * @param lead 章の頭の 1 文
 * @param flows 状態機械ごとの事実(宣言順)
 * @param access 操作と読み取りの事実
 * @param rules 不変条件の事実
 * @param names 名前を引く口
 */
export function aggregateChapter(
  title: string,
  lead: string,
  flows: readonly LifecycleFacts[],
  access: AggregateAccessFacts,
  rules: readonly InvariantFact[],
  names: ChapterNames,
): ChapterBody {
  const headings: PageHeading[] = [];
  const many = flows.length > 1;
  const flowSection =
    flows.length === 0
      ? null
      : section('flow', FLOW_WORDS.section, headings, () => [
          flows.map((facts) => (many ? subsection(`flow-${facts.machine}`, el('code', null, facts.machine), headings, () => [flow(facts, names.role)]) : flow(facts, names.role))),
        ]);
  const can =
    access.operations.length === 0
      ? section('can', ACCESS_WORDS.canSection, headings, () => [el('p', null, ACCESS_WORDS.noOperations)])
      : section('can', ACCESS_WORDS.canSection, headings, () => [
          el('p', { class: 'bf-note' }, ACCESS_WORDS.note),
          table(
            ACCESS_WORDS.canHeaders,
            mergedRows(
              access.operations.map((operation) => ({
                key: JSON.stringify([operation.kind, operation.event, operation.fields, operation.when ?? null, operation.accepted]),
                by: [...new Set(operation.by)],
                rest: [
                  operation.label.length > 0 ? operation.label : OPERATION_WORDS[operation.kind],
                  operation.fields.map(names.field).join('・'),
                  operation.when ?? '',
                  operation.accepted.map((entry) => `${ACCEPTED_WORDS[entry.kind]}: ${entry.text}`).join(' / '),
                ],
              })),
            ).map(({ by, rest }) => [
              el('b', null, rest[0] ?? ''),
              join(by.map(names.role), el('wbr', null)),
              rest[1] ?? '',
              code(rest[2] === '' ? undefined : rest[2]),
              rest[3] ?? '',
            ]),
          ),
        ]);
  const see =
    access.reads.length === 0
      ? section('see', ACCESS_WORDS.seeSection, headings, () => [el('p', null, ACCESS_WORDS.noReads)])
      : section('see', ACCESS_WORDS.seeSection, headings, () => [
          table(
            ACCESS_WORDS.seeHeaders,
            access.reads.map((read) => [
              names.role(read.by),
              scopeWords(read.scope, names.entity),
              read.filters
                .map((filter) =>
                  ACCESS_WORDS.filter(filter.entity === undefined ? names.field(filter.field) : `${names.entity(filter.entity)}の ${filter.field}`, filter.actorField),
                )
                .join('・'),
              code(read.when),
              read.hiddenFields.map(names.field).join('・'),
            ]),
          ),
        ]);
  const rule =
    rules.length === 0
      ? section('rules', RULE_WORDS.section, headings, () => [el('p', null, RULE_WORDS.none)])
      : section('rules', RULE_WORDS.section, headings, () => [
          el('p', { class: 'bf-note' }, RULE_WORDS.note),
          table(
            RULE_WORDS.headers,
            rules.map((fact) => [
              code(fact.id),
              fact.statement,
              fact.formal ?? RULE_WORDS.noFormal,
              join(
                fact.fields.map((field) => code(field)),
                text(' '),
              ),
              join(
                fact.enforcedBy.map((point) => code(`${point.kind}: ${point.ref}`)),
                text(' '),
              ),
              fact.categories.map((category) => INVARIANT_CATEGORY_WORDS[category]).join('・'),
            ]),
          ),
        ]);
  return {
    body: join([el('h1', null, title), el('p', { class: 'bf-lede' }, leadWords(lead, names.domain)), flowSection, can, see, rule]),
    headings,
  };
}

/** 状態の列の並び(本筋の段の番号順、そのあと番号の無い状態)。 */
function columns(facts: LifecycleFacts): readonly StateFact[] {
  const numbered = facts.states.filter((state) => state.step !== undefined).sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
  return [...numbered, ...facts.states.filter((state) => state.step === undefined)];
}

/** 全体の名前を引く口。 */
export interface OverviewNames {
  readonly aggregate: (aggregate: string) => string;
  readonly role: (role: string) => Html;
  /** 集約の章への相対の URL。 */
  readonly chapter: (aggregate: string) => string;
}

/**
 * 全体(`spec/index.html`)の本文。
 *
 * @param axes 流れの軸
 * @param flows 全集約の流れの事実
 * @param names 名前を引く口
 */
export function overviewChapter(axes: LifecycleAxes, flows: readonly LifecycleFacts[], names: OverviewNames): ChapterBody {
  const headings: PageHeading[] = [];
  const factsOf = (axis: MachineFollowers): LifecycleFacts | undefined => flows.find((facts) => facts.aggregate === axis.aggregate && facts.machine === axis.machine);
  const axisBlock = (axis: MachineFollowers, facts: LifecycleFacts): Html => {
    const states = columns(facts);
    return subsection(`axis-${axis.aggregate}-${axis.machine}`, join([names.aggregate(axis.aggregate), 'の ', el('code', null, axis.machine)]), headings, () => [
      el('p', null, OVERVIEW_WORDS.followers(axis.followers.map(names.aggregate).join('・'))),
      el('p', { class: 'bf-note' }, OVERVIEW_WORDS.matrixNote),
      table(
        [...OVERVIEW_WORDS.rowHeaders, ...states.map((state) => stateChip(facts, state))],
        mergedRows(
          axis.rules.map((rule) => ({
            key: JSON.stringify([rule.aggregate, rule.kind, rule.event, rule.states]),
            by: [...new Set(rule.by)],
            rest: [
              names.aggregate(rule.aggregate),
              rule.label.length > 0 ? rule.label : FOLLOW_KIND_WORDS[rule.kind],
              ...states.map((state) => (rule.states.includes(state.id) ? OVERVIEW_WORDS.open : OVERVIEW_WORDS.closed)),
            ],
          })),
        ).map(({ by, rest }) => [
          rest[0] ?? '',
          el('b', null, rest[1] ?? ''),
          join(by.map(names.role), el('wbr', null)),
          ...rest.slice(2).map((mark) => el('span', { class: 'bf-matrix-cell' }, mark)),
        ]),
        'bf-table--matrix',
      ),
    ]);
  };
  const axisBody = (): Html =>
    axes.axes.length === 0
      ? el('p', null, OVERVIEW_WORDS.noAxis)
      : join([
          axes.axes.length > 1 ? el('p', null, OVERVIEW_WORDS.manyAxes(axes.axes.length)) : null,
          axes.axes.map((axis) => {
            const facts = factsOf(axis);
            return facts === undefined ? null : axisBlock(axis, facts);
          }),
        ]);
  const list =
    axes.all.length === 0
      ? el('p', null, OVERVIEW_WORDS.noMachines)
      : table(
          OVERVIEW_WORDS.allHeaders,
          axes.all.map((machine) => {
            const facts = factsOf(machine);
            return [
              el('a', { href: url(names.chapter(machine.aggregate)) }, names.aggregate(machine.aggregate)),
              code(machine.machine),
              facts === undefined
                ? ''
                : columns(facts)
                    .filter((state) => state.step !== undefined)
                    .map((state) => state.label)
                    .join('、'),
              String(machine.followers.length),
            ];
          }),
        );
  return {
    body: join([
      el('h1', null, OVERVIEW_WORDS.title),
      el('p', { class: 'bf-lede' }, OVERVIEW_WORDS.lead),
      section('axis', OVERVIEW_WORDS.axisSection, headings, () => [el('p', null, OVERVIEW_WORDS.axisRule), axisBody()]),
      section('all', OVERVIEW_WORDS.allSection, headings, () => [list]),
    ]),
    headings,
  };
}
