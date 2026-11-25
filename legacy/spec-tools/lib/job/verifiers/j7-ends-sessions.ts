/**
 * J7 セッションを終える効果の宣言(R11 · ASVS V7.4.2)— `ends_sessions` が指す集約・発火元・語の 3 点と、
 * **アカウントを止める遷移がそれを宣言していること**。
 *
 * 効果カタログの行が `ends_sessions: {集約}` を持つとは、「この効果は、遷移した行の持ち主(その集約の行の id =
 * 認証基盤のアカウントの id)のログイン状態を全部終える」と**機械が読める形で宣言する**ことである(書き込みと同じ
 * トランザクションで実現される種別。キューには積まれない)。無効化・退会・消去でセッションが残る(アカウントを
 * 止めたのに、旧い端末が入り続ける)穴は、これまで各製品が手で塞ぐか忘れるかだった。この検査は 2 方向を見る。
 *
 * ## 宣言そのもの(J5 の `anonymizes` と同形)
 *
 * | 見ること | なぜ |
 * |---|---|
 * | `ends_sessions` の集約が実在し、**認証フローの主語**(サインインの決定表の主語の集約)である | ログイン状態を持つのは認証の主語だけである。別の集約の id は認証基盤のアカウントの id ではない |
 * | その効果が**その集約の状態機械の `effects`** から積まれる(`writes[].effects` には載せない) | 効果が起きる遷移が無ければ誰も起こさない。他の集約の遷移から積まれると「自分の行の持ち主」が嘘になる |
 * | `kind` の語が `in_transaction` を宣言している | 呼び出しは遷移と同じトランザクションで起きる(キューに積むと、再試行の間にログイン状態が残る隙間が開く) |
 * | 1 つの集約にセッションを終える効果は 1 つ | 遷移の本文が呼ぶ関数は集約ごとに 1 つにする |
 * | `kind` の語の `declares: [ends_sessions]` と行の `ends_sessions` が対である | 機械が読むのはキーの有無だけで、語はカタログが宣言する(J5 と同じ形) |
 *
 * ## R11 — アカウントを止める遷移は宣言しなければならない(error)
 *
 * 認証フローの主語が**状態機械**のとき、その機械の次の遷移は、`ends_sessions` の効果を `effects` に持たなければならない:
 *
 * - **終端の状態(`final`)へ行く遷移** — 戻れない結末(退会・消去)
 * - **`tone: negative` の状態へ行く遷移** — 否定的な結末(無効化・凍結)。tone は「無条件で確認が要る」否定の段の宣言で、
 *   ログインを止める段と同じものを指す
 * - **その集約を匿名化する効果(`anonymizes`)を持つ遷移** — 個人データを消すのに、旧い端末が入り続けてはならない
 *
 * 一時停止(休会など、本人が戻せる段)は tone も終端も持たないので課さない。宣言された `ends_sessions` の効果が 1 つも無い製品でも、
 * 該当する遷移があれば error になる(= 「宣言を忘れた」は、効果が 1 本も無い状態で最も起きやすい)。
 * 主語が enum の欄(`kind: field`)のときは遷移を持たないので、この向きは見ない(宣言そのものの接地だけ見る)。
 */

import type { Finding } from '../../kernel/finding.js';
import { collectJobEffects } from '../../semantics/effect-refs.js';
import { subjectAxis } from '../../model/auth/types.js';
import type { AuthFlowSpec, AuthSpecModel } from '../../model/auth/types.js';
import type { AggregateSpecs, SpecModel } from '../../model/types.js';
import type { StateMachineSpec } from '../../model/types-state.js';
import type { JobCatalogSpec, JobDecl, JobSpecModel } from '../../model/job/types.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';
import { declaresMismatches } from '../declares.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'J7';

/** J7 の指摘を組み立てる。 */
function j7Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** 認証フローの主語がどの集約か(集約のキー)。決まらない(認証仕様が無い・主語の軸が読めない・実在しない)ときは null。 */
export function subjectAggregateOf(domain: SpecModel, auth: AuthFlowSpec | null): string | null {
  const axis = auth === null ? undefined : subjectAxis(auth);
  if (axis?.of === undefined) return null;
  if (axis.kind === 'state') {
    for (const [key, specs] of domain.aggregates) {
      if (specs.stateMachines.some((machine) => machine.machine === axis.of)) return key;
    }
    return null;
  }
  const entity = axis.of.split('.')[0] ?? '';
  return domain.aggregates.has(entity) ? entity : null;
}

/** 集約の状態機械の `effects` に並ぶジョブ ID。 */
function machineEffectIds(specs: AggregateSpecs): readonly string[] {
  return specs.stateMachines.flatMap((machine) => machine.effects.flatMap((effect) => effect.do));
}

/** 宣言された対象の集約が認証フローの主語であること(認証仕様が読めるときだけ)。 */
function checkSubject(decl: JobDecl, target: string, subject: string | null, domain: SpecModel, auth: AuthFlowSpec | null): Finding[] {
  if (!domain.aggregates.has(target)) {
    return [
      j7Finding({
        message: `${decl.id} の ends_sessions ${target} は、仕様に無い集約です`,
        location: decl.location,
        suggestion: 'ends_sessions に実在する集約の id(認証基盤のアカウントの id を行の id に持つ集約)を書く',
        counterexample: { job: decl.id, ends_sessions: target },
      }),
    ];
  }
  if (auth === null || subject === target) return [];
  return [
    j7Finding({
      message: `${decl.id} の ends_sessions ${target} は、認証フローの主語の集約${subject === null ? '' : `(${subject})`}ではありません`,
      location: decl.location,
      suggestion:
        'ログイン状態を持つのは認証フローの主語(auth_spec の subject)の集約だけである。' +
        `ends_sessions を主語の集約${subject === null ? '' : ` ${subject}`} に直すか、別の効果なら ends_sessions を外す`,
      counterexample: { job: decl.id, ends_sessions: target, subject: subject ?? '' },
    }),
  ];
}

/** その効果が対象の集約の状態機械の `effects` から積まれ、他の集約からも `writes[].effects` からも積まれないこと。 */
function checkFiredFromTarget(decl: JobDecl, target: string, domain: SpecModel): Finding[] {
  const own = domain.aggregates.get(target);
  if (own === undefined) return [];
  const ownFires = machineEffectIds(own).includes(decl.id);
  const findings: Finding[] = [];
  if (!ownFires && collectJobEffects(domain).some((ref) => ref.id === decl.id)) {
    findings.push(
      j7Finding({
        message: `${decl.id}(ends_sessions: ${target})が ${target} の状態機械の effects から積まれていません`,
        location: decl.location,
        suggestion: `${target} の state_spec の effects に "- on: {アカウントを止める遷移} / do: [${decl.id}]" を書く(writes[].effects には載せない)`,
        counterexample: { job: decl.id, ends_sessions: target },
      }),
    );
  }
  if (ownFires && own.access?.writes.some((rule) => (rule.effects ?? []).includes(decl.id)) === true) {
    findings.push(
      j7Finding({
        message: `${decl.id}(ends_sessions: ${target})が ${target} の writes[].effects にも載っています`,
        location: decl.location,
        suggestion: 'セッションを終える効果は状態遷移の effects にだけ載せる(writes[].effects は状態遷移を持たない編集の口)。writes[].effects から外す',
        counterexample: { job: decl.id, ends_sessions: target },
      }),
    );
  }
  for (const [key, specs] of domain.aggregates) {
    if (key === target || !machineEffectIds(specs).includes(decl.id)) continue;
    findings.push(
      j7Finding({
        message: `${decl.id}(ends_sessions: ${target})が別の集約 ${key} の状態機械の effects から積まれています`,
        location: decl.location,
        suggestion: `セッションを終える宣言は自分の集約の遷移で起きる効果である。${key} の effects から外すか、${key} 側は別の効果(ends_sessions: ${key})として宣言する`,
        counterexample: { job: decl.id, ends_sessions: target, firedFrom: key },
      }),
    );
  }
  return findings;
}

/** 語が `in_transaction` を宣言していること。 */
function checkInTransaction(decl: JobDecl, target: string, roots: ProductRoots): Finding[] {
  if (decl.inTransaction === true) return [];
  return [
    j7Finding({
      message: `${decl.id}(ends_sessions: ${target})の kind ${decl.kind} が in_transaction を宣言していません`,
      location: decl.location,
      suggestion:
        `${specPath(roots, 'backend/jobs.md')} の vocabulary.kind の ${decl.kind} に "in_transaction: true" を足す` +
        '(セッションを終える呼び出しは遷移と同じトランザクションで起きる。キューに積むと、再試行の間にログイン状態が残る隙間が開く)',
      counterexample: { job: decl.id, kind: decl.kind, ends_sessions: target },
    }),
  ];
}

/** 1 つの集約にセッションを終える効果が 2 つ以上無いこと。 */
function checkOnePerAggregate(ending: readonly JobDecl[]): Finding[] {
  const byTarget = new Map<string, JobDecl[]>();
  for (const decl of ending) byTarget.set(decl.endsSessions ?? '', [...(byTarget.get(decl.endsSessions ?? '') ?? []), decl]);
  return [...byTarget].flatMap(([target, decls]) =>
    decls.slice(1).map((decl) =>
      j7Finding({
        message: `${target} のセッションを終える効果が複数あります(${decls.map((d) => d.id).join(' / ')})`,
        location: decl.location,
        suggestion: '1 つの集約にセッションを終える効果は 1 つ(遷移の本文が呼ぶ関数は集約ごとに 1 つ)。効果を 1 つにまとめる',
        counterexample: { ends_sessions: target, jobs: decls.map((d) => d.id).join(', ') },
      }),
    ),
  );
}

/** `kind` の語の `declares: [ends_sessions]` と行の `ends_sessions` が対であること(J5 と同じ形)。 */
function checkDeclaresPairing(catalog: JobCatalogSpec, roots: ProductRoots): Finding[] {
  const jobsPath = specPath(roots, 'backend/jobs.md');
  return declaresMismatches(catalog, 'ends_sessions', (decl) => decl.endsSessions !== undefined).map(({ decl, problem }) =>
    problem === 'missing'
      ? j7Finding({
          message: `${decl.id} の kind ${decl.kind} は ends_sessions を必ず持つ語(declares)なのに、ends_sessions がありません`,
          location: decl.location,
          suggestion: `セッションを終える効果なら ends_sessions と platform_call を書く。違う種類の効果なら、${jobsPath} で別の kind の語を宣言して選ぶ`,
          counterexample: { job: decl.id, kind: decl.kind },
        })
      : j7Finding({
          message: `${decl.id} は ends_sessions を持つのに、kind ${decl.kind} が ends_sessions を declares していません`,
          location: decl.location,
          suggestion: `${jobsPath} の vocabulary.kind の ${decl.kind} に "declares: [ends_sessions]" を足す(語を選べば宣言が付いてくる形にする)`,
          counterexample: { job: decl.id, kind: decl.kind, ends_sessions: decl.endsSessions ?? '' },
        }),
  );
}

/** 遷移 1 つが、アカウントを止めるもの(R11 の対象)か。理由の語を返す(対象でなければ null)。 */
function stoppingReason(machine: StateMachineSpec, event: string, anonymizing: ReadonlySet<string>): string | null {
  const def = machine.events.find((candidate) => candidate.id === event);
  if (def === undefined) return null;
  if (machine.final.includes(def.to)) return `終端の状態 ${def.to} へ行く`;
  if (machine.stateTone[def.to] === 'negative') return `tone: negative の状態 ${def.to} へ行く`;
  const effects = machine.effects.filter((effect) => effect.on === event).flatMap((effect) => effect.do);
  if (effects.some((id) => anonymizing.has(id))) return '個人データを匿名化する';
  return null;
}

/** R11: アカウントを止める遷移が、セッションを終える効果を宣言している。 */
function checkStoppingTransitions(domain: SpecModel, catalog: JobCatalogSpec, auth: AuthFlowSpec | null, roots: ProductRoots): Finding[] {
  const subject = subjectAggregateOf(domain, auth);
  const specs = subject === null ? undefined : domain.aggregates.get(subject);
  if (subject === null || specs === undefined || auth === null || subjectAxis(auth)?.kind !== 'state') return [];
  const ending = new Set(catalog.jobs.filter((decl) => decl.endsSessions === subject).map((decl) => decl.id));
  const anonymizing = new Set(catalog.jobs.filter((decl) => decl.anonymizes === subject).map((decl) => decl.id));
  const findings: Finding[] = [];
  for (const machine of specs.stateMachines.filter((candidate) => candidate.machine === subjectAxis(auth)?.of)) {
    for (const event of machine.events) {
      const reason = stoppingReason(machine, event.id, anonymizing);
      const declared = machine.effects.some((effect) => effect.on === event.id && effect.do.some((id) => ending.has(id)));
      if (reason === null || declared) continue;
      findings.push(
        j7Finding({
          message: `${machine.machine}.${event.id} は${reason}遷移(アカウントを止める)ですが、セッションを終える効果(ends_sessions: ${subject})を effects に宣言していません`,
          location: event.location,
          suggestion:
            `${specPath(roots, 'backend/jobs.md')} に kind が declares: [ends_sessions] の効果(ends_sessions: ${subject} / platform_call / realized_by)を宣言し、` +
            `${machine.machine} の effects に "- on: ${event.id} / do: [{その効果}]" を足す(ASVS V7.4.2: アカウントの無効化・削除で全セッションを終える。` +
            '旧い端末のセッションが残ると、止めたアカウントが入り続ける)',
          counterexample: { event: `${machine.machine}.${event.id}`, to: event.to, subject },
        }),
      );
    }
  }
  return findings;
}

/**
 * セッションを終える効果の宣言(`ends_sessions`)と、アカウントを止める遷移の宣言漏れを検証する。
 *
 * @param domain 構築済みのドメイン仕様モデル
 * @param jobs 読み込み済みのジョブカタログ
 * @param auth 読み込み済みの認証フロー仕様(無い環境では主語の照合と R11 を飛ばす)
 * @param roots 製品が宣言した根(反例の場所の組み立て)
 * @returns 違反のリスト
 */
export function verifyEndsSessions(domain: SpecModel, jobs: JobSpecModel, auth: AuthSpecModel | undefined, roots: ProductRoots): Finding[] {
  const catalog = jobs.catalog;
  if (catalog === null) return [];
  const flow = auth?.available === true ? auth.flow : null;
  const subject = subjectAggregateOf(domain, flow);
  const ending = catalog.jobs.filter((decl) => decl.endsSessions !== undefined);
  return [
    ...ending.flatMap((decl) => {
      const target = decl.endsSessions ?? '';
      return [
        ...checkSubject(decl, target, subject, domain, flow),
        ...checkFiredFromTarget(decl, target, domain),
        ...checkInTransaction(decl, target, roots),
      ];
    }),
    ...checkOnePerAggregate(ending),
    ...checkDeclaresPairing(catalog, roots),
    ...checkStoppingTransitions(domain, catalog, flow, roots),
  ];
}
