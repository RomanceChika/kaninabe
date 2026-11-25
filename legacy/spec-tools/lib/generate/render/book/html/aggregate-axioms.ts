/**
 * 集約の章の公理の行(不変条件 1 本 = 1 行)と、ライフサイクルの段(状態 1 つ = 1 段)の HTML 版。
 *
 * 事実と語は `face-axioms.ts` / `face-stages.ts` / `face-guard-axioms.ts` のもので、原文の分解(`splitStatement`)・公理の行の `id`(`axiomAnchor`)・
 * 遷移に関係する公理(`guardAxioms`)はそれを呼ぶ。書き出し方は、段は `<ol class="bf-steps">`、リンクは `.html` へ張る。
 */

import type { AggregateSpecs, EventDef, InvariantDef, StateMachineSpec } from '../../../../model/types.js';
import { aggregateTitle } from '../chapters.js';
import { splitStatement, axiomAnchor } from '../face-axioms.js';
import { guardAxioms } from '../face-guard-axioms.js';
import { HANDS_HEADING, noException } from '../face-html.js';
import { specRelative } from '../face-sign.js';
import { stateName } from '../face-stages.js';
import { domainHref, link, roleWord, type DomainEnv } from './aggregate-env.js';
import { dash, fold, kv, kvs, mark, mono, pill, prose, valueOf } from './face-parts.js';
import { el, join, text, type Child, type Html } from './markup.js';

/** 主語(関わるエンティティを日本語名 + 内部名で)。 */
function subjectOf(env: DomainEnv, entities: readonly string[], labelled: boolean): Child {
  const labels = new Map<string, string>();
  for (const specs of env.model.aggregates.values()) if (specs.entity?.label !== undefined) labels.set(specs.entity.entity, specs.entity.label);
  return valueOf(
    entities.map((entity) => {
      const label = labelled ? labels.get(entity) : undefined;
      return label === undefined ? mono(entity) : join([`${label} `, mono(entity)]);
    }),
  );
}

/** 原本(範囲の中は「この章」、範囲の外は章へのリンク)。 */
function originOf(env: DomainEnv, invariant: InvariantDef, owner: AggregateSpecs | null): Child {
  const path = mono(specRelative(invariant.location.file, env.ctx));
  if (owner === null) return join(['この章 ', path]);
  return join([link(domainHref(env.layout, owner.name), aggregateTitle(owner.name, owner.entity?.label)), ' ', path]);
}

/** 公理の行の中身(ラベル行)。 */
function axiomRows(env: DomainEnv, invariants: readonly InvariantDef[], owner: AggregateSpecs | null): Html[] {
  const parts = invariants.map((invariant) => splitStatement(invariant.statement));
  const main = parts.flatMap((part) => part.main);
  const exceptions = parts.flatMap((part) => part.exceptions);
  const supplements = parts.flatMap((part) => part.supplements);
  const [first] = invariants;
  if (first === undefined) return [];
  const entities = invariants.length === 1 ? first.entities : [...new Set(invariants.flatMap((invariant) => invariant.entities))];
  const form = first.formal === undefined ? '式に写せない' : mono(first.formal.kind);
  return [
    kv('主語', subjectOf(env, entities, invariants.length === 1)),
    kv('決まること', valueOf(main)),
    kv('例外', exceptions.length === 0 ? noException(supplements.length > 0) : valueOf(exceptions)),
    ...(supplements.length === 0 ? [] : [kv('補足', valueOf(supplements))]),
    kv('形式', invariants.length > 1 ? join([form, ` ${invariants.length} 本`]) : form),
    kv('原本', originOf(env, first, owner)),
  ];
}

/** 公理 1 行(行頭に読み方の印 = 異議の場所)+ 直下の原文の折りたたみ。 */
function axiomBlock(env: DomainEnv, invariants: readonly InvariantDef[], owner: AggregateSpecs | null, short: boolean): Child[] {
  const [only] = invariants;
  const anchor = invariants.length === 1 && !short && only !== undefined ? axiomAnchor(only.id) : undefined;
  const text = (statement: string): string => statement.replace(/\s*\r?\n\s*/g, ' ').trim();
  const head = el(
    'div',
    { class: 'bf-axiom', ...(anchor === undefined ? {} : { id: anchor }) },
    el('div', { class: 'bf-id' }, invariants.map((invariant) => invariant.id).join(' / '), ' ', mark('axiom'), short ? el('span', { class: 'bf-from' }, '短い形') : null),
    el('div', { class: 'bf-st' }, kvs(axiomRows(env, invariants, owner))),
  );
  const quotes = invariants.map((invariant) =>
    invariants.length === 1 ? el('p', { class: 'bf-q' }, text(invariant.statement)) : el('p', { class: 'bf-q' }, el('b', null, invariant.id), ' ', text(invariant.statement)),
  );
  return [head, fold({ kind: 'orig', title: invariants.length === 1 ? '原文' : `原文 ${invariants.length} 本` }, quotes)];
}

/**
 * ある集約の公理を行にする。一意性(`uniqueness`)は短い形で 1 行にまとめる(読み方の印は必読のまま)。
 *
 * @param owner 原本の集約。章の範囲の中なら null
 */
export function axiomBlocks(env: DomainEnv, invariants: readonly InvariantDef[], owner: AggregateSpecs | null): Child[] {
  const regular = invariants.filter((invariant) => invariant.formal?.kind !== 'uniqueness');
  const short = invariants.filter((invariant) => invariant.formal?.kind === 'uniqueness');
  return [...regular.flatMap((invariant) => axiomBlock(env, [invariant], owner, false)), ...(short.length === 0 ? [] : axiomBlock(env, short, owner, true))];
}

/** 誰が(ロールの日本語名。名前が無いロールは等幅の id)。 */
function actors(env: DomainEnv, event: EventDef): Child {
  return join(
    event.by.map((role) => (env.roleName.has(role) ? roleWord(env, role) : mono(role))),
    text('、'),
  );
}

/** 遷移ガードの行と、関係する公理の行(あれば)。 */
function guardRows(env: DomainEnv, event: EventDef, machine: StateMachineSpec): Html[] {
  const related = guardAxioms(env.model, env.ctx, `${machine.machine}.${event.id}`).map((axiom) =>
    axiom.target === null ? mono(axiom.id) : link(`./${axiom.target.chapter}.html#${axiom.target.anchor}`, mono(axiom.id)),
  );
  return [kv('遷移ガード', event.guard === undefined ? dash() : mono(event.guard)), ...(related.length === 0 ? [] : [kv('関係する公理', valueOf(related))])];
}

/** 出る手 1 つ。 */
function hand(env: DomainEnv, event: EventDef, machine: StateMachineSpec): Html {
  const rows = [
    kv('誰が', actors(env, event)),
    kv('どこへ', join([pill(event.to, machine.stateTone[event.to] === 'negative'), ' ', stateName(machine, event.to)])),
    ...guardRows(env, event, machine),
  ];
  return el('li', null, el('span', { class: 'bf-hd' }, el('span', { class: 'bf-ev' }, event.id), event.label ?? event.id), rows);
}

/** 段 1 つの中身。 */
function stageBody(env: DomainEnv, machine: StateMachineSpec, state: string): Child[] {
  const settles = (machine.stateSettles[state] ?? []).map((id) => machine.settlesVocabulary[id] ?? id);
  const position = [...(machine.initial === state ? ['初期の段'] : []), ...(machine.final.includes(state) ? ['終端。ここから先へ進む手は無い'] : [])];
  const rows = [...(position.length === 0 ? [] : [kv('状態', valueOf(position))]), ...(settles.length === 0 ? [] : [kv('決まること', valueOf(settles))])];
  const hands = machine.events.filter((event) => event.from.includes(state));
  return [
    prose(machine.stateSummaries[state]),
    kvs(rows),
    el('p', { class: 'bf-label' }, HANDS_HEADING, ' ', el('span', { class: 'bf-n' }, hands.length)),
    hands.length === 0
      ? null
      : el(
          'ul',
          { class: 'bf-hands' },
          hands.map((event) => hand(env, event, machine)),
        ),
  ];
}

/** 状態機械 1 本の段の流れ(宣言順。悪い知らせの段はピルの色が変わる)。 */
export function steps(env: DomainEnv, machine: StateMachineSpec): Html {
  return el(
    'ol',
    { class: 'bf-steps' },
    machine.states.map((state, index) =>
      el(
        'li',
        { class: 'bf-step' },
        el(
          'div',
          { class: 'bf-step-head' },
          el('span', { class: 'bf-step-no' }, index + 1),
          pill(state, machine.stateTone[state] === 'negative'),
          el('b', { class: 'bf-step-label' }, stateName(machine, state)),
        ),
        el('div', { class: 'bf-step-body' }, stageBody(env, machine, state)),
      ),
    ),
  );
}

/** 横断する遷移 1 つ(誰が / いつ / どこへ / 遷移ガード / 関係する公理 / 補足)。 */
export function crossingBlock(
  env: DomainEnv,
  event: EventDef,
  machine: StateMachineSpec,
  extras: { readonly notices: readonly { readonly id: string; readonly summary: string }[]; readonly inputs: readonly string[] | null },
): Html {
  const notices = extras.notices.map((notice) => join([mono(notice.id), ` — ${notice.summary}`]));
  const inputs: Child =
    extras.inputs === null
      ? '(操作の仕様なし)'
      : extras.inputs.length === 0
        ? 'なし(対象の id だけ)'
        : join(
            extras.inputs.map((field) => mono(field)),
            text('、'),
          );
  const supplements = [join(['通知: ', notices.length === 0 ? 'なし' : join(notices, text('、'))]), join(['入力する欄: ', inputs])];
  const rows = [
    kv('誰が', actors(env, event)),
    kv('いつ', `${event.from.length} つの状態から。${event.from.map((id) => stateName(machine, id)).join('、')}`),
    kv('どこへ', join([pill(event.to, machine.stateTone[event.to] === 'negative'), ' ', stateName(machine, event.to)])),
    ...guardRows(env, event, machine),
    kv('補足', valueOf(supplements)),
  ];
  return join([el('p', { class: 'bf-group' }, event.label ?? event.id, el('small', null, `${machine.machine}.${event.id}`)), kvs(rows)]);
}
