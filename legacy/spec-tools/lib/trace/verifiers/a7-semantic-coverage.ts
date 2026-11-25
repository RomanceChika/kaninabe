/**
 * A7 意味的カバレッジの検査。
 *
 * action-spec-writing.md の A7:「ドメイン仕様から導かれる必要な意味クラスが、
 * `test_cases[].covers` の和集合に含まれる」。
 *
 * A6 までは「宣言したものが実在するか」しか見ておらず、**宣言しなかったもの**は誰も咎めない。
 * ガードを持つのに不成立のケースを書かない、拒否されるロールがいるのに権限のケースを書かない、
 * といった書き漏れは仕様としては静かに通ってしまう。A7 はその穴を塞ぎ、
 * 「ドメイン仕様がそう書いてある以上、確かめるべきことがある」を機械の要求に変える。
 *
 * 判定は宣言された covers だけで行う(covers を書いていないケースは数に入らない)。
 * covers 自体の欠落は移行期の warning としてローダー(A0)が指摘する。
 * 必要クラスを超える宣言(補助的な `other` など)は問題にしない — 足りないことだけが違反である。
 */

import type { Finding, TraceVerifier } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import type { ActionSpec } from '../../model/trace/types.js';
import type { TraceInput } from '../input.js';
import type { CoverageClass } from '../../testcase/types.js';
import { COVERAGE_CLASS_HINTS, COVERAGE_CLASSES } from '../../testcase/index.js';
import type { RequiredClass, RequiredRole } from '../required-coverage.js';
import { deriveRequiredCoverage } from '../required-coverage.js';

/**
 * A7: 必要な意味クラスと、宣言に並ぶロールごとの成功ケースが揃っているかを検証する。
 *
 * 後半(ロールごとの成功)は、**実装が宣言のロールを解決しているか**を問う唯一の口である。
 * 意味クラスの網羅だけでは「どのロールとして成功したか」が母集合に現れず、`by` に足した
 * ロールが 1 つも解決されていない状態が緑のまま通る(E3 第3段の実穴。14 操作)。
 */
export const semanticCoverageVerifier: TraceVerifier = {
  id: 'A7',
  title: '意味的カバレッジ — ドメイン仕様が要求するテストケースが宣言されている',

  verify(input: TraceInput): Finding[] {
    const findings: Finding[] = [];
    for (const action of input.actions.actions) {
      const coverage = deriveRequiredCoverage(action, input.domain);
      if (!coverage.grounded) continue;
      const declared = declaredClasses(action);
      for (const required of coverage.required) {
        if (declared.has(required.cls)) continue;
        findings.push(missingClassFinding(action, required, declared));
      }
      findings.push(...roleFindings(action, coverage.roles));
    }
    return findings;
  },
};

/**
 * 宣言に並ぶロールごとの成功ケースの過不足。
 *
 * 見るのは 2 方向である。
 * - **不足**: 宣言に並ぶロールに、そのロールとして成功するケースが無い(実装が解決していない
 *   ロールがここで表面化する)
 * - **余分**: 宣言に無いロールを `by_role` が指定している(綴り違い・宣言から消したのに
 *   テストだけ残っている)
 */
function roleFindings(action: ActionSpec, roles: readonly RequiredRole[]): Finding[] {
  const succeeded = successRoles(action);
  const findings: Finding[] = [
    ...roles
      .filter((required) => !succeeded.has(required.role))
      .map((required) => missingRoleFinding(action, required, succeeded)),
    ...[...succeeded]
      .filter((role) => !roles.some((required) => required.role === role))
      .map((role) => unknownRoleFinding(action, role, roles)),
  ];
  return findings;
}

/** そのアクションが「成功した」と宣言しているロールの集合。 */
function successRoles(action: ActionSpec): Set<string> {
  const roles = new Set<string>();
  for (const testCase of action.testCases) {
    if (testCase.byRole === undefined) continue;
    if (!(testCase.covers ?? []).includes('success')) continue;
    roles.add(testCase.byRole);
  }
  return roles;
}

/** 宣言に並ぶロールの成功ケースが無いことの Finding。 */
function missingRoleFinding(
  action: ActionSpec,
  required: RequiredRole,
  succeeded: ReadonlySet<string>,
): Finding {
  return traceFinding('A7', {
    message:
      `${action.handles.raw} は ${required.role} を許していますが(${required.because})、` +
      `${required.role} として成功するテストケースがありません`,
    location: { file: action.location.file, pointer: 'test_cases' },
    suggestion:
      `${required.role} として実行して成功する経路を確かめるテストケースを test_cases に足し、` +
      `covers: [success] と by_role: ${required.role} を書く。宣言にロールを並べただけで ` +
      `operation がそのロールを解決していないと「仕様上できることが実装では必ず forbidden」に ` +
      `なるが、その食い違いはこの義務でしか表面化しない`,
    counterexample: {
      handles: action.handles.raw,
      missing_role: required.role,
      declared: [...succeeded].join(', ') || '(なし)',
    },
  });
}

/** 宣言に無いロールを by_role が指定していることの Finding。 */
function unknownRoleFinding(
  action: ActionSpec,
  role: string,
  roles: readonly RequiredRole[],
): Finding {
  return traceFinding('A7', {
    message: `${action.handles.raw} の by_role: ${role} は、この操作を許されたロールではありません`,
    location: { file: action.location.file, pointer: 'test_cases' },
    suggestion:
      `by_role を許可されたロール(${roles.map((required) => required.role).join(', ') || 'なし'})に直すか、` +
      `ドメイン仕様の宣言側にそのロールを足す`,
    counterexample: {
      handles: action.handles.raw,
      by_role: role,
      allowed: roles.map((required) => required.role).join(', ') || '(なし)',
    },
  });
}

/** そのアクションの test_cases が宣言した意味クラスの和集合。 */
function declaredClasses(action: ActionSpec): Set<CoverageClass> {
  const declared = new Set<CoverageClass>();
  for (const testCase of action.testCases) {
    for (const cls of testCase.covers ?? []) declared.add(cls);
  }
  return declared;
}

/** 必要クラスが 1 つ宣言されていないことの Finding。 */
function missingClassFinding(
  action: ActionSpec,
  required: RequiredClass,
  declared: ReadonlySet<CoverageClass>,
): Finding {
  const { cls, because } = required;
  return traceFinding('A7', {
    message: `${action.handles.raw} は、${because}のに、covers に ${cls} を宣言したテストケースがありません`,
    location: { file: action.location.file, pointer: 'test_cases' },
    suggestion:
      `${COVERAGE_CLASS_HINTS[cls]}を確かめるテストケースを test_cases に足し、その covers に ${cls} を書く。` +
      `既にそのケースがあるなら covers に ${cls} を書き足すだけでよい` +
      `(必要クラスの導出規則は action-spec-writing.md §A7 の表が正)`,
    counterexample: {
      handles: action.handles.raw,
      missing: cls,
      declared: sortClasses(declared).join(', ') || '(なし)',
    },
  });
}

/** 宣言済みクラスを値域の並び順に整える(メッセージの安定のため)。 */
function sortClasses(declared: ReadonlySet<CoverageClass>): CoverageClass[] {
  return COVERAGE_CLASSES.filter((cls) => declared.has(cls));
}
