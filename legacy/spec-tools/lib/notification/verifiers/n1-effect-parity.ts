/**
 * N1 通知カタログ ⇔ 発火元(state_spec の `effects`・時刻で起きる走査の `emits`)の閉世界。
 *
 * notification-spec-writing.md の要求(発火元は 3 つ、`trigger` が「どの発火元を持つか」を宣言する):
 *   - `effects[].do` のうち `notify_` で始まる ID は、すべてカタログに行を持つこと
 *   - `trigger: auto` の行は、すべてどこかの `effects` から発火されること(従来)
 *   - `trigger: manual` の行は、`effects` にも走査の `emits` にも現れないこと(人が送る通知に自動発火は無い)
 *   - `trigger: schedule` の行は、`source: schedule` のジョブの `emits` から**だけ**発火されること
 *     (双方向。どの走査も積まない `schedule` は死んだ宣言であり、`effects` に現れたら `auto` との取り違え)
 *   - 走査の `emits` が名指す ID は、すべてカタログに行を持つこと
 *   - `auto` の通知を走査が `emits` で積み直すのは**許す**(承認待ちの催促のように、遷移が積む通知を
 *     時刻で積み直す形が宣言で表せる。`auto` の行は `effects` を持ち続ける)
 *
 * これが「暗黙の挙動の禁止」の機械化である。実装のハンドラ一覧との突合は
 * app 側のユニットテスト(notification-catalog.test.ts)が担い、
 * 仕様 ⇔ 実装の輪はそこで閉じる。
 *
 * `effects` の走査(`collectNotifyEffects`)は意味解析の層(`lib/semantics/effect-refs.ts`)にある ——
 * 通知本文の生成器も同じ走査を読むので、検証器のファイルには置かない。`emits` の走査(`emittedBy`)も
 * 同じ理由でジョブ側の共通部品(`lib/job/emits.ts`)にある。
 */

import type { SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import { collectNotifyEffects } from '../../semantics/effect-refs.js';
import { emittedBy } from '../../job/emits.js';
import { inputValue, type CatalogInput } from '../../kernel/input-state.js';
import type { JobCatalogSpec } from '../../model/job/types.js';
import type { NotificationDecl, NotificationSpecModel } from '../../model/notification/types.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'N1';

/** N1 の指摘を組み立てる。 */
function n1Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/**
 * カタログと発火元(`effects` / 走査の `emits`)を突き合わせる。
 *
 * @param domain 構築済みのドメイン仕様モデル
 * @param notifications 読み込み済みの通知カタログ
 * @param jobs ジョブカタログの入力の状態(走査の `emits` の出どころ。**阻害のとき**は、`schedule` の行を積む走査があるか(死んだ宣言)を出さない。
 *   欠けたモデルで「走査の emits がありません」と言うと偽の error になる。`effects` に依る判定と、`auto` の行の死んだ宣言は走査に依らないので実行し、
 *   読めた走査(仕様を落とした阻害の `partial`)の `emits` が名指す通知の突合も実行する。行は呼び手が言う)
 * @param roots 製品が宣言した根(道案内のパス)
 * @returns 違反のリスト
 */
export function verifyEffectParity(
  domain: SpecModel,
  notifications: NotificationSpecModel,
  jobs: CatalogInput<JobCatalogSpec>,
  roots: ProductRoots,
): Finding[] {
  const catalog = notifications.catalog;
  if (catalog === null) return [];

  const effects = collectNotifyEffects(domain);
  const declared = new Map(catalog.notifications.map((decl) => [decl.id, decl]));
  const firedIds = new Set(effects.map((ref) => ref.id));
  if (jobs.state === 'blocked') {
    // 走査が阻害: 読めた走査(仕様を落としたときの `partial`)の `emits` が未宣言の通知・manual の行を指すのは真の検出なので言う。
    // 止めるのは、走査が無いことに依る判定(`schedule` の行を積む走査があるか)だけ。
    const readable = jobs.partial ?? null;
    return [
      ...checkEffects(effects, declared, roots),
      ...checkEmits(emittedBy(readable), declared, readable, roots),
      ...checkDeadDeclarations(catalog.notifications, firedIds, null),
    ];
  }
  const jobCatalog = inputValue(jobs) ?? null; // 未選択は走査が事実として無い(空)
  const emitted = emittedBy(jobCatalog);
  return [
    ...checkEffects(effects, declared, roots),
    ...checkEmits(emitted, declared, jobCatalog, roots),
    ...checkDeadDeclarations(catalog.notifications, firedIds, emitted),
  ];
}

/** `effects` に現れる通知がカタログにあり、`manual` / `schedule` の行が自動発火されていないこと。 */
function checkEffects(
  effects: ReturnType<typeof collectNotifyEffects>,
  declared: ReadonlyMap<string, NotificationDecl>,
  roots: ProductRoots,
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const ref of effects) {
    const decl = declared.get(ref.id);
    if (decl === undefined) {
      if (seen.has(ref.id)) continue;
      seen.add(ref.id);
      findings.push(
        n1Finding({
          message: `${ref.event} の effects にある通知 ${ref.id} が通知カタログにありません`,
          location: ref.location,
          suggestion:
            `${specPath(roots, 'backend/notifications.md')} の notifications に "- id: ${ref.id}" の行を足す` +
            '(誰に何が飛ぶかを宣言しない通知は、どの仕様書にも現れない暗黙の挙動になる)',
          counterexample: { notification: ref.id, event: ref.event },
        }),
      );
      continue;
    }
    if (decl.trigger === 'manual') {
      findings.push(
        n1Finding({
          message: `${ref.id} は trigger: manual なのに ${ref.event} の effects から自動発火されています`,
          location: decl.location,
          suggestion:
            'trigger: auto に直すか、effects の do から外す(manual は「下書きを作って人が送る」の宣言であり、' +
            '自動発火と両立しない)',
          counterexample: { notification: ref.id, event: ref.event },
        }),
      );
    }
    if (decl.trigger === 'schedule') {
      findings.push(
        n1Finding({
          message: `${ref.id} は trigger: schedule なのに ${ref.event} の effects から発火されています`,
          location: decl.location,
          suggestion:
            'trigger: auto に直すか、effects の do から外す(schedule は「時刻で起きる走査が emits で積む」の宣言であり、' +
            '遷移の effects から積まれるものは auto である。遷移の通知を走査が積み直すなら、auto のまま走査の emits に書く)',
          counterexample: { notification: ref.id, event: ref.event },
        }),
      );
    }
  }
  return findings;
}

/** 走査の `emits` が名指す ID がカタログにあり、`manual` の行を積んでいないこと。 */
function checkEmits(
  emitted: ReadonlyMap<string, readonly string[]>,
  declared: ReadonlyMap<string, NotificationDecl>,
  jobs: JobCatalogSpec | null,
  roots: ProductRoots,
): Finding[] {
  const jobLocation = (scan: string) => jobs?.jobs.find((decl) => decl.id === scan)?.location;
  const findings: Finding[] = [];
  for (const [id, scans] of emitted) {
    const decl = declared.get(id);
    const location = jobLocation(scans[0] ?? '');
    if (location === undefined) continue;
    if (decl === undefined) {
      findings.push(
        n1Finding({
          message: `走査 ${scans.join(' / ')} の emits にある ${id} が通知カタログにありません`,
          location,
          suggestion:
            `${specPath(roots, 'backend/notifications.md')} の notifications に "- id: ${id} / trigger: schedule" の行を足す` +
            '(emits は積む通知の ID を名指す宣言であり、通知でない効果は書けない)',
          counterexample: { notification: id, jobs: scans.join(', ') },
        }),
      );
    } else if (decl.trigger === 'manual') {
      findings.push(
        n1Finding({
          message: `${id} は trigger: manual なのに走査 ${scans.join(' / ')} の emits から自動で積まれています`,
          location: decl.location,
          suggestion:
            'trigger: schedule に直すか、emits から外す(manual は「下書きを作って人が送る」の宣言であり、' +
            '時刻で積むことと両立しない)',
          counterexample: { notification: id, jobs: scans.join(', ') },
        }),
      );
    }
  }
  return findings;
}

/** 発火元を持たない `auto` / `schedule` の行(死んだ宣言)を落とす。`emitted` が null(ジョブカタログが阻害)なら `schedule` の行は見ない。 */
function checkDeadDeclarations(
  decls: readonly NotificationDecl[],
  fired: ReadonlySet<string>,
  emitted: ReadonlyMap<string, readonly string[]> | null,
): Finding[] {
  const findings: Finding[] = [];
  for (const decl of decls) {
    if (decl.trigger === 'auto' && !fired.has(decl.id)) {
      findings.push(
        n1Finding({
          message: `カタログの ${decl.id}(trigger: auto)を発火する effects がありません`,
          location: decl.location,
          suggestion:
            `どこかの state_spec の effects に "- on: {イベント} / do: [${decl.id}]" を足すか、` +
            '時刻で積むなら trigger: schedule にして走査の emits に書き、人が送る通知なら trigger: manual にする' +
            '(誰にも発火されない自動通知は死んだ宣言)',
          counterexample: { notification: decl.id },
        }),
      );
    }
    if (decl.trigger === 'schedule' && emitted !== null && !emitted.has(decl.id)) {
      findings.push(
        n1Finding({
          message: `カタログの ${decl.id}(trigger: schedule)を積む走査の emits がありません`,
          location: decl.location,
          suggestion:
            `ジョブカタログの source: schedule の行の emits に ${decl.id} を書く(時刻で積む走査を宣言する)か、` +
            '遷移で起きる通知なら trigger: auto にする(誰にも積まれない時刻起点の通知は死んだ宣言)',
          counterexample: { notification: decl.id },
        }),
      );
    }
  }
  return findings;
}
