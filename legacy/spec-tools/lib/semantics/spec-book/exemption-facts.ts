/**
 * ハンドブックの表紙の「理由をつけて外している守り」の事実 — 仕様の側が**理由つきで**既定の守りを外した・緩めた宣言を集める。
 *
 * 既定では守りがかかっていて、仕様が理由を書いたときだけ外せる宣言の全種類をここに並べる(手書きの一覧を作らない)。
 * 種類ごとの検査は次のとおりで、`accepted` は「verify が毎回、受け入れた危険として名指す」もの(`kernel/finding.ts` の `acceptance`。W5 が突き合わせる):
 *
 * | 種類 | 宣言 | 検査 | accepted |
 * |---|---|---|---|
 * | `mfa-exempt` | `auth_spec` の `mfa: { exempt: 理由 }` | H6 | ○ |
 * | `mfa-delegated` | `auth_spec` の `mfa: { delegated: { provider, evidence, reason } }`(IdP に任せる。根拠なし) | H6 | ○ |
 * | `mfa-roles` | `auth_spec` の `mfa: { require: { roles } }`(一部のロールにだけ求める) | H6 | — |
 * | `bearer-reusable` | エンティティの欄の `bearer: { reusable: 理由 }` | R16 | ○ |
 * | `public-write` | 遷移・`writes`・`deletes` の `public: 理由`(未ログインに開く書き込み) | R5-5 | — |
 * | `self-assign` | 遷移・`creates`・`writes` の `self_assign: 理由`(役の根拠の欄を書き手が書ける) | R2 | — |
 * | `tenant-accept` | `access_spec` の `accept`(テナント境界で狭めない読み取り) | V20 / V26 | — |
 * | `sessions-unbounded` | `auth_spec` の `sessions.concurrent.unbounded: 理由` | H5 | — |
 * | `local-only` | `auth_spec` の `local_only[]`(ローカルでだけ開ける方式) | H5 | — |
 * | `env-template` | `config_spec` の変数の `not_in_template_reason`(環境の雛形に行を置かない) | K2 | — |
 *
 * 種類を足すとき(例: ログの転送の外し方)は、ここに 1 行と words の語を足す。並びは上の表の順、同じ種類の中は宣言順。
 * 純粋関数だけ。**アプリの語彙は 1 語も持たない。**
 */

import type { SourceLocation } from '../../kernel/source-location.js';
import type { AuthFlowSpec } from '../../model/auth/types.js';
import type { ConfigCatalogSpec } from '../../model/config/types.js';
import type { SelfAssignDecl } from '../../model/types-common.js';
import type { SpecModel } from '../../model/types.js';

/** 外した守りの種類(表示の語は words の側が持つ)。 */
export type ExemptionKind =
  | 'mfa-exempt'
  | 'mfa-delegated'
  | 'mfa-roles'
  | 'bearer-reusable'
  | 'public-write'
  | 'self-assign'
  | 'tenant-accept'
  | 'sessions-unbounded'
  | 'local-only'
  | 'env-template';

/** どの仕様に書かれた宣言か(表紙からリンクする章を決める)。 */
export type ExemptionSource = 'auth' | 'config' | 'domain';

/** 外した守り 1 件。 */
export interface ExemptionFact {
  readonly kind: ExemptionKind;
  /** verify が毎回「受け入れた危険」として名指すか。 */
  readonly accepted: boolean;
  readonly source: ExemptionSource;
  /** ドメインの宣言なら集約。 */
  readonly aggregate?: string;
  /** 規則のロール(アクセスの規則の宣言だけ。ロールの id)。 */
  readonly by?: readonly string[];
  /** 遷移に書かれた宣言なら、その遷移の表示名(無ければ id)。 */
  readonly on?: string;
  /** 何に対する宣言か(仕様の語のまま。例: 遷移の表示名・欄の名前・方式・環境変数名・`mfa-roles` はロールの id)。無ければ種類だけで決まる。 */
  readonly subjects: readonly string[];
  /** 仕様に書かれた理由(`mfa-roles` は理由の欄が無いので要約)。 */
  readonly reason: string;
  readonly location: SourceLocation;
}


/** `self_assign` の宣言(書き手と欄を名指した 1 件ずつ)。 */
function selfAssignFacts(aggregate: string, decls: readonly SelfAssignDecl[] | undefined, on?: string): ExemptionFact[] {
  return (decls ?? []).map((decl) => ({
    kind: 'self-assign',
    accepted: false,
    source: 'domain',
    aggregate,
    by: decl.by,
    ...(on === undefined ? {} : { on }),
    subjects: [`${decl.entity}.${decl.field}`],
    reason: decl.reason,
    location: decl.location,
  }));
}

/** ドメイン(エンティティ・状態・アクセス)の宣言。 */
function domainFacts(model: SpecModel): ExemptionFact[] {
  const bearer: ExemptionFact[] = [];
  const publicWrites: ExemptionFact[] = [];
  const selfAssign: ExemptionFact[] = [];
  const tenant: ExemptionFact[] = [];
  for (const [aggregate, specs] of model.aggregates) {
    const base = { source: 'domain' as const, aggregate };
    for (const field of specs.entity?.fields ?? []) {
      if (field.bearer?.kind === 'reusable') bearer.push({ ...base, kind: 'bearer-reusable', accepted: true, subjects: [field.name], reason: field.bearer.reason, location: field.bearer.location });
    }
    for (const machine of specs.stateMachines) {
      for (const event of machine.events) {
        const on = event.label ?? event.id;
        if (event.public !== undefined) publicWrites.push({ ...base, kind: 'public-write', accepted: false, on, subjects: [], reason: event.public, location: event.location });
        selfAssign.push(...selfAssignFacts(aggregate, event.selfAssign, on));
      }
    }
    const access = specs.access;
    if (access === undefined) continue;
    for (const rule of access.writes) {
      if (rule.public !== undefined) publicWrites.push({ ...base, kind: 'public-write', accepted: false, by: [rule.by], subjects: rule.fields, reason: rule.public, location: rule.location });
      selfAssign.push(...selfAssignFacts(aggregate, rule.selfAssign));
    }
    for (const rule of access.deletes) {
      if (rule.public !== undefined) publicWrites.push({ ...base, kind: 'public-write', accepted: false, by: [rule.by], subjects: [], reason: rule.public, location: rule.location });
    }
    for (const rule of access.creates) {
      selfAssign.push(...selfAssignFacts(aggregate, rule.selfAssign));
    }
    for (const accept of access.accepts) {
      tenant.push({ ...base, kind: 'tenant-accept', accepted: false, by: [accept.by], subjects: [accept.field], reason: accept.reason, location: access.location });
    }
  }
  return [...bearer, ...publicWrites, ...selfAssign, ...tenant];
}

/** 認証フローの宣言(多要素認証・同時セッション・ローカルだけの方式)。 */
function authFacts(flow: AuthFlowSpec): { readonly mfa: ExemptionFact[]; readonly rest: ExemptionFact[] } {
  const base = { source: 'auth' as const };
  const mfa: ExemptionFact[] = [];
  if (flow.mfa?.kind === 'exempt') mfa.push({ ...base, kind: 'mfa-exempt', accepted: true, subjects: [], reason: flow.mfa.reason, location: flow.mfa.location });
  if (flow.mfa?.kind === 'delegated') mfa.push({ ...base, kind: 'mfa-delegated', accepted: true, subjects: [flow.mfa.provider], reason: flow.mfa.reason, location: flow.mfa.location });
  if (flow.mfa?.kind === 'require' && flow.mfa.scope.kind === 'roles') {
    mfa.push({ ...base, kind: 'mfa-roles', accepted: false, subjects: flow.mfa.scope.roles, reason: flow.mfa.summary, location: flow.mfa.location });
  }
  const rest: ExemptionFact[] = [];
  const concurrent = flow.sessions?.concurrent;
  if (concurrent?.kind === 'unbounded') rest.push({ ...base, kind: 'sessions-unbounded', accepted: false, subjects: [], reason: concurrent.reason, location: flow.location });
  for (const decl of flow.localOnly) rest.push({ ...base, kind: 'local-only', accepted: false, subjects: [decl.method], reason: decl.reason, location: flow.location });
  return { mfa, rest };
}

/** 環境の雛形に行を置かない変数(同じ理由はまとめる)。 */
function configFacts(catalog: ConfigCatalogSpec): ExemptionFact[] {
  const byReason = new Map<string, { subjects: string[]; location: SourceLocation }>();
  for (const variable of catalog.variables) {
    const reason = variable.notInTemplateReason;
    if (reason === undefined) continue;
    const group = byReason.get(reason);
    if (group === undefined) byReason.set(reason, { subjects: [variable.id], location: variable.location });
    else group.subjects.push(variable.id);
  }
  return [...byReason].map(([reason, { subjects, location }]) => ({ kind: 'env-template', accepted: false, source: 'config', subjects, reason, location }));
}

/**
 * 理由をつけて外している守りの全数(並びはモジュールの表の順)。
 *
 * @param model ドメイン仕様全体
 * @param flow 読めた認証フロー仕様(無ければ null)
 * @param catalog 読めた設定カタログ(無ければ null)
 */
export function exemptionFacts(model: SpecModel, flow: AuthFlowSpec | null, catalog: ConfigCatalogSpec | null): ExemptionFact[] {
  const auth = flow === null ? { mfa: [], rest: [] } : authFacts(flow);
  const domain = domainFacts(model);
  const order: readonly ExemptionKind[] = ['mfa-exempt', 'mfa-delegated', 'mfa-roles', 'bearer-reusable', 'public-write', 'self-assign', 'tenant-accept', 'sessions-unbounded', 'local-only', 'env-template'];
  const all = [...auth.mfa, ...domain, ...auth.rest, ...(catalog === null ? [] : configFacts(catalog))];
  return order.flatMap((kind) => all.filter((fact) => fact.kind === kind));
}
