/**
 * A14 ガード環境の突合 —— operation の手書き `guardEnv` の鍵 ⇔ 仕様のガード式の変数。
 *
 * ADR-0012 の当座の手当て(§Implementation)。同じ規則を評価する場所が 2 つある
 * (operation の `guardEnv` と、保存点の実行計画の `guardFacts`)ので、**両者が同じ事実を
 * 見ていること**を機械が確かめる。突合の相手はどちらの実装でもなく**仕様**である ——
 * ガード式に現れるパスの集合は仕様から一意に決まり、エンジンはそのパスを鍵にして環境を引く
 * (`domain/engine/guard.ts` の `lookup`)。したがって
 *
 *   - 足りない鍵 = そのガードは常に `guard_unknown` になり、**拒否として扱われる**
 *     (通るはずの操作が通らない。しかも理由が仕様から説明できない)
 *   - 余分な鍵 = 仕様のどのガードも見ない事実を operation が読んでいる(読み取りの無駄と、
 *     「仕様に無い挙動が手書きで入り込む」経路。ADR-0012 §Context の 2)
 *
 * **保存点の側(`guardFacts`)は生成物**であり、同じ `collectGuardPaths` から作られる。
 * よってここで「手書き ⇔ 仕様」が閉じれば、「手書き ⇔ 生成物」も閉じる。④(operation の生成)が
 * 済めばこの検査は役目を終える —— 両方が同じ導出の生成物になるからである。
 */

import type { Finding, TraceVerifier } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import type { GuardEnvRef } from '../../testcase/types.js';
import type { TraceInput } from '../input.js';
import type { EventDef, SpecModel } from '../../model/types.js';
import type { GuardServices } from '../../guard/ast.js';
import { operationIdOf } from '../operation-path.js';
import { findCreate, findDelete, findUpdate, isCreateId, isDeleteId, isUpdateId, listEvents } from '../../semantics/domain-index.js';

/** A14: 手書きの `guardEnv` が仕様のガード式と同じ変数を運ぶことを検証する。 */
export const guardEnvParityVerifier: TraceVerifier = {
  id: 'A14',
  title: 'ガード環境の突合 — operation の guardEnv の鍵は仕様のガード式の変数と一致する',

  verify(input: TraceInput): Finding[] {
    // 実装がまだ無い(app/ を読めない)構成、またはガード式のパーサーが無い環境では見ない。
    const guards = input.guards;
    if (!input.tests.available || guards === undefined) return [];
    return (input.tests.guardEnvs ?? []).flatMap((ref) => checkOne(ref, input, guards));
  },
};

/** 1 つの operation の突合。 */
function checkOne(ref: GuardEnvRef, input: TraceInput, guards: GuardServices): Finding[] {
  const id = operationIdOf(ref.file, input.layout, input.roots);
  if (id === null) return [];
  const domain = input.domain;
  const sources = guardSourcesOf(domain, id);
  // 仕様に接地しない実装ファイルは A11 が別に落とす(ここで二重に言わない)。
  if (sources === null) return [];
  if (ref.unreadable) return [unreadableFinding(ref, id)];
  const expected = collectPaths(guards, sources);
  const actual = new Set(ref.keys);
  const missing = [...expected].filter((path) => !actual.has(path));
  const extra = ref.keys.filter((key) => !expected.has(key));
  if (missing.length === 0 && extra.length === 0) return [];
  return [mismatchFinding(ref, id, missing, extra, expected)];
}

/**
 * その操作の `permit` が評価するガード式の生文字列。
 *
 * 遷移はそのイベントのガード 1 本、作成・削除・編集は**規則の全数**である ——
 * 実行者がどの規則で通るかは実行時にしか決まらないので、環境にはどの規則の変数も
 * 載っていなければならない(`plan-facts-parts.ts` の `collectGuardPaths` と同じ規約)。
 *
 * @returns ガード式の配列。その操作が仕様に無ければ null
 */
function guardSourcesOf(domain: SpecModel, id: string): readonly string[] | null {
  const event = findOperationEvent(domain, id);
  if (event !== null) return event.guard === undefined ? [] : [event.guard];
  if (isCreateId(id)) return whensOf(findCreate(domain, id)?.rules);
  if (isDeleteId(id)) return whensOf(findDelete(domain, id)?.rules);
  if (isUpdateId(id)) return whensOf(findUpdate(domain, id)?.rules);
  return null;
}

/**
 * 実装ファイルのパスから導いた ID で遷移イベントを引く。
 *
 * **集約名と状態機械名のどちらの綴りも許す。** 副次状態機械の業務手順は集約のディレクトリに
 * 置かれる(`operation/entry_participant/link.ts` は `participant_link.link` の実装)ため、
 * パスから導いた ID は `{集約}.{イベント}` になる。A11 の宣言済み集合と同じ規則である ——
 * ここで機械名しか許さないと、副次状態機械の操作が**黙って突合の外に落ちる**。
 */
function findOperationEvent(domain: SpecModel, id: string): EventDef | null {
  for (const entry of listEvents(domain)) {
    if (entry.id === id || `${entry.aggregate}.${entry.event.id}` === id) return entry.event;
  }
  return null;
}

/** 規則の `when` を集める(条件の無い規則は現れない)。宣言そのものが無ければ null。 */
function whensOf(rules: readonly { readonly when?: string }[] | undefined): readonly string[] | null {
  if (rules === undefined) return null;
  return rules.map((rule) => rule.when).filter((when): when is string => when !== undefined);
}

/** ガード式の集合に現れるパス(= 環境の鍵)の集合。 */
function collectPaths(guards: GuardServices, sources: readonly string[]): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const source of sources) {
    const parsed = guards.parse(source);
    if (!parsed.ok) continue; // パース不能は V1 / V2 が先に落とす。
    for (const path of guards.collectPaths(parsed.expr)) paths.add(path.segments.join('.'));
  }
  return paths;
}

/** 鍵を静的に読めない形の Finding。 */
function unreadableFinding(ref: GuardEnvRef, id: string): Finding {
  return traceFinding('A14', {
    message: `${ref.file} の guardEnv が返す鍵を読めません(${id})`,
    location: { file: ref.file },
    suggestion:
      'guardEnv は `(facts) => ({ {ガード式のパス}: 値 })` の形で書く(オブジェクトリテラルを' +
      'そのまま返す)。ブロック本体・計算された鍵・スプレッドを使うと、どの事実を運んでいるかが' +
      '仕様と突き合わせられなくなる',
    counterexample: { file: ref.file, operation: id },
  });
}

/** 鍵の集合が食い違う Finding。 */
function mismatchFinding(
  ref: GuardEnvRef,
  id: string,
  missing: readonly string[],
  extra: readonly string[],
  expected: ReadonlySet<string>,
): Finding {
  const parts = [
    ...(missing.length === 0 ? [] : [`足りない: ${missing.join(' / ')}`]),
    ...(extra.length === 0 ? [] : [`余分: ${extra.join(' / ')}`]),
  ];
  return traceFinding('A14', {
    message: `${id} の guardEnv の鍵が仕様のガード式の変数と一致しません(${parts.join(' / ')})`,
    location: { file: ref.file },
    suggestion:
      `guardEnv が返す鍵を [${[...expected].join(', ')}] に揃える。足りない鍵はガードが` +
      '常に評価不能(= 拒否)になる原因であり、余分な鍵は仕様のどのガードも見ない事実を' +
      '読んでいる印である。ガード式そのものを変えたいなら先に仕様(state_spec の guard / ' +
      'access_spec の when)を直す',
    counterexample: {
      file: ref.file,
      operation: id,
      expected: [...expected].join(' / '),
      actual: ref.keys.join(' / '),
    },
  });
}
