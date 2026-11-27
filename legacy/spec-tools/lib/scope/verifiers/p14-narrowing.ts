/**
 * P14: 実装の範囲は、広がる向きにしか動かせない(base の宣言と、仕様の id で比べる)。
 *
 * 比べるのは path の増減ではなく**同じ仕様が範囲に残っているか**である。
 *   - base にあった id が head の宣言に残っている・head にキーが無い(範囲が全部) → 通る
 *   - base にあった id が消え、その仕様がまだある → error(消えた id を名指す)
 *   - 消え、仕様も無い(廃止・改名) → 通る。件数は 1 行に数える(改名は見分けがつかない)。id は書かない(公開の log に載りうる)
 *   - **「仕様から消えた」と数えるのは head でその種類を error なく読めたときだけ**。読めなかった種類があるとき、持ち主に居ない
 *     base の id は、消えたのか読めないだけなのか分からないので error
 *   - base が読めない(file・YAML・`implemented`)→ error。読み飛ばさない
 *   - base にキーが無い → error にせず 1 行だけ言う(キーを入れるのは持ち主が承認する基準の変更)
 */

import { makeFinding, type Finding } from '../../kernel/finding.js';
import type { ScopeOwner } from '../../kernel/scope-owner.js';
import { PRODUCT_DECL_FILE } from '../../io/paths.js';
import type { ProductImplemented } from '../../model/product/implemented.js';
import type { SpecKind } from '../../model/product/uses.js';
import type { BaseScope } from '../base.js';

/** 検査 ID。 */
export const P14_VERIFIER_ID = 'P14';

/** P14 の入力。 */
export interface NarrowingInput {
  readonly head: ProductImplemented;
  readonly base: BaseScope;
  /** いま仕様が在る持ち主(`scopeOwners` の結果)。 */
  readonly owners: readonly ScopeOwner[];
  /** head で error なく読めなかった種類。 */
  readonly unloaded: readonly SpecKind[];
  /** 不変条件(ドメイン仕様)の読み込みに error があったか(省略は false)。不変条件の持ち主は種類を持たないので別の欄で受ける。 */
  readonly invariantsUnloaded?: boolean;
}

/** P14 の結果。 */
export interface NarrowingResult {
  readonly findings: readonly Finding[];
  /** 「仕様からも消えた」と数えた id の件数。 */
  readonly gone: number;
  /** 公開の log に載せてよい 1 行(id は含まない)。無ければ null。 */
  readonly note: string | null;
}

/** 位置(宣言の `implemented`)。 */
const LOCATION = { file: PRODUCT_DECL_FILE, pointer: 'implemented' } as const;

/** 範囲が狭まっていないかを見る。 */
export function verifyNarrowing(input: NarrowingInput): NarrowingResult {
  const { base } = input;
  if (base.state === 'unreadable') {
    return {
      findings: [
        makeFinding(P14_VERIFIER_ID, {
          message: `base の product.md を比べられません: ${base.reason}`,
          location: LOCATION,
          suggestion: '--implemented-base に、基準の commit の product.md を指す(読める file・正しい YAML・正しい implemented)',
        }),
      ],
      gone: 0,
      note: null,
    };
  }
  if (!base.scope.declared) {
    return {
      findings: [],
      gone: 0,
      note: input.head.declared ? 'base に実装の範囲の宣言(implemented)がありません。キーを入れる変更は基準の変更として扱います(比べるものがありません)' : null,
    };
  }
  if (!input.head.declared) return { findings: [], gone: 0, note: null };

  const headIds = new Set(input.head.ids);
  const known = new Set(input.owners.map((owner) => owner.id));
  const findings: Finding[] = [];
  // 読めなかった種類(か不変条件)があるとき、持ち主に居ない id は、消えたのか読めないだけなのか分からない。
  const unreadable = input.unloaded.length > 0 || input.invariantsUnloaded === true;
  const unreadableNames = [...input.unloaded, ...(input.invariantsUnloaded === true ? ['ドメイン仕様'] : [])];
  let gone = 0;
  let unresolved = 0;
  for (const id of base.scope.ids) {
    if (headIds.has(id)) continue;
    if (known.has(id)) {
      findings.push(narrowed(id, `base の実装の範囲にあった ${id} が範囲から消えています(仕様を廃止するときだけ消せます)`));
    } else if (unreadable) {
      unresolved += 1;
      findings.push(narrowed(id, `base の実装の範囲にあった ${id} が範囲から消えています(仕様を読めなかった種類があり、仕様ごと廃止されたのか判定できません)`));
    } else {
      gone += 1;
    }
  }
  if (unresolved > 0) {
    findings.push(
      makeFinding(P14_VERIFIER_ID, {
        message: `head で読めなかった仕様の種類(${unreadableNames.join(' / ')})があり、base の id ${String(unresolved)} 件が仕様ごと廃止されたのか判定できません`,
        location: LOCATION,
        suggestion: '先に仕様の読み込みの error を直して、検証をやり直す(読めないまま「廃止された」と数えない)',
      }),
    );
  }
  const note = gone === 0 ? null : `base の実装の範囲にあった id のうち、仕様からも消えたものが ${String(gone)} 件あります(廃止か改名。改名は見分けがつきません)`;
  return { findings, gone, note };
}

/** 範囲が狭まった指摘 1 件。 */
function narrowed(id: string, message: string): Finding {
  return makeFinding(P14_VERIFIER_ID, {
    message,
    location: LOCATION,
    suggestion: `implemented に ${id} を戻す(範囲は広げる向きにしか動かせない。仕様を廃止するなら、仕様を消してから範囲から外す)`,
    counterexample: { id },
  });
}
