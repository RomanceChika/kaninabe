/**
 * J5 匿名化する効果の宣言 — `anonymizes` が指す集約・発火元・語の 3 点が揃っていること。
 *
 * 効果カタログの行が `anonymizes: {集約}` を持つとは、「この効果は、その集約の personal 列を
 * placeholder に書き換える」と**機械が読める形で宣言する**ことである(書き込みと同じトランザクションで
 * 実現される種別。キューには積まれない)。これまでは「消去が書く列」を `access_spec.writes` の
 * `by: system` 行で**近似**していたので、機械は消去の書き込みをどこからも読めなかった。この検査は、
 * その宣言が空振りしないこと(宣言の指す先が実在し、本当にその集約の遷移から起きる)を見る。
 *
 * | 見ること | なぜ |
 * |---|---|
 * | `anonymizes` の集約が実在し、personal 列を 1 つ以上持つ | 書き換える列が無い匿名化は空の宣言である |
 * | その効果が**その集約の状態機械の `effects`** から積まれる | 効果が起きる遷移が無ければ、宣言は誰も起こさない。他の集約の遷移から積まれていれば、宣言の「自分の集約」が嘘になる。`writes[].effects`(状態遷移を持たない編集)には匿名化を**載せない**(載せていれば、自分の機械から積まれていても指す) |
 * | 匿名化する効果の `kind` の語が `in_transaction` を宣言している | 匿名化は書き込みと同じトランザクションで実現される(キューに積まれない)効果である。語がキューに積まれる種類の扱いだと、宣言が自己矛盾する |
 * | 1 つの集約に匿名化の効果は 1 つ | 生成物(遷移が書いてよい列)は集約ごとに 1 つの効果から導く。2 つあると、どちらが何を書くかを宣言から決められない |
 * | **認証フローの主語の集約を匿名化する行は `platform_call` か `platform_job` を持つ** | 主語の集約の行の id は認証基盤のアカウントの id で、認証基盤にも本人の実名・メール・プロバイダの ID が入る。公開の表だけを消すと、消去の後も認証基盤に残る(点検 14 回目 A14-5)。RPC の実在と呼び出しは T19 が見る |
 * | `platform_job` は実在のキューの行を指し、匿名化の効果と同じ遷移の `effects` に載る | 認証基盤の管理 API はトランザクションの外なので、コミットの後のジョブで消す形を選べる。積まれない行を指す・積まれない遷移があると、消去が認証基盤へ届かない遷移が黙って残る |
 * | `kind` の語の `declares: [anonymizes]` と行の `anonymizes` が対である | 機械が読むのは `anonymizes` の有無だけで、語(匿名化の呼び名)はカタログが宣言する。語の側が「この語の行は `anonymizes` を必ず持つ」と宣言し、**宣言した語を選んで `anonymizes` を書き忘れた行**(`anonymizes` を持つ行が他に無くても)も、**`anonymizes` を持つのに宣言の無い語を選んだ行**も落ちる(語を選べば宣言が付いてくる形。体系は語の綴りを比べない) |
 *
 * **逆向き(personal 列を持つ集約に匿名化の効果が無い)は鳴らさない** —— 消去を持たない製品は正当である。
 * 消去の要求に応じる義務は保証台帳(「消去が placeholder を書く」の行)の話で、効果の宣言の形の話ではない。
 */

import type { AggregateSpecs, SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import { collectJobEffects } from '../../semantics/effect-refs.js';
import { declaresMismatches } from '../declares.js';
import type { JobCatalogSpec, JobDecl, JobSpecModel } from '../../model/job/types.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';
import type { AuthSpecModel } from '../../model/auth/types.js';
import { subjectAggregateOf } from './j7-ends-sessions.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'J5';

/** J5 の指摘を組み立てる。 */
function j5Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** 集約の状態機械の `effects` に並ぶジョブ ID(宣言順・重複あり)。 */
function machineEffectIds(specs: AggregateSpecs): readonly string[] {
  return specs.stateMachines.flatMap((machine) => machine.effects.flatMap((effect) => effect.do));
}

/** 集約が personal 列(entity_spec の `personal: true`)を 1 つ以上持つか。 */
function hasPersonalColumn(specs: AggregateSpecs): boolean {
  return specs.entity?.fields.some((field) => field.personal) === true;
}

/** 匿名化の対象の集約が実在し、personal 列を持つこと(1 行ぶん)。 */
function checkTarget(decl: JobDecl, target: string, domain: SpecModel): Finding[] {
  const specs = domain.aggregates.get(target);
  if (specs === undefined) {
    return [
      j5Finding({
        message: `${decl.id} の anonymizes ${target} は、仕様に無い集約です`,
        location: decl.location,
        suggestion: `anonymizes に実在する集約の id を書く(personal 列を placeholder に書き換える本人の集約)`,
        counterexample: { job: decl.id, anonymizes: target },
      }),
    ];
  }
  if (hasPersonalColumn(specs)) return [];
  return [
    j5Finding({
      message: `${decl.id} は ${target} を匿名化すると宣言していますが、${target} に personal: true の欄がありません`,
      location: decl.location,
      suggestion:
        `${target} の entity_spec に personal: true(+ personal_placeholder)の欄を宣言するか、` +
        '書き換える列が無いならこの効果は匿名化ではない(anonymizes を外す)',
      counterexample: { job: decl.id, anonymizes: target },
    }),
  ];
}

/** その効果が、匿名化の対象の集約の状態機械の `effects` から積まれていること(1 行ぶん)。 */
function checkFiredFromTarget(decl: JobDecl, target: string, domain: SpecModel): Finding[] {
  const own = domain.aggregates.get(target);
  if (own === undefined) return []; // 対象が無いことは checkTarget が言う
  const ownFires = machineEffectIds(own).includes(decl.id);
  const foreign = [...domain.aggregates.values()].filter(
    (specs) => specs.name !== target && machineEffectIds(specs).includes(decl.id),
  );
  const findings: Finding[] = [];
  if (!ownFires && collectJobEffects(domain).some((ref) => ref.id === decl.id)) {
    findings.push(
      j5Finding({
        message: `${decl.id}(anonymizes: ${target})が ${target} の状態機械の effects から積まれていません`,
        location: decl.location,
        suggestion:
          `${target} の state_spec の effects に "- on: {匿名化の遷移} / do: [${decl.id}]" を書く` +
          '(状態遷移を持たない編集の writes[].effects には匿名化を載せない)',
        counterexample: { job: decl.id, anonymizes: target },
      }),
    );
  }
  if (ownFires && own.access?.writes.some((rule) => (rule.effects ?? []).includes(decl.id)) === true) {
    findings.push(
      j5Finding({
        message: `${decl.id}(anonymizes: ${target})が ${target} の writes[].effects にも載っています`,
        location: decl.location,
        suggestion:
          '匿名化の効果は状態遷移の effects にだけ載せる(writes[].effects は状態遷移を持たない編集の副作用の口で、' +
          '匿名化が起きる遷移を二重に宣言することになる)。writes[].effects から外す',
        counterexample: { job: decl.id, anonymizes: target },
      }),
    );
  }
  for (const specs of foreign) {
    findings.push(
      j5Finding({
        message: `${decl.id}(anonymizes: ${target})が別の集約 ${specs.name} の状態機械の effects から積まれています`,
        location: decl.location,
        suggestion:
          `匿名化の宣言は自分の集約の遷移で起きる効果である。${specs.name} の effects から外すか、` +
          `${specs.name} 側の匿名化は別の効果(anonymizes: ${specs.name})として宣言する`,
        counterexample: { job: decl.id, anonymizes: target, firedFrom: specs.name },
      }),
    );
  }
  return findings;
}

/** 匿名化する効果の `kind` の語が、同一トランザクションで実現される種類(`in_transaction`)であること(1 行ぶん)。 */
function checkInTransaction(decl: JobDecl, target: string, roots: ProductRoots): Finding[] {
  if (decl.inTransaction === true) return [];
  return [
    j5Finding({
      message: `${decl.id}(anonymizes: ${target})の kind ${decl.kind} が in_transaction を宣言していません`,
      location: decl.location,
      suggestion:
        `${specPath(roots, 'backend/jobs.md')} の vocabulary.kind の ${decl.kind} に "in_transaction: true" を足す` +
        '(匿名化は書き込みと同じトランザクションで実現され、キューには積まれない。語にその扱いが無いと宣言が自己矛盾する)',
      counterexample: { job: decl.id, kind: decl.kind, anonymizes: target },
    }),
  ];
}

/** 認証フローの主語を匿名化する行が、認証基盤の呼び出しを名指していること(1 行ぶん)。 */
function checkPlatformCall(decl: JobDecl, target: string, subject: string | null): Finding[] {
  if (subject !== target || decl.platformCall !== undefined || decl.platformJob !== undefined) return [];
  return [
    j5Finding({
      message: `${decl.id}(anonymizes: ${target})は認証フローの主語の集約を匿名化しますが、platform_call も platform_job もありません —— 認証基盤の実名・メール・プロバイダの ID が消去の後も残ります`,
      location: decl.location,
      suggestion: `${decl.id} の行に "platform_call: {認証基盤の個人データを消す RPC}" を書き、realized_by の RPC の calls に足す(認証基盤の綴りはその RPC の本文に閉じる。同じトランザクションで呼ぶ)`,
      counterexample: { job: decl.id, anonymizes: target, subject },
    }),
  ];
}

/** `platform_job` が実在のキューの行を指し、匿名化の効果と同じ遷移で積まれていること(1 行ぶん)。 */
function checkPlatformJob(decl: JobDecl, target: string, catalog: JobCatalogSpec, domain: SpecModel): Finding[] {
  const name = decl.platformJob;
  if (name === undefined) return [];
  const row = catalog.jobs.find((job) => job.id === name);
  if (row?.source !== 'outbox' || row.inTransaction === true) {
    return [
      j5Finding({
        message: `${decl.id} の platform_job ${name} は、キューに積まれる outbox の行ではありません`,
        location: decl.location,
        suggestion: `${name} を source: outbox のキューの行(in_transaction でない語)として宣言する`,
        counterexample: { job: decl.id, platformJob: name },
      }),
    ];
  }
  const effects = (domain.aggregates.get(target)?.stateMachines ?? []).flatMap((machine) => machine.effects);
  return effects
    .filter((effect) => effect.do.includes(decl.id) && !effect.do.includes(name))
    .map((effect) =>
      j5Finding({
        message: `${decl.id} を積む遷移 ${effect.on} に platform_job ${name} が載っていません —— その遷移の消去は認証基盤へ届きません`,
        location: decl.location,
        suggestion: `${target} の state_spec の effects の on: ${effect.on} の do に ${name} を足す`,
        counterexample: { job: decl.id, platformJob: name, event: effect.on },
      }),
    );
}

/** 1 つの集約に匿名化の効果が 2 つ以上無いこと。 */
function checkOnePerAggregate(anonymizing: readonly JobDecl[]): Finding[] {
  const byTarget = new Map<string, JobDecl[]>();
  for (const decl of anonymizing) {
    const target = decl.anonymizes ?? '';
    byTarget.set(target, [...(byTarget.get(target) ?? []), decl]);
  }
  const findings: Finding[] = [];
  for (const [target, decls] of byTarget) {
    const [, ...rest] = decls;
    for (const decl of rest) {
      findings.push(
        j5Finding({
          message: `${target} を匿名化する効果が複数あります(${decls.map((d) => d.id).join(' / ')})`,
          location: decl.location,
          suggestion:
            '1 つの集約に匿名化の効果は 1 つ(遷移が書いてよい列は集約ごとに 1 つの効果から導く)。' +
            '効果を 1 つにまとめる',
          counterexample: { anonymizes: target, jobs: decls.map((d) => d.id).join(', ') },
        }),
      );
    }
  }
  return findings;
}

/**
 * `kind` の語の `declares: [anonymizes]` と行の `anonymizes` が対であること(語と宣言のずれ)。
 *
 * 機械が読むのは `anonymizes` の有無で、語(匿名化の呼び名)はカタログが宣言する。語の側が
 * 「この語の行は `anonymizes` を必ず持つ」と宣言しているので、**語を選んで書き忘れた行**(`anonymizes` を持つ行が
 * 他に 1 つも無くても)も、**`anonymizes` を持つのに宣言の無い語を選んだ行**も、ここで落ちる
 * (ずれの検出は `declaresMismatches` の共通部品。文面だけがこの検証器のもの)。
 */
function checkDeclaresPairing(catalog: JobCatalogSpec, roots: ProductRoots): Finding[] {
  const jobsPath = specPath(roots, 'backend/jobs.md');
  return declaresMismatches(catalog, 'anonymizes', (decl) => decl.anonymizes !== undefined).map(({ decl, problem }) =>
    problem === 'missing'
      ? j5Finding({
          message: `${decl.id} の kind ${decl.kind} は anonymizes を必ず持つ語(declares)なのに、anonymizes がありません`,
          location: decl.location,
          suggestion:
            `匿名化する効果なら anonymizes に集約を書く。違う種類の効果なら、${jobsPath} で別の kind の語を宣言して選ぶ` +
            '(機械が読むのは anonymizes の有無であり、語はその宣言の呼び名である)',
          counterexample: { job: decl.id, kind: decl.kind },
        })
      : j5Finding({
          message: `${decl.id} は anonymizes を持つのに、kind ${decl.kind} が anonymizes を declares していません`,
          location: decl.location,
          suggestion:
            `${jobsPath} の vocabulary.kind の ${decl.kind} に "declares: [anonymizes]" を足す` +
            '(語を選べば宣言が付いてくる形にする。足したあとは、その語を選ぶ行が anonymizes を書き忘れると落ちる)',
          counterexample: { job: decl.id, kind: decl.kind, anonymizes: decl.anonymizes ?? '' },
        }),
  );
}

/**
 * 匿名化する効果の宣言(`anonymizes`)を検証する。
 *
 * @param domain 構築済みのドメイン仕様モデル
 * @param jobs 読み込み済みのジョブカタログ
 * @param roots 製品が宣言した根(反例の場所の組み立て)
 * @param auth 読み込み済みの認証フロー仕様(無い環境では主語の照合を飛ばす)
 * @returns 違反のリスト
 */
export function verifyAnonymize(domain: SpecModel, jobs: JobSpecModel, roots: ProductRoots, auth?: AuthSpecModel): Finding[] {
  const catalog = jobs.catalog;
  if (catalog === null) return [];
  const subject = subjectAggregateOf(domain, auth?.available === true ? auth.flow : null);
  const anonymizing = catalog.jobs.filter((decl) => decl.anonymizes !== undefined);
  return [
    ...anonymizing.flatMap((decl) => {
      const target = decl.anonymizes ?? '';
      return [
        ...checkTarget(decl, target, domain),
        ...checkFiredFromTarget(decl, target, domain),
        ...checkInTransaction(decl, target, roots),
        ...checkPlatformCall(decl, target, subject),
        ...checkPlatformJob(decl, target, catalog, domain),
      ];
    }),
    ...checkOnePerAggregate(anonymizing),
    ...checkDeclaresPairing(catalog, roots),
  ];
}
