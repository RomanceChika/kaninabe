/**
 * 集約の章の上段 = **公理**(人が意味を判定するもの)の HTML 版。読み方の印は必読。
 *
 * 流れの段(図 + 段ごとのラベル行)・補足枠・この章の公理・従属する概念の公理・写した公理・今回変わった分を、この順に出す。
 * 事実と語は `face-upper.ts` などの共有の部品(`face-axioms.ts` / `face-stages.ts` / `face-facts.ts`)から引く。
 * 流れの図は mermaid でなく自前の SVG(`flow-diagram.ts`。新しい形の章の図と同じ)。アクセスの宣言と計算の早見表は `aggregate-rules.ts`。
 */

import type { AggregateSpecs, StateMachineSpec } from '../../../../model/types.js';
import { crossingEvents } from '../../state-machine-mermaid.js';
import { FLOW_WORDS } from '../spec/words.js';
import { crossingExtras } from '../domain-lifecycle.js';
import { aggregateLabel } from '../face-facts.js';
import { sectionAnchor } from '../face-scope.js';
import { CHANGE_SUBJECT, ownSignFiles } from '../face-upper.js';
import { axiomBlocks, crossingBlock, steps } from './aggregate-axioms.js';
import { domainHref, link, specHref, type DomainEnv } from './aggregate-env.js';
import { flowDiagram } from './flow-diagram.js';
import { fold, mark, mono, prose, pts } from './face-parts.js';
import { signFold, type Outline } from './layer-chapter.js';
import { el, join, text, type Child, type Html } from './markup.js';

/** 上段の導入の箇条。 */
export const UPPER_BULLETS: readonly Child[] = [
  'invariant は全部 必読',
  '不変条件のほかに、状態の段、アクセスの宣言、要約の文も公理',
  join(['人が判定するのは、', mono('statement'), ' と ', mono('formal'), ' が同じことを言っているかどうか']),
  '機械が保証するのは、文法と欄の実在と執行点の対応だけ',
  join(['一意性 ', mono('uniqueness'), ' は短い形で 1 行にまとめる。読み方の印は必読のまま']),
];

/** 標識の折りたたみ(仕様ファイルごと。標識が無ければ出さない)。 */
function signFolds(env: DomainEnv, files: readonly (string | undefined)[]): (Html | null)[] {
  return [...new Set(files.filter((file): file is string => file !== undefined))].map((file) => signFold(file, env.ctx, env.pageFile));
}

/** 状態機械 1 本の図(段と矢印。状態が無ければ null)。 */
function figure(env: DomainEnv, specs: AggregateSpecs, machine: StateMachineSpec): Html | null {
  const facts = env.lifecycle(specs.name, machine.machine);
  if (facts === undefined) return null;
  const anywhere = facts.transitions.some((transition) => transition.fromAnywhere);
  return flowDiagram(facts, FLOW_WORDS.figureNote + (anywhere ? FLOW_WORDS.figureAnywhere : ''));
}

/** ライフサイクルの節(本線 = 最初の状態機械)。状態機械が無ければ出さない。 */
export function flowSection(env: DomainEnv, outline: Outline): Child {
  const specs = env.facts.specs;
  const [main] = specs.stateMachines;
  if (main === undefined) return null;
  return [
    outline.h3('flow', `ライフサイクルの ${main.states.length} 段`),
    prose(main.summary),
    figure(env, specs, main),
    steps(env, main),
    signFolds(
      env,
      specs.stateMachines.map((machine) => machine.location.file),
    ),
  ];
}

/** 補足枠(第 2 以降の状態機械と、横断する遷移)。どちらも無ければ出さない。 */
export function sideboxSection(env: DomainEnv, outline: Outline): Child {
  const specs = env.facts.specs;
  const [main, ...rest] = specs.stateMachines;
  if (main === undefined) return null;
  const crossing = specs.stateMachines.flatMap((machine) => crossingEvents(machine).map((event) => crossingBlock(env, event, machine, crossingExtras(event, machine, env.ctx))));
  if (crossing.length === 0 && rest.length === 0) return null;
  return [
    outline.h3('sidebox', '補足枠 — 本線の外の動き'),
    pts([join(['本線は ', mono(main.machine), ' の段の流れ']), 'ここには、本線から外した動きを置く'], true),
    rest.map((machine) => [
      el('p', { class: 'bf-group' }, mono(machine.machine), ' ', el('small', null, `もう 1 つの状態機械・${machine.states.length} 段`)),
      prose(machine.summary),
      steps(env, machine),
      fold({ kind: 'detail', title: `図 — ${machine.machine}`, hint: '段と矢印だけ' }, [figure(env, specs, machine)]),
    ]),
    crossing.length === 0 ? null : [pts([`横断する遷移 ${crossing.length} 本`, 'どの段からでも起こせる動き。図には線を引かず、くわしくはここと遷移表が持つ'], true), crossing],
  ];
}

/** この章の公理(親の集約)。不変条件が 1 本以上あるときだけ節を出す(標識は有無に依らず出す)。 */
export function ownSection(env: DomainEnv, outline: Outline): Child {
  const { facts, model, ctx } = env;
  const signs = signFolds(env, ownSignFiles(model, facts, ctx, env.countKey));
  const group = facts.own.find((member) => member.specs === facts.specs);
  if (group === undefined) return signs;
  return [outline.h3('axioms', `${aggregateLabel(facts.specs)}の公理(${group.invariants.length})`), axiomBlocks(env, group.invariants, null), signs];
}

/** 写した公理(範囲の外の集約の公理で、この章のエンティティを含むもの)。 */
export function carriedSection(env: DomainEnv, outline: Outline): Child {
  const { facts } = env;
  if (facts.carried.length === 0) return null;
  const owners = [...new Map(facts.carried.map((entry) => [entry.owner.name, entry.owner])).values()];
  const entity = facts.specs.entity?.entity ?? facts.specs.name;
  return [
    outline.h3('carried', `写した公理(${facts.carried.length})`),
    pts(
      [
        '写す基準は機械で引ける',
        '範囲の外の集約の公理を見る',
        join([mono('entities'), ' に ', mono(entity), ' を含むものを、全部写す']),
        `内訳 ${owners.map((owner) => `${aggregateLabel(owner)} ${facts.carried.filter((entry) => entry.owner === owner).length}`).join('、')}`,
        '異議を出す先は原本。原本はラベル行に置いた',
      ],
      true,
    ),
    owners.map((owner) => [
      el('p', { class: 'bf-group' }, aggregateLabel(owner), el('small', null, owner.entity?.entity ?? owner.name)),
      axiomBlocks(
        env,
        facts.carried.filter((entry) => entry.owner === owner).map((entry) => entry.invariant),
        owner,
      ),
    ]),
  ];
}

/** 公理の側の差分 1 件。 */
function changeItem(change: NonNullable<DomainEnv['facts']['changes']>['items'][number]): Html {
  const tail = change.kind === 'added' ? ' が増えた' : change.kind === 'removed' ? ' が消えた' : ' の中身が変わった';
  return join([`${CHANGE_SUBJECT[change.element]} `, mono(change.key), tail]);
}

/** 今回変わった分。基点が無いときは数えない(0 とは書かない)。 */
export function changedSection(env: DomainEnv, outline: Outline): Child {
  const { changes } = env.facts;
  if (changes === null) {
    return [
      outline.h3('changed', join(['今回変わった(—) ', mark('changed')])),
      pts(
        [
          '基点が無いので、変わった分は数えない',
          join(['前回読了の記録は仕組みに無い。基点は ', mono('npm run generate -- --base <ref>'), ' の引数で渡す']),
          '数えるのは公理の側だけ',
          '不変条件の言明、状態の表示名、イベントの呼び名、要約の文、計算の例を比べる',
          join(['出どころは ', mono('spec:diff'), ' の「公理の側」と同じ']),
        ],
        true,
      ),
    ];
  }
  return [
    outline.h3('changed', join([`今回変わった(${changes.items.length}) `, mark('changed')])),
    pts(
      [
        join([`基点 `, mono(changes.ref), ' と比べた、この章の範囲の公理の側の動き']),
        ...(changes.items.length === 0 ? ['動いたものは無い'] : changes.items.map(changeItem)),
        ...(changes.items.length === 0
          ? [
              join([
                '0 は、不変条件の言明・状態の表示名・イベントの呼び名・要約の文・計算の例の差分が 0 の意味。access の絞り込みや計算式だけが動いた回も 0 になる(導出の側の差分は ',
                mono('spec:diff'),
                ' が見る)',
              ]),
            ]
          : []),
      ],
      true,
    ),
  ];
}

/** 従属する概念とその公理。節に畳んだ従属する集約を、親に近い順に出す。従属が無ければ出さない。 */
export function subordinateSection(env: DomainEnv, outline: Outline): Child {
  const { facts, model, layout } = env;
  const folded = facts.basis.folded;
  if (folded.length === 0) return null;
  const groups = new Map(facts.own.map((member) => [member.specs.name, member.invariants] as const));
  const total = [...groups].reduce((sum, [name, invariants]) => sum + (name === facts.specs.name ? 0 : invariants.length), 0);
  const names = (list: readonly AggregateSpecs[]): string => list.map(aggregateLabel).join('、');
  const foldedNames = new Set(folded.map((specs) => specs.name));
  const elsewhere = facts.basis.cascading.filter((specs) => !foldedNames.has(specs.name));
  const ownChapter = elsewhere.filter((specs) => !layout.ownership.owned.has(specs.name));
  const otherParent = elsewhere.filter((specs) => layout.ownership.owned.has(specs.name));
  const linked = (list: readonly AggregateSpecs[]): Html =>
    join(
      list.map((specs) => link(domainHref(layout, specs.name), aggregateLabel(specs))),
      text('、'),
    );
  const parentLabel = (member: AggregateSpecs): string => {
    const parent = layout.ownership.owned.get(member.name)?.parent;
    const specs = parent === undefined ? undefined : model.aggregates.get(parent);
    return specs === undefined ? '' : aggregateLabel(specs);
  };
  return [
    outline.h3('subordinate', total === 0 ? '従属する概念' : `従属する概念とその公理(${total})`),
    pts(
      [
        '従属の線は所有',
        join([`外部キーの `, mono('on delete cascade'), ` で、親を消すと一緒に消えるものは ${facts.basis.cascading.length} つ`]),
        '節に畳むのは、作るロールも消すロールも、生きている親の行を動かす人であるもの。内部実行のロールは比べない',
        `いま ${folded.length} つ。${names(folded)}`,
        ...(ownChapter.length === 0 ? [] : [join([`自分の章を持つのは ${ownChapter.length} つ。作るロールか消すロールが、親を動かす人の外にいる。`, linked(ownChapter)])]),
        ...(otherParent.length === 0
          ? []
          : [join([`別の章の節に畳んだのは ${otherParent.length} つ。従属先は別の親で、親が複数あれば入次数の多いほうを選ぶ。`, linked(otherParent)])]),
        ...(total === 0 ? [] : ['従属は、自分だけの公理を、ここで読む']),
      ],
      true,
    ),
    folded.map((member) => [
      el(
        'p',
        { class: 'bf-subhead', id: sectionAnchor(member.name) },
        aggregateLabel(member),
        el('small', null, `${member.entity?.entity ?? member.name} · 親 ${parentLabel(member)}`),
      ),
      el('p', { class: 'bf-note' }, link(specHref(member.name), '新しい形の章'), 'でも読める'),
      prose(member.entity?.summary),
      member.stateMachines.map((machine) => [
        el('p', { class: 'bf-group' }, mono(machine.machine), ' ', el('small', null, `状態機械・${machine.states.length} 段`)),
        prose(machine.summary),
        steps(env, machine),
      ]),
      axiomBlocks(env, groups.get(member.name) ?? [], null),
      signFolds(env, [
        member.entity?.location.file,
        ...member.stateMachines.map((machine) => machine.location.file),
        member.access?.location.file,
        member.invariants?.location.file,
      ]),
    ]),
  ];
}
