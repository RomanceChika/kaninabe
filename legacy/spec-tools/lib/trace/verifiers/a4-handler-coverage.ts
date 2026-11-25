/**
 * A4 ハンドラの網羅チェック。
 *
 * action-spec-writing.md の A4:「人間ロールが実行できる全イベントに `action_spec` が
 * 1 つ以上ある(無い場合は理由の明示を必須とする)。`creates` / `deletes` を宣言した
 * エンティティには予約 ID `{entity}.create` / `{entity}.delete` の `action_spec` を
 * 同じ条件で要求する」。
 *
 * 人間が UI から起こせる遷移は、必ずどこかの Server Action が入口になる。入口の仕様が
 * 無いまま実装が増えると、境界で受けるもの・返すものが仕様に残らない。
 * 「作れる」「消せる」と宣言しておいてその入口が無い状態も同じ穴なので、
 * creates / deletes も網羅の対象にする。
 * ただし「まだ作らない」判断自体は正当なので、理由を宣言すれば免除する
 * (specs/backend/actions/README.md のフロントマター `unhandled`)。
 *
 * `writes`(状態を変えない編集)は網羅の対象にしない。編集は「どのフィールドを」まで含めて
 * 1 操作の粒度が決まるため、宣言 1 本 = Server Action 1 本と機械的には言えないからである。
 *
 * `by` が `system` だけのイベント(Cron / Webhook 起点)は Server Action の対象外なので
 * 網羅の対象にしない。creates / deletes も同様に system だけの宣言は対象外とする。
 */

import type { Finding, TraceVerifier } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import type { TraceInput } from '../input.js';
import type { UnhandledDecl } from '../../model/trace/types.js';
import type { CreateEntry, DeleteEntry, EventEntry } from '../../semantics/domain-index.js';
import { isHumanRole, listCreates, listDeletes, listEvents, listUpdates } from '../../semantics/domain-index.js';
import { listHumanCreates, listHumanDeletes, listHumanEvents } from '../human-operations.js';
import { systemRoleId } from '../../model/role-hierarchy.js';

/** A4: 人間ロールが実行できる操作に action_spec か理由宣言があるかを検証する。 */
export const handlerCoverageVerifier: TraceVerifier = {
  id: 'A4',
  title: 'ハンドラの網羅 — 人間が起こせる全操作に action_spec か理由がある',

  verify(input: TraceInput): Finding[] {
    const handled = new Set(input.actions.actions.map((action) => action.handles.raw));
    const excused = new Map<string, UnhandledDecl>(
      input.actions.unhandled.map((decl) => [decl.event, decl]),
    );
    const systemRole = systemRoleId(input.domain.roles.roles);
    const findings: Finding[] = [];

    for (const entry of listHumanEvents(input.domain)) {
      if (handled.has(entry.id) || excused.has(entry.id)) continue;
      findings.push(missingHandlerFinding(entry, systemRole));
    }
    for (const entry of listHumanCreates(input.domain)) {
      if (handled.has(entry.id) || excused.has(entry.id)) continue;
      findings.push(missingAccessOpHandlerFinding(entry, 'create', systemRole));
    }
    for (const entry of listHumanDeletes(input.domain)) {
      if (handled.has(entry.id) || excused.has(entry.id)) continue;
      findings.push(missingAccessOpHandlerFinding(entry, 'delete', systemRole));
    }
    findings.push(...staleExcuses(excused, handled, input));
    return findings;
  },
};

/** action_spec も理由宣言も無いイベントの Finding。 */
function missingHandlerFinding(entry: EventEntry, systemRoleId: string | undefined): Finding {
  const humanRoles = entry.event.by.filter((id) => isHumanRole(id, systemRoleId));
  return traceFinding('A4', {
    message: `${entry.id} は人間ロール(${humanRoles.join(', ')})が実行できますが、action_spec がありません`,
    location: { file: entry.event.location.file, pointer: `events.${entry.event.id}` },
    suggestion:
      `specs/backend/actions/${entry.machine.machine}/${entry.event.id}.md を作る。` +
      `まだ作らないなら specs/backend/actions/README.md のフロントマターに ` +
      `"unhandled: - event: ${entry.id} / reason: {理由}" を書く`,
    counterexample: { event: entry.id, by: entry.event.by.join(', ') },
  });
}

/** 予約 ID の種類ごとの語彙(メッセージと宣言キーだけが違う)。 */
const ACCESS_OP_LABELS = {
  create: { verb: '作成', key: 'creates' },
  delete: { verb: '削除', key: 'deletes' },
} as const;

/** creates / deletes を宣言しているのに対応する action_spec も理由宣言も無い場合の Finding。 */
function missingAccessOpHandlerFinding(
  entry: CreateEntry | DeleteEntry,
  op: keyof typeof ACCESS_OP_LABELS,
  systemRoleId: string | undefined,
): Finding {
  const { verb, key } = ACCESS_OP_LABELS[op];
  const humanRoles = entry.rules.map((rule) => rule.by).filter((id) => isHumanRole(id, systemRoleId));
  return traceFinding('A4', {
    message: `${entry.entity} は人間ロール(${humanRoles.join(', ')})が${verb}できますが、${entry.id} の action_spec がありません`,
    location: { file: entry.access.location.file, pointer: key },
    suggestion:
      `specs/backend/actions/${entry.entity}/${op}.md を作る(handles: ${entry.id})。` +
      `まだ作らないなら specs/backend/actions/README.md のフロントマターに ` +
      `"unhandled: - event: ${entry.id} / reason: {理由}" を書く`,
    counterexample: { event: entry.id, by: entry.rules.map((rule) => rule.by).join(', ') },
  });
}

/**
 * 用済みになった免除宣言を洗い出す。
 *
 * action_spec ができたのに宣言が残っている / 実在しない操作の宣言がある、の 2 つ。
 * どちらも仕様の矛盾ではなく掃除漏れなので warning にする。
 */
function staleExcuses(
  excused: ReadonlyMap<string, UnhandledDecl>,
  handled: ReadonlySet<string>,
  input: TraceInput,
): Finding[] {
  // 網羅の母集合に編集(`writes`)は入らないが、**実在する操作の集合**には入る。
  // `{entity}.update` の action_spec を「まだ作らない」と宣言することは正当であり、
  // それを「存在しない操作」と警告してはならない(母集合と実在集合は別物である)。
  const known = new Set([
    ...listEvents(input.domain).map((entry) => entry.id),
    ...listCreates(input.domain).map((entry) => entry.id),
    ...listDeletes(input.domain).map((entry) => entry.id),
    ...listUpdates(input.domain).map((entry) => entry.id),
  ]);
  const findings: Finding[] = [];

  for (const [event, decl] of excused) {
    if (handled.has(event)) {
      findings.push(
        traceFinding('A4', {
          severity: 'warning',
          message: `${event} には action_spec があるのに unhandled の理由宣言が残っています`,
          location: decl.location,
          suggestion: `README.md の unhandled から ${event} の項目を削除する`,
          counterexample: { event, reason: decl.reason },
        }),
      );
      continue;
    }
    if (known.has(event)) continue;
    findings.push(
      traceFinding('A4', {
        severity: 'warning',
        message: `unhandled に書かれた ${event} は state_spec にも creates / deletes / writes にも存在しない操作です`,
        location: decl.location,
        suggestion: `ID の綴りを確認し、実在するもの(${[...known].join(', ') || 'なし'})へ直すか項目を削除する`,
        counterexample: { event },
      }),
    );
  }
  return findings;
}
