/**
 * W5: 拡張候補の台帳と、警告の実際の出方が食い違わないこと。
 *
 * 台帳(`extension-candidates.md`)は「どの検査の警告が、どの仕組みの宿題に当たるか」の宣言である。
 * 宣言と実際がずれると、区分が嘘になる。ここが見るのは 5 つ(スキーマ適合と `scope` の値域は
 * `parse-candidates.ts` が同じ W5 で見る):
 *
 *   - **`done` の候補に当たる警告が残っている** … 拡張したと言いながら宿題が消えていない(error)
 *   - **`rules` に実在しない検査 ID がある** … 綴り違い・消えた検査。警告を出す相手がいない(error)。
 *     実在の判定は**全検査の表**(`lib/compose/all-checks.ts`。
 *     各群の登録を束ねたもの)を引く —— 検査を消せば表から消えるので、同じ綴りが別の文字列に残っていても通らない
 *   - **`scope` を付けた候補の `rules` に、その鍵で絞れない検査がある** … 絞りが空振りして、検査の全体に
 *     当たったように見えて当たらない(error)
 *   - **絞りの鍵が存在する検査を `rules` に挙げる候補が、`scope` を持たない** … 鍵の無い候補は検査 ID の全体に
 *     当たるので、理由の混ざる検査では製品の側で直せる警告まで仕組みの宿題に吸い込む(error)。
 *     「鍵が存在する検査」は鍵の定義(`SCOPES` の `verifiers`)から導き、手書きの一覧を持たない
 *   - **候補どうしの当たる範囲が重なる** … 1 つの警告が 2 つの宿題に当たると、区分が決まらない(error)。
 *     同じ検査でも、絞りの鍵が別なら重ならない
 *   - **受け入れた危険の警告が、仕様の宣言に接地していない・理由が空** … 警告の `acceptance` は未分類の門を閉じない区分なので、
 *     検査が勝手に付けて門を抜けられないよう、読めた仕様が宣言した受け入れ(位置と理由)と一致することを見る(error)
 *
 * 「0 件になった候補の done の勧め」は出さない。候補は仕組み全体の宿題で、1 つの製品で 0 件でも終わった
 * とは言えない(製品ごとに出る警告が違う)。状態の管理は人が台帳で行う。
 * 判定は純関数で、警告の出方(`findings`)と検査 ID の集合を受け取るだけである。
 */

import type { AcceptedRiskDecl, Finding } from '../../kernel/finding.js';
import { hitsByCandidate } from '../bucket.js';
import { EXTENSION_LEDGER_DISPLAY, EXTENSION_LEDGER_VERIFIER_ID } from '../../model/extension/loader.js';
import { SCOPED_VERIFIERS, SCOPES, scopesOverlap } from '../scope.js';
import type { ExtensionCandidate, ExtensionLedger } from '../../model/extension/types.js';

/** W5 の入力。 */
export interface ExtensionLedgerInput {
  /** 読めた台帳。 */
  readonly ledger: ExtensionLedger;
  /** 検証の全結果(warning だけが当たりの対象)。W5 自身の Finding は入っていない。 */
  readonly findings: readonly Finding[];
  /** 全検査の表(`lib/compose/all-checks.ts`)にある検査 ID の集合(組み立ての根が渡す)。 */
  readonly knownIds: ReadonlySet<string>;
  /** 読めた仕様が宣言した受け入れた危険(組み立ての根が集める。警告の `acceptance` はこのどれかと一致しなければならない)。 */
  readonly acceptances: readonly AcceptedRiskDecl[];
}

/** W5 の結果。 */
export interface ExtensionLedgerResult {
  /** 違反(error)。 */
  readonly findings: Finding[];
}

/** 台帳の位置の Finding を組む。 */
function problem(
  candidate: ExtensionCandidate,
  pointerKey: string,
  message: string,
  suggestion: string,
  counterexample: Readonly<Record<string, string>>,
): Finding {
  return {
    verifier: EXTENSION_LEDGER_VERIFIER_ID,
    severity: 'error',
    message,
    location: { file: EXTENSION_LEDGER_DISPLAY, pointer: `${candidate.location.pointer ?? ''}${pointerKey}` },
    suggestion,
    counterexample,
  };
}

/** `done` の候補に当たる警告が残っていないか。 */
function doneFindings(ledger: ExtensionLedger, findings: readonly Finding[]): Finding[] {
  return hitsByCandidate(findings, ledger).flatMap(({ candidate, hits }) =>
    candidate.status !== 'done' || hits.length === 0
      ? []
      : [
          problem(
            candidate,
            '.status',
            `拡張候補 ${candidate.id} は done ですが、当たる警告(${candidate.rules.join('・')})が ${String(hits.length)} 件残っています`,
            'まだ拡張が済んでいないなら status を open か decided に戻す。済んだなら残っている警告を消す(仕様を直す)か、当たる範囲が広すぎるなら rules を狭める・scope で絞る',
            { id: candidate.id, rules: candidate.rules.join(','), remaining: String(hits.length) },
          ),
        ],
  );
}

/** `rules` に実在しない検査 ID がないか。 */
function unknownRuleFindings(ledger: ExtensionLedger, knownIds: ReadonlySet<string>): Finding[] {
  return ledger.candidates.flatMap((candidate) =>
    candidate.rules
      .filter((rule) => !knownIds.has(rule))
      .map((rule) =>
        problem(
          candidate,
          '.rules',
          `拡張候補 ${candidate.id} の rules の ${rule} は、全検査の表(lib/compose/all-checks.ts)にありません`,
          '検査 ID の綴りを直す(検査が消えたなら rules から外し、候補が当たる検査が残っていなければ done にする)',
          { id: candidate.id, rule },
        ),
      ),
  );
}

/** `scope` を付けた候補の `rules` が、その鍵で絞れる検査だけか。 */
function scopeFindings(ledger: ExtensionLedger): Finding[] {
  return ledger.candidates.flatMap((candidate) => {
    const scope = candidate.scope;
    if (scope === undefined) return [];
    const definition = SCOPES[scope];
    return candidate.rules
      .filter((rule) => !definition.verifiers.includes(rule))
      .map((rule) =>
        problem(
          candidate,
          '.scope',
          `拡張候補 ${candidate.id} の scope ${scope} は、検査 ${rule} の警告を絞れません(絞れるのは ${definition.verifiers.join('・')} だけ)`,
          '絞れる検査だけを rules に置くか、scope を外して検査の全体に当てる(絞りの鍵は警告の欄を読むので、欄を持たない検査には付けられない)',
          { id: candidate.id, scope, rule },
        ),
      );
  });
}

/** 絞りの鍵が存在する検査を `rules` に挙げる候補が、`scope` を書いているか。 */
function scopeRequiredFindings(ledger: ExtensionLedger): Finding[] {
  return ledger.candidates.flatMap((candidate) => {
    if (candidate.scope !== undefined) return [];
    return candidate.rules
      .filter((rule) => SCOPED_VERIFIERS.has(rule))
      .map((rule) => {
        const keys = Object.entries(SCOPES)
          .filter(([, definition]) => definition.verifiers.includes(rule))
          .map(([key]) => key);
        return problem(
          candidate,
          '.scope',
          `拡張候補 ${candidate.id} の rules の ${rule} は絞りの鍵(scope)がある検査ですが、scope がありません(検査の全体に当たり、製品の側で直せる警告まで仕組みの宿題に吸い込みます)`,
          `scope に ${keys.join(' / ')} のどれかを書く。当たる警告に合う鍵が無いなら、鍵を足してから候補を起票する(鍵なしで検査の全体に当てない)`,
          { id: candidate.id, rule, scopes: keys.join(',') },
        );
      });
  });
}

/** 候補どうしの当たる範囲(検査 ID + 絞り)が重なっていないか(重なった検査 ID 1 つにつき 1 件)。 */
function overlapFindings(ledger: ExtensionLedger): Finding[] {
  const owners = new Map<string, ExtensionCandidate[]>();
  const reported = new Set<string>();
  const found: Finding[] = [];
  for (const candidate of ledger.candidates) {
    for (const rule of candidate.rules) {
      const earlier = owners.get(rule) ?? [];
      const first = earlier.find((other) => scopesOverlap(other.scope, candidate.scope));
      owners.set(rule, [...earlier, candidate]);
      if (first === undefined || reported.has(rule)) continue;
      reported.add(rule);
      found.push(
        problem(
          candidate,
          '.rules',
          `検査 ${rule} が拡張候補 ${first.id} と ${candidate.id} の rules に重なっています`,
          '1 つの警告は 1 つの候補だけが持つ。候補を 1 つにまとめるか、当たる検査を分けるか、別々の scope で絞る',
          { rule, first: first.id, second: candidate.id },
        ),
      );
    }
  }
  return found;
}

/** 受け入れた危険の警告が、読めた仕様の宣言(位置と理由)に接地しているか・理由が空でないか。 */
function acceptanceFindings(findings: readonly Finding[], acceptances: readonly AcceptedRiskDecl[]): Finding[] {
  return findings.flatMap((finding) => {
    const acceptance = finding.acceptance;
    if (acceptance === undefined) return [];
    const where = { file: acceptance.location.file, pointer: acceptance.location.pointer ?? '' };
    const fail = (message: string, suggestion: string): Finding[] => [
      { verifier: EXTENSION_LEDGER_VERIFIER_ID, severity: 'error', message, location: finding.location, suggestion, counterexample: { verifier: finding.verifier, ...where } },
    ];
    if (acceptance.reason.trim() === '') {
      return fail(
        `${finding.verifier} の警告は受け入れた危険として出ていますが、理由が空です`,
        '受け入れの宣言に理由を書く(理由の無い受け入れは、なぜ外してよいのかを誰も確かめられない免除になる)',
      );
    }
    const declared = acceptances.some(
      (decl) => decl.location.file === acceptance.location.file && (decl.location.pointer ?? '') === where.pointer && decl.reason === acceptance.reason,
    );
    if (declared) return [];
    return fail(
      `${finding.verifier} の警告は受け入れた危険として出ていますが、${where.file} の ${where.pointer} に同じ理由の受け入れの宣言がありません`,
      '受け入れた危険は仕様が理由つきで宣言したものだけに付く。検査が宣言から導いていないなら acceptance を付けない(付けると未分類の門を抜けてしまう)',
    );
  });
}

/**
 * 台帳と警告の出方の整合を検査する。
 *
 * @param input 台帳・検証の全結果・検査 ID の集合
 * @returns 違反
 */
export function verifyExtensionLedger(input: ExtensionLedgerInput): ExtensionLedgerResult {
  return {
    findings: [
      ...doneFindings(input.ledger, input.findings),
      ...unknownRuleFindings(input.ledger, input.knownIds),
      ...scopeFindings(input.ledger),
      ...scopeRequiredFindings(input.ledger),
      ...overlapFindings(input.ledger),
      ...acceptanceFindings(input.findings, input.acceptances),
    ],
  };
}
