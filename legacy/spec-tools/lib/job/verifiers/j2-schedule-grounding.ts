/**
 * J2 時刻で起きるジョブの接地(コアの部分)— 実装・Route Handler・起こすイベント・発火時刻の供給元。
 *
 * job-spec-writing.md の要求のうち、**どのホストでも成り立つもの**:
 *   - `implementation` のモジュールが実在すること
 *   - `endpoint` に対応する Route Handler(置き場の配置の `http-entry`。Next.js なら `app/src/app{endpoint}/route.ts`)が実在すること
 *   - `fires` がドメインイベント ID として実在すること
 *   - `due_from` が `{entity}.{field}` として実在すること(**「いつ」を仕様から辿れるように**)
 *
 * `schedule`(cron 式)を**ホストの Cron の登録と**双方向に突き合わせる部分は、ホストの後段が受け持つ
 * (ルール ID は同じ J2。後段が無い構成では「J2: 未実施」と報告され、この接地は実行済みと言う)。
 *
 * **実装・Route Handler の 2 つは `app/` が実在する環境でだけ見る。** `fires` / `due_from` はドメイン仕様だけで判定できるので
 * 常に見る —— 同じ検査器の中で接地の有無を非対称にすると、仕様だけを持つリポジトリが時刻起点のジョブを 1 行も宣言できない。
 */

import path from 'node:path';
import { appGrounded, isFile } from '../../io/paths.js';
import type { SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import { absentFor, type ScopeOwner } from '../../kernel/scope-owner.js';
import { JOB_CATALOG_ID } from '../../model/job/parse-jobs.js';
import type { JobDecl, JobSpecModel } from '../../model/job/types.js';
import { httpEntryPath } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';

/** この検証器の ID(ホストの後段の Cron 登録の突合と同じ J2)。 */
export const VERIFIER_ID = 'J2';

/** J2 の指摘を組み立てる。 */
function j2Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** J2(接地)の入力(リポジトリルートは I/O のため呼び出し側が渡す)。 */
export interface ScheduleGroundingInput {
  readonly domain: SpecModel;
  readonly jobs: JobSpecModel;
  /** リポジトリルートの絶対パス。実装・Route Handler の実在確認に使う。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(実装の木の位置)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(Route Handler の位置を引く。アプリの枠の後段が与える)。 */
  readonly layout: ProductLayout;
}

/**
 * 時刻で起きるジョブの宣言を、実装・ドメイン仕様に接地させる。
 *
 * @param input ドメインモデル・ジョブカタログ・リポジトリルート
 * @returns 違反のリスト
 */
export function verifyScheduleGrounding(input: ScheduleGroundingInput): Finding[] {
  const catalog = input.jobs.catalog;
  if (catalog === null) return [];

  const scheduled = catalog.jobs.filter((decl) => decl.schedule !== undefined);
  const grounded = appGrounded(input.repoRoot, input.roots.app);
  const findings: Finding[] = [];
  for (const decl of scheduled) {
    findings.push(...verifyOne(decl, input, grounded));
  }
  return findings;
}

/** 実装・Route Handler の不在の持ち主(ジョブカタログ)。 */
const JOB_CATALOG_OWNER: ScopeOwner = { kind: 'catalog', id: JOB_CATALOG_ID };

/**
 * 1 行分の接地(実装・Route Handler・fires・due_from)。
 *
 * `grounded: false`(app/ が無い環境)では、実装と Route Handler の実在という**仕様と実装の
 * 突合**だけを飛ばす。`fires` / `due_from` はドメイン仕様だけで判定できるので常に見る。
 */
function verifyOne(decl: JobDecl, input: ScheduleGroundingInput, grounded: boolean): Finding[] {
  const schedule = decl.schedule;
  if (schedule === undefined) return [];
  const findings: Finding[] = [];

  if (grounded && !isFile(path.join(input.repoRoot, schedule.implementation))) {
    const missing = j2Finding({
      message: `ジョブ ${decl.id} の implementation ${schedule.implementation} が実在しません`,
      location: decl.location,
      suggestion: 'モジュールを作るか、implementation を実在するパス(リポジトリルート相対)へ直す',
      counterexample: { job: decl.id, implementation: schedule.implementation },
      grounding: 'implementation',
    });
    findings.push(absentFor(JOB_CATALOG_OWNER, missing));
  }

  if (grounded && schedule.endpoint !== undefined) {
    const route = httpEntryPath(input.layout, input.roots, schedule.endpoint);
    if (route === null) {
      findings.push(
        j2Finding({
          message: `ジョブ ${decl.id} の endpoint ${schedule.endpoint} に対応する Route Handler の位置を決められません(置き場の配置に http-entry がありません)`,
          location: decl.location,
          suggestion: '実装の木を宣言する製品には、アプリの枠の後段(置き場の配置を与える後段)を選ぶ(選ぶのは組み立ての根)',
          counterexample: { job: decl.id, endpoint: schedule.endpoint },
        }),
      );
    } else if (!isFile(path.join(input.repoRoot, route))) {
      const missing = j2Finding({
        message: `ジョブ ${decl.id} の endpoint ${schedule.endpoint} に対応する Route Handler がありません`,
        location: decl.location,
        suggestion: `${route} を作るか、endpoint を実在する口へ直す(Cron が叩けない口は宣言だけの死んだ経路)`,
        counterexample: { job: decl.id, expected_route: route },
        grounding: 'implementation',
      });
      findings.push(absentFor(JOB_CATALOG_OWNER, missing));
    }
  }

  if (schedule.fires !== undefined && !eventExists(input.domain, schedule.fires)) {
    findings.push(
      j2Finding({
        message: `ジョブ ${decl.id} の fires ${schedule.fires} は state_spec に無いドメインイベントです`,
        location: decl.location,
        suggestion: 'fires を実在するドメインイベント ID({machine}.{event})へ直す',
        counterexample: { job: decl.id, fires: schedule.fires },
      }),
    );
  }

  if (schedule.dueFrom !== undefined && !fieldExists(input.domain, schedule.dueFrom)) {
    findings.push(
      j2Finding({
        message: `ジョブ ${decl.id} の due_from ${schedule.dueFrom} は entity_spec に無いフィールドです`,
        location: decl.location,
        suggestion:
          'due_from を実在する {entity}.{field} へ直す(発火時刻の供給元が仕様から辿れないと、' +
          '「いつ起きるか」は実装のクエリを読むまで分からない)',
        counterexample: { job: decl.id, due_from: schedule.dueFrom },
      }),
    );
  }
  return findings;
}

/** ドメインイベント ID(`{machine}.{event}`)が実在するか。 */
function eventExists(domain: SpecModel, eventId: string): boolean {
  for (const specs of domain.aggregates.values()) {
    for (const machine of specs.stateMachines) {
      for (const event of machine.events) {
        if (`${machine.machine}.${event.id}` === eventId) return true;
      }
    }
  }
  return false;
}

/** `{entity}.{field}` が実在するか。 */
function fieldExists(domain: SpecModel, ref: string): boolean {
  const separator = ref.indexOf('.');
  if (separator <= 0) return false;
  const entity = ref.slice(0, separator);
  const field = ref.slice(separator + 1);
  for (const specs of domain.aggregates.values()) {
    if (specs.entity?.entity !== entity) continue;
    return specs.entity.fields.some((candidate) => candidate.name === field);
  }
  return false;
}
