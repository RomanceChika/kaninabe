/**
 * S10 ドメイン操作の UI 到達検査(画面版の A4)。
 *
 * screen-spec-writing.md の S10:「人間ロールが実行できる全ドメイン操作が、いずれかの
 * `screen_spec` の `actions` に現れる(現れないものは理由の明示を必須とする)」。
 *
 * A4 は「その操作に入口(Server Action)の仕様があるか」を問う。ここが問うのは
 * **その入口に人間がたどり着けるか**である。入口だけあって画面のどこからも呼ばれない操作は、
 * 仕様の上では完結しているのに利用者からは存在しない — その差が「作ったつもり」の正体であり、
 * 静的検査で数えられる唯一の形がこれである。
 *
 * 母集合は A4 と同じ導出に**編集(`{entity}.update`)を足したもの**である。A4 が `writes` を
 * 除くのは「宣言 1 本 = Server Action 1 本と機械的に言えない」ためだが、UI 到達では
 * 「どのフィールドをどう編集させるか」の粒度に関係なく**編集する画面が 1 枚もない**ことが
 * 言えてしまう(実際、v1 のメンバープロフィール編集がその状態にある)。粒度の問題ではなく
 * 有無の問題なので、こちらは数える。
 *
 * `by` が `system` だけの操作(Cron / Webhook 起点)は人間が起こすものではないので対象外。
 *
 * 免除は A4 の `unhandled` と同じ方式で、specs/frontend/screens/README.md のフロントマターに
 * `unexposed:` として理由つきで書く。**免除の一覧がそのまま「まだ画面が無い操作」の一覧**になり、
 * 消し忘れ(画面ができたのに宣言が残っている / 実在しない操作の宣言)は警告で拾う。
 */

import type { Finding, ScreenVerifier } from '../verifier.js';
import { screenFinding } from '../verifier.js';
import type { ExposureDecl, ScreenInput, ScreenSpec } from '../../model/screen/types.js';
import type { SpecModel } from '../../model/types.js';
import type {
  AccessOpEntry,
  CreateEntry,
  DeleteEntry,
  EventEntry,
  UpdateEntry,
} from '../../semantics/domain-index.js';
import {
  isHumanRole,
  listCreates,
  listDeletes,
  listEvents,
  listUpdates,
} from '../../semantics/domain-index.js';
import {
  listHumanCreates,
  listHumanDeletes,
  listHumanEvents,
  listHumanUpdates,
} from '../../trace/human-operations.js';
import { systemRoleId } from '../../model/role-hierarchy.js';
import { canonicalActionId } from '../../semantics/action-ground.js';
import { declaredActionIds } from '../../model/screen/declared-actions.js';

/** S10: 人間が起こせる全操作に、発火できる画面か理由宣言があるかを検証する。 */
export const domainExposureVerifier: ScreenVerifier = {
  id: 'S10',
  title: 'UI 到達の網羅 — 人間が起こせる全操作に、それを発火する画面か理由がある',

  verify(input: ScreenInput): Finding[] {
    // 画面をまだ仕様化していないリポジトリでは、全操作が未到達になるだけで意味が無い。
    // 「実装がまだ無い」ときに黙るのは S7 / S8 と同じ流儀である。
    if (!input.screens.available) return [];

    // 名前は突き合わせる前に正規化する。予約 ID は集約名でも entity 名でも書けるため
    // (`program.create` = `program_item.create`)、書かれたままの文字列で集合演算をすると
    // 別名で書いた側が「未到達」や「存在しない操作」に化ける。接地しない ID はそのまま残し、
    // 実在の指摘(S2)に任せる。
    const canonical = (id: string): string => canonicalActionId(input.domain, id) ?? id;
    const exposed = new Set([...exposedOperations(input.screens.screens)].map(canonical));
    const excused = new Map<string, ExposureDecl>(
      input.screens.unexposed.map((decl) => [canonical(decl.event), decl]),
    );
    const systemRole = systemRoleId(input.domain.roles.roles);
    const findings: Finding[] = [];

    for (const entry of listHumanEvents(input.domain)) {
      if (exposed.has(entry.id) || excused.has(entry.id)) continue;
      findings.push(missingEventExposure(entry, systemRole));
    }
    for (const entry of listHumanCreates(input.domain)) {
      if (exposed.has(entry.id) || excused.has(entry.id)) continue;
      findings.push(missingAccessOpExposure(entry, 'create', systemRole));
    }
    for (const entry of listHumanDeletes(input.domain)) {
      if (exposed.has(entry.id) || excused.has(entry.id)) continue;
      findings.push(missingAccessOpExposure(entry, 'delete', systemRole));
    }
    for (const entry of listHumanUpdates(input.domain)) {
      if (exposed.has(entry.id) || excused.has(entry.id)) continue;
      findings.push(missingAccessOpExposure(entry, 'update', systemRole));
    }
    findings.push(...staleExcuses(excused, exposed, input.domain));
    return findings;
  },
};

/**
 * 画面から発火できる操作の集合。
 *
 * 重ね表示(`overlays`)の `actions` も数える。モーダルの中のボタンも画面の一部であり、
 * そこからしか押せない操作(削除の確認ダイアログなど)を「未到達」と呼ぶのは嘘になる。
 */
function exposedOperations(screens: readonly ScreenSpec[]): ReadonlySet<string> {
  return new Set(screens.flatMap((screen) => [...declaredActionIds(screen)]));
}

/** 遷移イベントがどの画面にも現れない。 */
function missingEventExposure(entry: EventEntry, systemRoleId: string | undefined): Finding {
  return screenFinding('S10', {
    message: `${entry.id} は人間ロール(${humanRolesOf(entry.event.by, systemRoleId)})が実行できますが、どの画面の actions にも現れません`,
    location: { file: entry.event.location.file, pointer: `events.${entry.event.id}` },
    suggestion: exposureSuggestion(entry.id),
    counterexample: { event: entry.id, by: entry.event.by.join(', ') },
  });
}

/** 予約 ID の種類ごとの語彙(メッセージだけが違う)。 */
const ACCESS_OP_LABELS = {
  create: { verb: '作成', key: 'creates' },
  delete: { verb: '削除', key: 'deletes' },
  update: { verb: '編集', key: 'writes' },
} as const;

/** 作成 / 削除 / 編集がどの画面にも現れない。 */
function missingAccessOpExposure(
  entry: CreateEntry | DeleteEntry | UpdateEntry,
  op: keyof typeof ACCESS_OP_LABELS,
  systemRoleId: string | undefined,
): Finding {
  const { verb, key } = ACCESS_OP_LABELS[op];
  const roles = entry.rules.map((rule) => rule.by);
  return screenFinding('S10', {
    message: `${entry.entity} は人間ロール(${humanRolesOf(roles, systemRoleId)})が${verb}できますが、${entry.id} を発火する画面がありません`,
    location: { file: entry.access.location.file, pointer: key },
    suggestion: exposureSuggestion(entry.id),
    counterexample: { event: entry.id, by: roles.join(', ') },
  });
}

/**
 * 人間ロールだけを並べた表示用の文字列。
 *
 * access_spec は同じロールに条件違いの規則を複数書けるため(entry の `writes` が実例)、
 * 重複を畳んでから並べる。「performer, performer が編集できます」と出ると、
 * 読み手はロールが 2 つあると誤読する。
 */
function humanRolesOf(roles: readonly string[], systemRoleId: string | undefined): string {
  return [...new Set(roles.filter((id) => isHumanRole(id, systemRoleId)))].join(', ');
}

/** 直し方は「画面に足す」か「理由を書く」の 2 つしかない。 */
function exposureSuggestion(id: string): string {
  return (
    `その操作を発火する画面の screen_spec に "actions: - ${id}" を足す。` +
    'まだ画面を作らないなら specs/frontend/screens/README.md のフロントマターに ' +
    `"unexposed: - event: ${id} / reason: {理由}" を書く` +
    '(理由の一覧がそのまま「これから作る画面」の一覧になる)'
  );
}

/**
 * 用済みになった免除宣言を洗い出す。
 *
 * 画面ができたのに宣言が残っている / 実在しない操作の宣言がある、の 2 つ。
 * どちらも仕様の矛盾ではなく掃除漏れなので warning にする(A4 と同じ)。
 */
function staleExcuses(
  excused: ReadonlyMap<string, ExposureDecl>,
  exposed: ReadonlySet<string>,
  domain: SpecModel,
): Finding[] {
  const known = new Set([
    ...listEvents(domain).map((entry) => entry.id),
    ...ids(listCreates(domain)),
    ...ids(listDeletes(domain)),
    ...ids(listUpdates(domain)),
  ]);
  const findings: Finding[] = [];

  // 指摘に出す ID は**書かれたまま**(decl.event)にする。正規化後の名前で「この項目を消せ」と
  // 言われても、README にその文字列は無い。突合はキー(正規化済み)、表示は原文である。
  for (const [canonicalId, decl] of excused) {
    if (exposed.has(canonicalId)) {
      findings.push(
        screenFinding('S10', {
          severity: 'warning',
          message: `${decl.event} は画面の actions にあるのに unexposed の理由宣言が残っています`,
          location: decl.location,
          suggestion: `screens/README.md の unexposed から ${decl.event} の項目を削除する`,
          counterexample: { event: decl.event, reason: decl.reason },
        }),
      );
      continue;
    }
    if (known.has(canonicalId)) continue;
    findings.push(
      screenFinding('S10', {
        severity: 'warning',
        message: `unexposed に書かれた ${decl.event} は state_spec にも creates / deletes / writes にも存在しない操作です`,
        location: decl.location,
        suggestion: `ID の綴りを確認し、実在するもの(${[...known].join(', ') || 'なし'})へ直すか項目を削除する`,
        counterexample: { event: decl.event },
      }),
    );
  }
  return findings;
}

/** 予約 ID の一覧を取り出す(種類が違っても取り出すものは同じ)。 */
function ids<TRule>(entries: readonly AccessOpEntry<TRule>[]): string[] {
  return entries.map((entry) => entry.id);
}
