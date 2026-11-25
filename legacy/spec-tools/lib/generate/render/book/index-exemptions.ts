/**
 * 表紙(docs/book/index.html)の「理由をつけて外している守り」の節。
 *
 * 既定ではかかっている守りのうち、仕様が理由を書いて外した・緩めた宣言を、表紙の先頭で一目で見せる(事実は
 * `semantics/spec-book/exemption-facts.ts`。ここは語と表だけ)。verify が毎回「受け入れた危険」として名指すものには ⚠ を付ける。
 * 1 件も無ければ「外している守りは無い」と 1 行で言う(黙って節を消さない)。
 */

import type { SpecModel } from '../../../model/types.js';
import type { ExemptionFact, ExemptionKind } from '../../../semantics/spec-book/exemption-facts.js';

/** 種類ごとの語(守りの名前・この製品での状態)。 */
const KIND_WORDS: Readonly<Record<ExemptionKind, { readonly guard: string; readonly state: (subjects: string, by: string, on: string) => string }>> = {
  'mfa-exempt': { guard: '多要素認証', state: () => '誰にも求めない' },
  'mfa-delegated': { guard: '多要素認証', state: (subjects) => `${subjects} に任せる(今回のサインインで使ったかは確かめない)` },
  'mfa-roles': { guard: '多要素認証', state: (subjects) => `${subjects} にだけ求める` },
  'bearer-reusable': { guard: '持っていれば効く値の使い捨て', state: (subjects) => `${subjects} を使い回せる` },
  'public-write': { guard: '書き込みにログインを求める', state: (subjects, by, on) => (on === '' ? `${by} に開く${subjects === '' ? '' : `: ${subjects}`}` : `遷移「${on}」を未ログインに開く`) },
  'self-assign': { guard: '役の根拠は役を持つ人だけが書く', state: (subjects, by, on) => `${on === '' ? '' : `遷移「${on}」で `}${by} が ${subjects} を書ける` },
  'tenant-accept': { guard: '読み取りをテナントの境界で狭める', state: (subjects, by) => `${by} の読み取りを ${subjects} で狭めない` },
  'sessions-unbounded': { guard: '同時に持てるセッションの数', state: () => '上限なし' },
  'local-only': { guard: '本番と同じサインインの方式だけを開く', state: (subjects) => `${subjects} をローカルの設定でだけ開く(本番では開かない)` },
  'env-template': { guard: '環境変数を雛形(.env.example)に並べる', state: (subjects) => `${subjects} を並べない` },
};

/**
 * 1 行にまとめる種類(件数が多く、どれも守りの強さに関わらないもの)。変数ごとの理由は章の側にあるので、表紙では名前だけを並べる。
 * まとめないと表紙の表がこの種類で埋まり、上の行(受け入れた危険)が埋もれる。
 */
const FOLDED: Readonly<Partial<Record<ExemptionKind, string>>> = {
  'env-template': '理由は変数ごとに設定の章にある',
};

/** 節の語(HTML 版の表紙も使う)。 */
export const EXEMPTION_WORDS = {
  heading: '理由をつけて外している守り',
  lead:
    '既定ではかかっている守りのうち、この製品が仕様に理由を書いて外したり緩めたりしているもの(仕様の宣言から集めた全数)。' +
    '⚠ は verify が毎回「受け入れた危険」として名指すもので、理由が今も成り立つかを見直す対象である。',
  none: '外したり緩めたりしている守りは無い(既定の守りがすべてかかっている)。',
  headers: ['', '守り', 'この製品では', '理由', '章'],
  accepted: '⚠',
  chapters: { auth: '認証', config: '設定' },
} as const;
const WORDS = EXEMPTION_WORDS;

/** 表の 1 行(語にした後。書き出し方はまだ決めない)。 */
export interface ExemptionRow {
  readonly accepted: boolean;
  readonly guard: string;
  readonly state: string;
  readonly reason: string;
  /** 章: 集約の章なら集約名、横断の章なら `auth` / `config`。 */
  readonly chapter: { readonly kind: 'aggregate'; readonly aggregate: string; readonly label: string } | { readonly kind: 'auth' | 'config'; readonly label: string };
}

/**
 * 事実を表の行にする(同じ種類の畳む行はまとめる・ロールは表示名にする)。表紙は共有の行を使う。
 *
 * @param facts 外している守りの全数
 * @param model ロールと集約の表示名を引く
 */
export function exemptionRows(facts: readonly ExemptionFact[], model: SpecModel): ExemptionRow[] {
  const roleName = (id: string): string => model.roles.roles.find((role) => role.id === id)?.label ?? id;
  const shown: ExemptionFact[] = [];
  for (const fact of facts) {
    const folded = FOLDED[fact.kind];
    const previous = shown.at(-1);
    if (folded !== undefined && previous?.kind === fact.kind) shown[shown.length - 1] = { ...previous, subjects: [...previous.subjects, ...fact.subjects] };
    else shown.push(folded === undefined ? fact : { ...fact, reason: folded });
  }
  return shown.map((fact) => {
    const words = KIND_WORDS[fact.kind];
    const subjects = (fact.kind === 'mfa-roles' ? fact.subjects.map(roleName) : fact.subjects).join('・');
    const by = (fact.by ?? []).map(roleName).join('・');
    const chapter: ExemptionRow['chapter'] =
      fact.source === 'domain' && fact.aggregate !== undefined
        ? { kind: 'aggregate', aggregate: fact.aggregate, label: model.aggregates.get(fact.aggregate)?.entity?.label ?? fact.aggregate }
        : fact.source === 'auth'
          ? { kind: 'auth', label: WORDS.chapters.auth }
          : { kind: 'config', label: WORDS.chapters.config };
    return { accepted: fact.accepted, guard: words.guard, state: words.state(subjects, by, fact.on ?? ''), reason: fact.reason, chapter };
  });
}

