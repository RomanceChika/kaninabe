/**
 * A1 `handles` の実在チェック。
 *
 * action-spec-writing.md の A1:「宣言されたドメインイベント ID が `state_spec` に存在する。
 * ただし予約 ID `{entity}.create` / `{entity}.delete` / `{entity}.update` は、対象エンティティの
 * `access_spec` に `creates` / `deletes` / `writes` が宣言されていることを実在条件とする」。
 *
 * `handles` は Server Action とドメインの唯一の接点であり、ここが接地していないと
 * 「どの状態から・誰が・どんな前提で実行できるか」を参照する先が無くなる。
 * 作成・削除・編集には遷移元の状態が無いため、接地先は状態機械ではなく access_spec になる。
 */

import type { Finding, TraceVerifier } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import type { ActionSpec } from '../../model/trace/types.js';
import type { TraceInput } from '../input.js';
import type { AccessOpEntry } from '../../semantics/domain-index.js';
import {
  findCreate,
  findDelete,
  findUpdate,
  isCreateId,
  isDeleteId,
  isUpdateId,
  listCreates,
  listDeletes,
  listEvents,
  listMachineNames,
  listUpdates,
} from '../../semantics/domain-index.js';

/** 予約 ID 1 種類分の接地規則(どの宣言に、どんな言葉で接地させるか)。 */
interface ReservedOp {
  /** 予約 ID の判定(例: `{entity}.create` か)。 */
  readonly matches: (id: string) => boolean;
  /** 対象 ID の宣言を引き当てる。 */
  readonly find: (input: TraceInput, id: string) => AccessOpEntry<unknown> | null;
  /** 宣言済みの予約 ID をすべて列挙する(メッセージの候補表示用)。 */
  readonly declared: (input: TraceInput) => string[];
  /** access_spec 上の宣言キー(例: "creates")。 */
  readonly key: string;
  /** 宣言が無いことの意味(例: "誰も作れない")。 */
  readonly denyMeaning: string;
  /** 宣言を足すときに書く YAML の断片。 */
  readonly snippet: string;
}

/** 予約 ID の一覧。作成・削除・編集の 3 種はいずれも access_spec に接地する。 */
const RESERVED_OPS: readonly ReservedOp[] = [
  {
    matches: isCreateId,
    find: (input, id) => findCreate(input.domain, id),
    declared: (input) => listCreates(input.domain).map((entry) => entry.id),
    key: 'creates',
    denyMeaning: '誰も作れない',
    snippet: 'creates: - by: {role_id}',
  },
  {
    matches: isDeleteId,
    find: (input, id) => findDelete(input.domain, id),
    declared: (input) => listDeletes(input.domain).map((entry) => entry.id),
    key: 'deletes',
    denyMeaning: '誰も消せない',
    snippet: 'deletes: - by: {role_id}',
  },
  {
    matches: isUpdateId,
    find: (input, id) => findUpdate(input.domain, id),
    declared: (input) => listUpdates(input.domain).map((entry) => entry.id),
    key: 'writes',
    denyMeaning: '誰も編集できない',
    snippet: 'writes: - by: {role_id} / fields: [{field_name}]',
  },
];

/** A1: handles が state_spec のイベント、または access_spec の宣言に接地しているかを検証する。 */
export const handlesExistenceVerifier: TraceVerifier = {
  id: 'A1',
  title: 'handles の実在 — 宣言したドメインイベントが state_spec か access_spec にある',

  verify(input: TraceInput): Finding[] {
    const known = new Set(listEvents(input.domain).map((entry) => entry.id));
    const findings: Finding[] = [];

    for (const action of input.actions.actions) {
      const reserved = RESERVED_OPS.find((op) => op.matches(action.handles.raw));
      if (reserved !== undefined) {
        const finding = checkReserved(action, input, reserved);
        if (finding !== null) findings.push(finding);
        continue;
      }
      if (known.has(action.handles.raw)) continue;
      findings.push(
        traceFinding('A1', {
          message: `handles のドメインイベント ${action.handles.raw} は state_spec に存在しません`,
          location: { file: action.location.file, pointer: 'handles' },
          suggestion: buildSuggestion(action.handles.machine, action.handles.event, input),
          counterexample: {
            handles: action.handles.raw,
            known_events: [...known].join(', ') || '(なし)',
          },
        }),
      );
    }
    return findings;
  },
};

/**
 * 予約 ID(`{entity}.create` / `.delete` / `.update`)の接地を見る。
 *
 * 実在条件は「対象エンティティの access_spec に対応する宣言が 1 つ以上ある」ことである。
 * 宣言が無い = deny by default なので、その操作の Server Action を置く根拠が無い。
 */
function checkReserved(action: ActionSpec, input: TraceInput, op: ReservedOp): Finding | null {
  if (op.find(input, action.handles.raw) !== null) return null;
  return traceFinding('A1', {
    message: `handles の ${action.handles.raw} に対応する ${op.key} が ${action.handles.machine} の access_spec にありません`,
    location: { file: action.location.file, pointer: 'handles' },
    suggestion:
      `specs/domain/${action.handles.machine}/access.md に "${op.snippet}" を追加する` +
      `(誰がその操作をしてよいかの正はドメイン仕様であり action_spec には書かない)。` +
      `${op.denyMeaning}ままにするなら、この action_spec ごと削除する`,
    counterexample: {
      handles: action.handles.raw,
      [`declared_${op.key}`]: op.declared(input).join(', ') || '(なし)',
    },
  });
}

/** 機械そのものが無いのか、機械はあってイベント名が違うのかで直し方を書き分ける。 */
function buildSuggestion(machine: string, event: string, input: TraceInput): string {
  const events = listEvents(input.domain).filter((entry) => entry.machine.machine === machine);
  if (events.length === 0) {
    const machines = listMachineNames(input.domain);
    return (
      `状態機械 ${machine} が specs/domain にありません。` +
      `state_machine: ${machine} の states.md を作るか、既存の機械(${machines.join(', ') || 'なし'})へ handles を直す`
    );
  }
  return (
    `状態機械 ${machine} に イベント ${event} がありません。` +
    `${machine} の states.md の events に ${event} を追加するか、既存のイベント(${events
      .map((entry) => entry.event.id)
      .join(', ')})へ handles を直す`
  );
}
