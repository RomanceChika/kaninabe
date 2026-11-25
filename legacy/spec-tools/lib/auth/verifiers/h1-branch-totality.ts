/**
 * H1 サインイン分岐の全域性と接地。
 *
 * auth-spec-writing.md の要求:
 *   - `subject` が実在する**値の出どころ**(状態機械、または `{エンティティ}.{enum の欄}`)であり、
 *     **主語の軸**の値がその値集合(または行が無いことを表す `absent`)であること
 *   - **主語の全状態が最低 1 行で扱われていること**(状態を 1 つ足したら、その人がサインインしたとき
 *     どこへ着地するかを宣言しないと通らない)
 *   - `lands` が実在する着地を指し、宣言した着地が**すべて**どこかの行から到達されること
 *   - `runs` のイベントが実在し、`by` に `system` を含むこと(人が押していないのに実行される操作である)
 *   - **`when` を宣言した軸は、その条件の行だけが持つ**(条件から外れた行が持っていたらエラーにする)。
 *     「行が無い人だけが招待の扱いを持つ」のような従属関係はこの一般則の 1 例であり、
 *     体系側は軸の名前を 1 つも持たない
 *   - `labels` / `when` の値が、その軸が取り得る値であること(主語の軸なら state_spec の状態)
 *
 * 実装との突合(宣言した分岐を実装が本当にその着地へ運ぶか)は app 側の
 * `sign-in-sync.test.ts` が生成物 `SIGN_IN_BRANCHES` を回して行う。ここが守るのは
 * **仕様の側の閉世界**であり、その 2 つで「仕様 → 生成物 → 実装 → 仕様」の輪が閉じる。
 */

import type { SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import { findEvent, findEntityFields } from '../../semantics/domain-index.js';
import { systemRoleId } from '../../model/role-hierarchy.js';
import type { AuthFlowSpec, AuthSpecModel } from '../../model/auth/types.js';
import type { AuthAxisDecl } from '../../model/auth/types.js';
import { absentValue, axisLabel, axisValues, subjectAxis } from '../../model/auth/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'H1';

/** H1 の指摘を組み立てる。 */
function h1(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/**
 * サインイン分岐の全域性と接地を検証する。
 *
 * @param domain 構築済みのドメイン仕様モデル(主語の状態とイベントの出どころ)
 * @param auth 読み込み済みの認証フロー仕様
 * @returns 違反のリスト
 */
export function verifyBranchTotality(domain: SpecModel, auth: AuthSpecModel): Finding[] {
  const flow = auth.flow;
  if (flow === null) return [];
  const subject = resolveSubject(domain, flow.subject);
  if (subject === null) {
    return [
      h1({
        message: `subject ${flow.subject} に対応する状態機械も enum の欄もありません`,
        location: flow.location,
        suggestion:
          'state_spec の state_machine 名か、entity_spec の enum の欄' +
          '("{エンティティ}.{欄}" の形)を書く',
        counterexample: { subject: flow.subject },
      }),
    ];
  }
  return [
    ...checkSubjectValues(flow, subject),
    ...checkTotality(flow, subject),
    ...checkLandings(flow),
    ...checkRuns(flow, domain),
    ...checkAxisPresence(flow, subject),
    ...checkAxisValueGrounding(flow, subject),
  ];
}

/** 主語の値集合(状態機械の states か、enum の欄の values)。 */
interface SubjectDomain {
  /** 主語の呼び名(メッセージに出す。状態機械名 or `{エンティティ}.{欄}`)。 */
  readonly name: string;
  /** 値の全体(`absent` は含まない)。 */
  readonly values: readonly string[];
}

/**
 * `subject` を値集合に解決する。
 *
 * 状態機械名なら state_spec の `states`、`{エンティティ}.{欄}` なら entity_spec の
 * `enum([...])` の値。どちらも**別の宣言が正**であり、値を 1 つ足したら着地の宣言が要る
 * (それがこの検査の存在理由。宣言した values を並べただけの主語は許さない)。
 */
function resolveSubject(domain: SpecModel, subject: string): SubjectDomain | null {
  for (const specs of domain.aggregates.values()) {
    const found = specs.stateMachines.find((candidate) => candidate.machine === subject);
    if (found !== undefined) return { name: found.machine, values: found.states };
  }
  const dot = subject.lastIndexOf('.');
  if (dot <= 0) return null;
  const entity = subject.slice(0, dot);
  const name = subject.slice(dot + 1);
  const field = (findEntityFields(domain, entity) ?? []).find((candidate) => candidate.name === name);
  if (field === undefined || field.type.kind !== 'enum') return null;
  return { name: subject, values: field.type.values };
}

/** 主語の軸の値が、主語の値集合(または行なしを表す `absent`)であること。 */
function checkSubjectValues(flow: AuthFlowSpec, subject: SubjectDomain): Finding[] {
  const axis = subjectAxis(flow);
  if (axis === undefined) return [];
  const absent = absentValue(flow);
  const states = new Set(subject.values);
  return flow.branches
    .map((branch) => ({ branch, value: branch.values[axis.id] ?? '' }))
    .filter((entry) => entry.value !== absent && !states.has(entry.value))
    .map((entry) =>
      h1({
        message: `分岐 ${entry.branch.id} の ${axis.id} ${entry.value} は ${subject.name} の値ではありません`,
        location: entry.branch.location,
        suggestion: `${[...states].join(' / ')} か ${absent}(行なし)から選ぶ`,
        counterexample: { branch: entry.branch.id, [axis.id]: entry.value },
      }),
    );
}

/** 主語の全値が最低 1 行で扱われていること(これが「暗黙の挙動の禁止」の本体)。 */
function checkTotality(flow: AuthFlowSpec, subject: SubjectDomain): Finding[] {
  const axis = subjectAxis(flow);
  if (axis === undefined) return [];
  const absent = absentValue(flow);
  const covered = new Set(flow.branches.map((branch) => branch.values[axis.id] ?? ''));
  const findings = subject.values
    .filter((state) => !covered.has(state))
    .map((state) =>
      h1({
        message: `${subject.name} が ${state} の人がサインインしたときの着地が宣言されていません`,
        location: flow.location,
        suggestion: `sign_in に ${axis.id}: ${state} の行を足す(その状態の人を通すのか案内へ送るのかを宣言する)`,
        counterexample: { state },
      }),
    );
  if (!covered.has(absent)) {
    findings.push(
      h1({
        message: `${axis.summary}が無い人(${axis.id}: ${absent})がサインインしたときの着地が宣言されていません`,
        location: flow.location,
        suggestion: `sign_in に ${axis.id}: ${absent} の行を足す`,
      }),
    );
  }
  return findings;
}

/** `lands` の接地と、宣言した着地がすべて使われていること。 */
function checkLandings(flow: AuthFlowSpec): Finding[] {
  const declared = new Set(flow.landings.map((landing) => landing.id));
  const used = new Set(flow.branches.map((branch) => branch.lands));
  const dangling = flow.branches
    .filter((branch) => !declared.has(branch.lands))
    .map((branch) =>
      h1({
        message: `分岐 ${branch.id} の lands ${branch.lands} に対応する着地がありません`,
        location: branch.location,
        suggestion: `landings に宣言された着地(${[...declared].join(' / ') || '未宣言'})から選ぶ`,
        counterexample: { branch: branch.id, lands: branch.lands },
      }),
    );
  const unused = flow.landings
    .filter((landing) => !used.has(landing.id))
    .map((landing) =>
      h1({
        message: `着地 ${landing.id} へ落ちる分岐がありません`,
        location: landing.location,
        suggestion: 'その着地へ落ちる行を sign_in に足すか、着地の宣言を消す(誰も辿り着かない結末を残さない)',
        counterexample: { landing: landing.id },
      }),
    );
  return [...dangling, ...unused];
}

/** `runs` のイベントが実在し、内部実行(role_spec の `kind: system`)が実行できること。 */
function checkRuns(flow: AuthFlowSpec, domain: SpecModel): Finding[] {
  const systemRole = systemRoleId(domain.roles.roles);
  return flow.branches.flatMap((branch) =>
    branch.runs.flatMap((eventId) => {
      const entry = findEvent(domain, eventId);
      if (entry === null) {
        return [
          h1({
            message: `分岐 ${branch.id} の runs ${eventId} に対応するイベントがありません`,
            location: branch.location,
            suggestion: 'state_spec のイベント ID(`{状態機械}.{イベント}`)を書く',
            counterexample: { branch: branch.id, event: eventId },
          }),
        ];
      }
      if (systemRole === undefined || !entry.event.by.includes(systemRole)) {
        return [
          h1({
            message: `分岐 ${branch.id} が実行する ${eventId} は内部実行(role_spec の kind: system)が実行できません`,
            location: branch.location,
            suggestion: `state_spec の ${eventId} の by に内部実行のロールを足すか、この行から runs を外す(サインインの段取りは人ではなくシステムが実行する)`,
            counterexample: { branch: branch.id, event: eventId, by: entry.event.by.join(', ') },
          }),
        ];
      }
      return [];
    }),
  );
}

/**
 * `when` を宣言した軸が、**その条件の行だけ**に現れること。
 *
 * かつてここは「その軸は主語が◯◯の行だけが持つ」という**このアプリ 1 つの判断**を、軸の名前ごと
 * 体系側のコードとして持っていた。いま体系が見るのは「宣言された条件どおりに現れているか」
 * だけであり、条件そのものは仕様の `when` にある。
 */
function checkAxisPresence(flow: AuthFlowSpec, subject: SubjectDomain): Finding[] {
  return flow.axes.flatMap((axis) => {
    const when = axis.when;
    if (when === undefined) return [];
    return flow.branches.flatMap((branch) => {
      const applies = (branch.values[when.axis] ?? '') === when.value;
      const declared = branch.values[axis.id] !== undefined;
      if (applies && !declared) {
        return [
          h1({
            message: `分岐 ${branch.id} は ${when.axis}: ${when.value} の行なのに ${axis.id} を宣言していません`,
            location: branch.location,
            suggestion: `${axis.summary}(${valueHint(axis, subject)})を書く`,
            counterexample: { branch: branch.id, axis: axis.id },
          }),
        ];
      }
      if (!applies && declared) {
        return [
          h1({
            message: `分岐 ${branch.id} は ${when.axis}: ${when.value} の行ではないのに ${axis.id} を宣言しています`,
            location: branch.location,
            suggestion:
              `${axis.id} を消すか、axes.${axis.id}.when の条件を見直す` +
              `(この軸は ${when.axis} が ${when.value} の行だけが持つと宣言されている)`,
            counterexample: { branch: branch.id, axis: axis.id, [when.axis]: branch.values[when.axis] ?? '-' },
          }),
        ];
      }
      return [];
    });
  });
}

/**
 * `labels` の鍵と `when` の値が、その軸が取り得る値であること。
 *
 * `kind: enum` の軸はパーサー(H0)が `values` と突き合わせられるが、**主語の軸の値は
 * state_spec を読める位置でしか判定できない**。綴り違いの表示名・条件は「宣言はあるのに
 * 誰も引かない」という最も気づきにくい形になるので、ここでエラーにする。
 */
function checkAxisValueGrounding(flow: AuthFlowSpec, subject: SubjectDomain): Finding[] {
  const axis0 = subjectAxis(flow);
  const known = (axis: AuthAxisDecl): readonly string[] =>
    axis.id === axis0?.id ? [...subject.values, absentValue(flow)] : axisValues(axis);
  return flow.axes.flatMap((axis) => {
    const allowed = known(axis);
    const bad = Object.keys(axis.labels ?? {}).filter((value) => !allowed.includes(value));
    const findings = bad.map((value) =>
      h1({
        message: `軸 ${axis.id} の labels に ${value} という値はありません`,
        location: axis.location,
        suggestion: `labels の鍵は ${allowed.join(' / ')} のいずれかにする`,
        counterexample: { axis: axis.id, value },
      }),
    );
    const when = axis.when;
    if (when !== undefined) {
      const target = flow.axes.find((candidate) => candidate.id === when.axis);
      const targetAllowed = target === undefined ? [] : known(target);
      if (!targetAllowed.includes(when.value)) {
        findings.push(
          h1({
            message: `軸 ${axis.id} の when が指す ${when.axis}: ${when.value} は、その軸の値ではありません`,
            location: axis.location,
            suggestion: `when の値は ${targetAllowed.join(' / ') || `axes.${when.axis} の値`} のいずれかにする`,
            counterexample: { axis: axis.id, refers: when.axis, value: when.value },
          }),
        );
      }
    }
    return findings;
  });
}

/** その軸に書ける値を人に示す文(主語の軸はドメイン仕様から引いた値を並べる)。 */
function valueHint(axis: AuthAxisDecl, subject: SubjectDomain): string {
  const values = axis.kind === 'enum' ? axisValues(axis) : [...subject.values, axis.absent ?? ''];
  return values.map((value) => axisLabel(axis, value)).join(' / ') || `axes.${axis.id}`;
}
