/**
 * 画面の到達の判定 — 関係の層の 2 つ目の住人の入口。
 *
 * **ここが「どの画面に、だれが、どこから届くか」を決める唯一の入口である。** 画面の到達は、画面(screen_spec)と、
 * 起点を与える側(`entry_point` 全部 = S13 / L2、ユースケースの `start` = Y3 / S16 / 通る画面の数え)の関係で、
 * 以前は探索が `lib/screen/` と `lib/usecase/` に別々にいて互いを読み合っていた(種類のディレクトリの相互依存)。
 * ここでは入力(`ReachabilityInput`)から**型つきの値(`ScreenReachability`)**を作り、検査・生成・導出は
 * その値に**起点・ロール・遷移を引数にして**問う。探索の実装は 1 つで、起点の違いは `ReachStart` の引数だけである
 * (設計メモ framework-modules §7 の教訓 1: 層の間の約束は名前のついた中間表現にする)。
 *
 * **入力の状態**(`kernel/input-state.ts`): 画面の入力と認証フローの関門の入力は `CatalogInput`(未選択 / 阻害 / 読込済み)で受ける。
 * 読込済みでない入力は**使わず**(画面 0 枚・関門 0 本として探索する)、使わなかったことを `gaps` で返す。0 件の読込済みは阻害ではない。
 * 関門の未選択は「関門は無い」という事実で、`gaps` に載せない(阻害だけが載る。関門が分からないまま探索すると入れない画面にも入れると見積もる)。
 * 読み手(S13・S16・Y3・Y5)は、この `gaps` を受け取って(`verify/reachability-notes.ts`)、使えないときは判定を出さず
 * 「未実施 / 阻害」の行で見ていないことを言う(A13 / T2 と同じ形。`verify/check-run-report.ts`)。生成・導出(L2・ハンドブック・
 * 導出の指標)は検査ではないので `gaps` を行では報告しない(使えない画面は 0 枚として扱う)が、**関門の阻害だけは生成物が言う**
 * (`gatesBlocked`。空の関門で探索した到達を「到達 0」と断定せず、「確かめていない」と書く。関門の入力の状態は生成の文脈が運ぶ)。
 *
 * 関係の層は前段(`lib/model/**`)・土台(kernel / guard)・意味の事実の**葉**(`lib/semantics/` の名指しの本)だけを読む。
 * 種類のディレクトリの解析(検査・生成)は、値でも型でも読まない(`CLOSURE_BANS` と層の向きが見る)。
 */

import type { CatalogInput } from '../../kernel/input-state.js';
import { availableLoad, catalogInput } from '../../kernel/input-state.js';
import type { AuthGateDecl } from '../../model/auth/types.js';
import { anonymousRoleId, systemRoleId } from '../../model/role-hierarchy.js';
import type { ScreenSpec, ScreenSpecModel } from '../../model/screen/types.js';
import type { SpecModel } from '../../model/types.js';
import { buildExposedByMap } from './exposure.js';
import { reachFrom } from './reach.js';
import { roleCanEnter } from './role-entry.js';
import { findStateRoleReach } from './state-role-reach.js';
import type { ReachabilityGap, ReachabilityInput, ScreenReachability } from './types.js';

export type {
  ReachabilityGap,
  ReachabilityInput,
  ReachabilityInputName,
  ReachStart,
  ScreenReach,
  ScreenReachability,
  StateRoleReach,
} from './types.js';
export { roleCanEnter } from './role-entry.js';

/** 入力が使えないときの欠け(未選択 / 阻害)。使えるなら空。関門の未選択は事実(関門は無い)なので載せない。 */
function gapsOf(screens: CatalogInput<ScreenSpecModel>, gates: CatalogInput<readonly AuthGateDecl[]>): readonly ReachabilityGap[] {
  const screenGap: readonly ReachabilityGap[] =
    screens.state === 'loaded'
      ? []
      : [screens.state === 'unselected' ? { input: 'screens', state: 'unselected' } : { input: 'screens', state: 'blocked', reason: screens.reason }];
  const gateGap: readonly ReachabilityGap[] = gates.state === 'blocked' ? [{ input: 'auth', state: 'blocked', reason: gates.reason }] : [];
  return [...screenGap, ...gateGap];
}

/**
 * 画面の到達の判定を作る(入口)。
 *
 * @param input ドメイン・画面の入力の状態・auth_spec の関門の入力の状態
 * @returns 起点・ロール・遷移を引数にして問える値。使えなかった画面の分は 0 枚として探索し、理由を `gaps` で返す
 */
export function deriveScreenReachability(input: ReachabilityInput): ScreenReachability {
  const { domain } = input;
  const gates: readonly AuthGateDecl[] = input.gates.state === 'loaded' ? input.gates.value : [];
  const screens: readonly ScreenSpec[] = input.screens.state === 'loaded' ? input.screens.value.screens : [];
  const anonymousRole = anonymousRoleId(domain.roles.roles);
  const systemRole = systemRoleId(domain.roles.roles);
  const canEnter = (screen: ScreenSpec, role: string): boolean => roleCanEnter(domain, gates, screen, role, anonymousRole);
  const reach: ScreenReachability['reach'] = (role, start) => reachFrom(screens, (screen) => canEnter(screen, role), role, start);
  const exposedBy = buildExposedByMap(domain, screens);
  const tools = { domain, systemRole, exposedBy, canEnter, entryReach: (role: string) => reach(role, { kind: 'entry-points' }) };
  return {
    gaps: gapsOf(input.screens, input.gates),
    canEnter,
    reach,
    exposedBy,
    stateRoleReach: (guards, entry) => findStateRoleReach(tools, guards, entry),
  };
}

/**
 * 読み込み済みの関門の一覧を、読込済みの入力の状態にする(呼び手が関門の入力の状態を持たない = 読めた関門だけを知る検査・生成のための口)。
 * 関門の入力の状態を持つ呼び手(検査の配線・生成の文脈)は、持っている状態をそのまま渡す。
 *
 * @param gates auth_spec の `gates`(無ければ空)
 */
export function loadedGates(gates: readonly AuthGateDecl[]): CatalogInput<readonly AuthGateDecl[]> {
  return { state: 'loaded', value: gates, findings: [] };
}

/**
 * 関門の入力が阻害か(採ったのに関門が分からない)。生成側がこれを見て、到達に依る欄を「確かめていない」と書く。
 * 未選択(関門は無い事実)と読込済みは false。
 *
 * @param gates 関門の入力の状態
 */
export function gatesBlocked(gates: CatalogInput<readonly AuthGateDecl[]>): boolean {
  return gates.state === 'blocked';
}

/**
 * 関門の入力が阻害のとき、関門に依る生成物の欄に書く言葉(関門が分からないまま探索した値を、「到達 0」などと断定しない)。
 *
 * @param what 確かめていないこと(例: `到達`。「は」が続く名詞)
 */
export function gatesUnverifiedNote(what: string): string {
  return `${what}は auth が阻害のため確かめていない`;
}

/**
 * 読み込み済みのモデルだけを持つ呼び手(検査・生成・導出。`product.md` の `uses` を知らない)のための口。
 * 画面は、無い(`undefined`)・`available: false` を、選択を推定せずに「阻害(読み込みが無い / 置き場に仕様が無い)」として扱う。
 * 関門は**入力の状態で受ける**(呼び手が `uses` と読み込みの結果から決めた状態。阻害のとき、関門が分からないまま空の関門で探索せず、
 * 使えなかったことを `gaps` で返す)。導出は `deriveScreenReachability` と同じ(別の導出を持たない)。
 *
 * @param domain ドメイン仕様全体
 * @param screens 読み込んだ画面のモデル
 * @param gates auth_spec の `gates` の入力の状態(関門の一覧だけを持つ呼び手は `loadedGates`)
 */
export function screenReachabilityOfModels(
  domain: SpecModel,
  screens: ScreenSpecModel | undefined,
  gates: CatalogInput<readonly AuthGateDecl[]>,
): ScreenReachability {
  return deriveScreenReachability({
    domain,
    screens: catalogInput('selected', screens === undefined ? undefined : availableLoad(screens)),
    gates,
  });
}
