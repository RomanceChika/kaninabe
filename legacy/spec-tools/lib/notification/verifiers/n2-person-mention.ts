/**
 * N2 本人を名指すメンション(`person_from`)の接地。
 *
 * notification-spec-writing.md の要求(`mention` の語が `mentions_person` を宣言した行だけが `person_from` を持つ):
 *   - `person_from` の集約・欄が entity_spec に実在すること
 *   - その欄が**メンバーへの参照**(実行者の集約 = `session: true` を宣言した集約への `ref`)であること
 *   - その集約が**通知を起こした集約**であること(`effects` を宣言した集約 / 走査の `due_from` の集約)。
 *     配送は積まれたジョブの payload(その集約の行の ID)から欄を辿るので、別の集約の欄は辿れない
 *
 * 行と語の対・形・宛先がチャンネルであること(語彙だけで決まる分)は N0(ローダー)が見る。
 * ここはドメインの仕様が要る分だけである。「メンバー」という語を体系に持たないので、実行者の集約は
 * `session: true`(V13 が全域で 1 つに閉じる)で引く。
 */

import type { SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import { collectNotifyEffects } from '../../semantics/effect-refs.js';
import { findEntitySpec } from '../../semantics/domain-lookup.js';
import { actorEntity } from '../../usecase/param-source-facts.js';
import { emittedBy } from '../../job/emits.js';
import { inputValue, type CatalogInput } from '../../kernel/input-state.js';
import type { JobCatalogSpec } from '../../model/job/types.js';
import type { NotificationDecl, NotificationSpecModel } from '../../model/notification/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'N2';

/** N2 の指摘を組み立てる。 */
function n2Finding(decl: NotificationDecl, message: string, suggestion: string, extra: Record<string, string> = {}): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message,
    location: decl.location,
    suggestion,
    counterexample: { notification: decl.id, ...extra },
  };
}

/**
 * `person_from` を持つ通知を、ドメインの仕様と突き合わせる。
 *
 * @param domain 構築済みのドメイン仕様モデル
 * @param notifications 読み込み済みの通知カタログ
 * @param jobs ジョブカタログの入力の状態(走査の `due_from` = 発火元の集約。**阻害のとき**は走査の集約を数えず、`effects` の集約だけで突き合わせる
 *   — 別の集約が見つかれば真の違反で、見つからなくても走査の集約を見ていないことは呼び手が行で言う)
 * @returns 違反のリスト
 */
export function verifyPersonMention(
  domain: SpecModel,
  notifications: NotificationSpecModel,
  jobs: CatalogInput<JobCatalogSpec>,
): Finding[] {
  const catalog = notifications.catalog;
  if (catalog === null) return [];
  const actor = actorEntity(domain);
  const findings: Finding[] = [];
  for (const decl of catalog.notifications) {
    if (decl.personFrom === undefined) continue;
    const path = `${decl.personFrom.entity}.${decl.personFrom.field}`;
    const grounding = checkGrounding(domain, decl, path, actor);
    if (grounding !== null) {
      findings.push(grounding);
      continue;
    }
    const origin = originFinding(domain, decl, path, jobs);
    if (origin !== null) findings.push(origin);
  }
  return findings;
}

/** 集約・欄の実在と、欄がメンバーへの参照であること。通れば null。 */
function checkGrounding(domain: SpecModel, decl: NotificationDecl, path: string, actor: string | null): Finding | null {
  const personFrom = decl.personFrom;
  if (personFrom === undefined) return null;
  const entity = findEntitySpec(domain, personFrom.entity);
  if (entity === null) {
    return n2Finding(
      decl,
      `${decl.id} の person_from ${path} の集約 ${personFrom.entity} が entity_spec にありません`,
      '通知を起こした集約の名前を書く(その集約が持つメンバーへの参照の欄を指す)',
      { person_from: path },
    );
  }
  const field = entity.fields.find((candidate) => candidate.name === personFrom.field);
  if (field === undefined) {
    return n2Finding(
      decl,
      `${decl.id} の person_from ${path} の欄 ${personFrom.field} が ${entity.entity} にありません`,
      `${entity.entity} の entity_spec にある、メンバーへの参照の欄を書く`,
      { person_from: path },
    );
  }
  if (actor === null) {
    return n2Finding(
      decl,
      `${decl.id} は本人を名指しますが、実行者の集約(session: true を宣言した集約)がありません`,
      '本人のメンバー行を引くには、ログインしている人の集約を entity_spec の欄の session: true で宣言する',
      { person_from: path },
    );
  }
  if (field.type.kind !== 'ref' || field.type.entity !== actor) {
    return n2Finding(
      decl,
      `${decl.id} の person_from ${path} はメンバー(${actor})への参照ではありません`,
      `${path} の型を ref(${actor}) にするか、メンバーを指す欄を person_from に書く(名指す相手はメンバーの行から引く)`,
      { person_from: path, type: field.type.kind },
    );
  }
  return null;
}

/** 欄を持つ集約が、通知を起こした集約(`effects` の集約 / 走査の `due_from` の集約)であること。通れば null。 */
function originFinding(domain: SpecModel, decl: NotificationDecl, path: string, jobsInput: CatalogInput<JobCatalogSpec>): Finding | null {
  const personFrom = decl.personFrom;
  if (personFrom === undefined) return null;
  const target = findEntitySpec(domain, personFrom.entity)?.entity ?? personFrom.entity;
  const origins = new Set<string>();
  for (const ref of collectNotifyEffects(domain)) {
    if (ref.id === decl.id) origins.add(ref.aggregate);
  }
  // 走査の集約は読込済みのときだけ数える(阻害は欠けているので数えない。未選択は走査が事実として無い)。
  const jobs = inputValue(jobsInput) ?? null;
  for (const scan of emittedBy(jobs).get(decl.id) ?? []) {
    const dueFrom = jobs?.jobs.find((job) => job.id === scan)?.schedule?.dueFrom;
    const entity = dueFrom?.split('.')[0];
    if (entity !== undefined) origins.add(findEntitySpec(domain, entity)?.entity ?? entity);
  }
  const foreign = [...origins].filter((origin) => origin !== target);
  if (foreign.length === 0) return null;
  return n2Finding(
    decl,
    `${decl.id} の person_from ${path} の集約 ${target} は、通知を起こす集約(${foreign.join(' / ')})ではありません`,
    '配送は積まれたジョブの payload(通知を起こした集約の行の ID)から欄を辿るので、person_from はその集約自身の欄を指す' +
      '(別の集約の欄が要るなら、その集約の遷移から通知を起こす)',
    { person_from: path, origins: foreign.join(', ') },
  );
}
