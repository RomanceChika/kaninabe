/**
 * V26 の**状態遷移の側**(A3-1)—— 遷移を起こせる人が、他のテナントの行を動かせないか。
 *
 * 遷移は境界の列を人の入力で書く口ではない(付け替えは `creates` / `writes` の話)。しかし**他のテナントの行を動かす**こと
 * (取消・承認・無効化)そのものは書き込みであり、`deletes` に境界を求めるのと同じ理由で遷移にも求める。
 * `by` に**対象に依らず立つ**ロール(既定のログインロール・`claim` のロール)があるのにガードが境界を結ばなければ、
 * そのロールの人は他社の行の id を知るだけで遷移を起こせる(実行器は判断材料をサービスロールで読む)。
 *
 * ## 何を見るか
 *
 * 境界の候補(`writeCandidates` の編集・削除と同じ束 —— 入力の参照の欄を経る候補は除く。遷移は親を付け替えない)ごとに、
 * `by` のロールのうち次のものについて、`guard` のトップレベルの `and` の項に「境界の列 == actor.{欄}」が無ければ **error**。
 *
 *   - **`binding` のロールも結ぶ**(A5-2)—— binding は「人と行の関係」で、「行が実行者のテナントにある」ではない。境界の属性が
 *     人の側で変わる製品(部署は人事の同期で変わる)では、異動した起案者は元の部署の文書の起案者のままで、guard に境界の項が無ければ
 *     元の部署の文書を遷移させ続けられる。同じロールの**編集**(`writes`)は `when` で境界を求められるので、遷移も揃える
 *     (境界が人の側で変わらない製品は、理由を書いて `accept` で受け入れる)。
 *   - **対象外**: システム起点 —— 境界を結びようが無く、内部実行の遷移は入口(受信・走査)が対象の行を決める。
 *   - **未ログイン**(A4-3): 境界は結びようが無いが、id を知る人が他のテナントの行を動かせる形を黙って通さない ——
 *     書き込み(`creates` / `writes` / `deletes`)の同じ場面と揃えて **warning**(受け入れは `on: [transition]`)。
 *
 * ガードで結べば生成物も結ぶ(遷移の RPC の述語にガードがそのまま入る。`rpc-authz.ts`)。`records_actor` が binding の根拠の列を
 * 書く遷移(他社の行で自分にロールを付ける形)も、この規則で止まる —— 行が他社のものなら、遷移そのものが許されない。
 *
 * 受け入れは `accept: [{ by, filter, on: [transition], events: [...], reason }]`(書き込みと同じく既定では受け入れない)。
 * **`events` で遷移を名指す**(A4-4。パーサーが必須にする)—— 理由は 1 つの遷移について書かれるので、ロール × 列だけで効かせると、
 * 後から足した同じロールの遷移(取消・無効化)の境界まで黙って外れる。名指されていない遷移には効かない。
 *
 * **この部品はテナントの語を 1 つも持たない。**
 */

import type { AccessSpec, EventDef, RoleDef, SpecModel } from '../../model/types.js';
import type { GuardExpr } from '../../guard/ast.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext } from '../../check-api/contract.js';
import { anonymousRoleId } from '../../model/role-hierarchy.js';
import { ACTORLESS_ROLE_KINDS } from './tenant-boundary-model.js';
import type { WriteCandidate } from './v26-write-candidates.js';
import { acceptEventSpellings, resolveAcceptEvent } from '../../model/accept-events.js';

/** 遷移の検査 1 回ぶんの材料。 */
export interface TransitionCheckInput {
  readonly model: SpecModel;
  readonly access: AccessSpec;
  readonly events: readonly EventDef[];
  /** 編集・削除と同じ候補(入力の参照の欄を経る候補を含んでいてよい。ここで除く)。 */
  readonly candidates: readonly WriteCandidate[];
  readonly ctx: VerifyContext;
  /** `when` / `guard` のトップレベルの `and` の項(読めなければ null)。 */
  readonly conjunctsOf: (expression: string | undefined) => readonly GuardExpr[] | null;
  /** 項のどれかが候補を結んでいるか。 */
  readonly binds: (terms: readonly GuardExpr[], candidate: WriteCandidate) => boolean;
}

/**
 * 遷移を起こせる人が他のテナントの行を動かせる形を報告する。
 *
 * @param input 材料
 * @param verifier 報告する検証器の ID
 * @returns 違反のリスト
 */
export function checkTransitions(input: TransitionCheckInput, verifier: string): Finding[] {
  const roles = new Map<string, RoleDef>(input.model.roles.roles.map((role) => [role.id, role]));
  const anonymous = anonymousRoleId(input.model.roles.roles);
  const candidates = input.candidates.filter((candidate) => candidate.via === null);
  const findings: Finding[] = [];
  for (const event of input.events) {
    const terms = input.conjunctsOf(event.guard);
    // 読めない式は V2 / V9 が error で報告する(ここで二重に言わない)。
    if (terms === null) continue;
    for (const by of event.by) {
      const need = boundaryNeed(roles.get(by), anonymous);
      if (need === 'none') continue;
      // 未ログインは結びようが無いので、候補の先頭 1 つで名指せば足りる(書き込みの actorless と同じ)。
      for (const candidate of need === 'actorless' ? candidates.slice(0, 1) : candidates) {
        if (need === 'bind' && input.binds(terms, candidate)) continue;
        if (acceptedTransition(input.access, by, event, input.events, candidate)) continue;
        findings.push(need === 'bind' ? finding(input.access, event, input.events, by, candidate, verifier) : anonymousFinding(input.access, event, input.events, by, candidate, verifier));
      }
    }
  }
  return findings;
}

/**
 * そのロールの遷移に何を求めるか。
 *
 *   - `bind`: 実行者のいるロール(対象に依らず立つロール **と binding のロール**。A5-2: 編集の `when` と揃える)—— guard で境界を結ぶ(無ければ error)
 *   - `actorless`: 未ログイン —— 結びようが無いが、誰も宣言しない形を warning で名指す(A4-3)
 *   - `none`: システム起点(入口が対象の行を決める)・未定義のロール
 */
export function boundaryNeed(role: RoleDef | undefined, anonymous: string | undefined): 'bind' | 'actorless' | 'none' {
  if (role === undefined) return 'none';
  if (role.binding !== undefined || role.kind === undefined || !ACTORLESS_ROLE_KINDS.has(role.kind)) return 'bind';
  return role.id === anonymous ? 'actorless' : 'none';
}

/**
 * その規則・列・**遷移の定義**を名指し、遷移を受け入れる `accept` があるか(A4-4: `events` に無い遷移には効かない)。
 *
 * 名指しは遷移の定義の単位で解く(A5-1): 同じイベント ID の定義が 2 本以上あると、ID だけの名指しは曖昧で**どれにも効かない**
 * (V2 が error にする)。`{ID}@{遷移元の状態}` で絞った名指しは、その状態を遷移元に持つ 1 本にだけ効く。
 * `events` の無い `on: [transition]` はパーサーが違反にする。ここでも効かせない(後から足した遷移を黙って受け入れない)。
 */
function acceptedTransition(access: AccessSpec, by: string, event: EventDef, events: readonly EventDef[], candidate: WriteCandidate): boolean {
  return access.accepts.some(
    (entry) =>
      entry.by === by &&
      (entry.on ?? []).includes('transition') &&
      (entry.events ?? []).some((raw) => {
        const resolved = resolveAcceptEvent(raw, events, by);
        return resolved.kind === 'ok' && resolved.event === event;
      }) &&
      candidate.acceptFields.includes(entry.field),
  );
}

/** 受け入れの書き方(遷移の定義を名指す。同じ ID の定義がほかにあれば遷移元の状態で絞る)。 */
function acceptText(by: string, column: string, event: EventDef, events: readonly EventDef[], reason: string): string {
  const spelling = acceptEventSpellings(event, events, by)[0] ?? `${event.id}@{遷移元の状態}`;
  return `access_spec に "accept: [{ by: ${by}, filter: ${column}, on: [transition], events: [${spelling}], reason: {${reason}} }]" を足して受け入れてください`;
}

/** 指摘 1 件。 */
function finding(access: AccessSpec, event: EventDef, events: readonly EventDef[], by: string, candidate: WriteCandidate, verifier: string): Finding {
  const column = candidate.acceptFields[0] ?? '';
  const path = candidate.bindPaths[0] ?? '';
  return {
    verifier,
    severity: 'error',
    message:
      `${access.entity} の遷移 ${event.id}(by: ${by})は、実行者の属性を表す列 ${column} を actor.${candidate.boundary} に結ぶ guard を持っていません ` +
      '—— 他のテナントの行(binding のロールなら、結ばれたあとで境界の属性が変わった人の元の境界の行)を遷移させられる形です',
    location: event.location,
    suggestion:
      `guard に "${path} == actor.${candidate.boundary}" を and の項として足して境界を結ぶか` +
      (candidate.bindPaths.length > 1 ? `(結べる列: ${candidate.bindPaths.join(' / ')})` : '') +
      `、他のテナントに届かない理由が別にあるなら ${acceptText(by, column, event, events, 'なぜ跨がないか')}` +
      '(binding のロールも結ぶ —— 行と結ばれた人の境界の属性が変わっても、元の境界の行を動かせないように)',
    counterexample: { entity: access.entity, key: 'events', event: event.id, by, column, boundary: candidate.boundary },
  };
}

/** 未ログインのロールがテナントを持つ行を遷移させられる、という指摘 1 件(A4-3。warning)。 */
function anonymousFinding(access: AccessSpec, event: EventDef, events: readonly EventDef[], by: string, candidate: WriteCandidate, verifier: string): Finding {
  const column = candidate.acceptFields[0] ?? '';
  return {
    verifier,
    severity: 'warning',
    message:
      `${access.entity} の遷移 ${event.id}(by: ${by})は未ログインのロールで、実行者の属性を表す列 ${column} を持つ行を遷移させられます ` +
      '—— 境界を結びようが無いので、id を知る人が他のテナントの行を動かせるかを誰も宣言していません',
    location: event.location,
    suggestion:
      `未ログインの遷移がテナントを跨いでよい(または跨がない)理由を、${acceptText(by, column, event, events, 'なぜ跨いでよいか')}。` +
      '跨がせたくないなら、ログインしたロールの遷移にする',
    counterexample: { entity: access.entity, key: 'events', event: event.id, by, column, boundary: candidate.boundary, kind: 'actorless' },
  };
}
