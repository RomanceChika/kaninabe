/**
 * H2 着地と関門の接地 — 画面仕様・実装との突合。
 *
 * auth-spec-writing.md の要求:
 *   - `landings[].screen` が実在する画面であり、**引数なしで送れる route** であること
 *   - 案内画面の排他表示(`variants`)と着地が**双方向に一致**すること
 *     (着地を 1 つ足したら案内の出し分けを足さないと通らない・逆も同じ)。ただし
 *     **その画面への着地が 1 つでも `variant` を宣言したときだけ**である —— `variants` は
 *     レイアウトの語彙でもあり、サインインの着地と無関係な出し分けをこの検証器が
 *     エラーにしてはならない(束 ⑲-2b。checkVariantParity の doc)
 *   - 関門の送り先が実在し、**その画面自身がログインを要求しない**こと(無限リダイレクトの禁止)
 *   - 関門の `implementation` が実在すること(関数名まで見る)。**`app/` が無い構成では飛ばす**
 *     —— 仕様だけを持つリポジトリは正当な形であり、実装を見る項は「無い」ではなく飛ばすのが正しい
 *     (`appGrounded` を共有する X1・J2・G8・S7・A11 と同じ判定。束 ⑲-1 #2 の一般則)
 *
 * 2 番目がこの検証器の中心である。「無効化された人が /guest に着いたとき何が出るか」は
 * 画面仕様の `variants` にあり、「どういう人がそこへ着くか」は認証フロー仕様にある。
 * 別々の文書に住む以上、片方だけ増えた状態を機械が落とさなければ静かにズレる。
 */

import path from 'node:path';
import { appGrounded, isFile } from '../../io/paths.js';
import { readText } from '../../io/read-text.js';
import type { Finding } from '../../kernel/finding.js';
import { absentFor } from '../../kernel/scope-owner.js';
import { AUTH_FLOW_ID } from '../../model/auth/parse-auth.js';
import { inputValue, type CatalogInput } from '../../kernel/input-state.js';
import { dynamicParams } from '../../model/screen/route-syntax.js';
import type { ScreenSpec, ScreenSpecModel } from '../../model/screen/types.js';
import type { AuthFlowSpec, AuthSpecModel } from '../../model/auth/types.js';
import type { ProductRoots } from '../../model/product/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'H2';

/** H2 の指摘を組み立てる。 */
function h2(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** H2 の入力。 */
export interface LandingGroundingInput {
  readonly auth: AuthSpecModel;
  /**
   * 画面仕様の入力の状態。画面との突合(着地先の実在・排他表示の一致・関門の送り先)は読込済みのときだけ判定する(欠けた画面で「画面がありません」と言わない)。
   * 未選択は何も判定しない。**阻害**でも、画面に依らない関門の実装の実在は判定する(行は呼び手が言う)。
   */
  readonly screens: CatalogInput<ScreenSpecModel>;
  /** リポジトリルートの絶対パス(関門の実装の実在を見る)。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(実装の木があるかの判定に使う)。 */
  readonly roots: ProductRoots;
}

/**
 * 着地と関門の接地を検証する。
 *
 * @param input 認証フロー仕様・画面仕様・リポジトリルート
 * @returns 違反のリスト
 */
export function verifyLandingGrounding(input: LandingGroundingInput): Finding[] {
  const flow = input.auth.flow;
  if (flow === null) return [];
  // 関門の `implementation` の実在は画面に依らない(実装の木とこのファイルだけで決まる)ので、画面が阻害でも見る。
  // 未選択は画面を前提にする検査をまるごと回さない(画面が無い構成は正当 — `run.ts` の `screensUnselected`)。
  const implementations = appGrounded(input.repoRoot, input.roots.app) ? checkGateImplementations(flow, input.repoRoot) : [];
  if (input.screens.state === 'blocked') return implementations;
  const screens = inputValue(input.screens);
  if (screens === undefined || !screens.available) return [];
  const byId = new Map(screens.screens.map((screen) => [screen.id, screen]));
  return [...checkLandingScreens(flow, byId), ...checkVariantParity(flow, byId), ...checkGates(flow, byId), ...implementations];
}

/** 着地先の画面が実在し、引数なしで送れること。 */
function checkLandingScreens(flow: AuthFlowSpec, byId: ReadonlyMap<string, ScreenSpec>): Finding[] {
  return flow.landings.flatMap((landing) => {
    const screen = byId.get(landing.screen);
    if (screen === undefined) {
      return [
        h2({
          message: `着地 ${landing.id} の screen ${landing.screen} に対応する画面がありません`,
          location: landing.location,
          suggestion: 'screen_spec の id(例: screen-guest)を書く',
          counterexample: { landing: landing.id, screen: landing.screen },
        }),
      ];
    }
    if (dynamicParams(screen.route).length > 0) {
      return [
        h2({
          message: `着地 ${landing.id} の送り先 ${screen.route} は動的セグメントを持ちます`,
          location: landing.location,
          suggestion:
            'サインイン直後に送れるのは引数の要らない画面だけである(何を入れるかを認証層が決められない)。引数なしの画面を着地先にする',
          counterexample: { landing: landing.id, route: screen.route },
        }),
      ];
    }
    return [];
  });
}

/**
 * 案内画面の排他表示と着地の双方向一致。
 *
 * **双方向に閉じるのは「着地が variant を名指した画面」だけである**(束 ⑲-2b)。
 * `variants` はレイアウトの語彙であり、「誰がサインインの結果ここへ着くか」とは本来
 * 無関係な出し分け(ロールで出し分ける作成ボタン・読み取り専用の表示)にも使われる。
 * 以前はこの検証器が「landings が指す画面に variants があれば、その全部が着地の対象」と
 * 見なしていたため、**ログインと無関係な排他表示を画面に書くと認証の検査がエラーにする**という、
 * 語彙の混同が起きていた(束 ⑱ の実測 —— テナントの題材が auth_spec をまったく
 * 書けなかった理由がこれである)。
 *
 * 新しい線引きは「着地の宣言が variant を持ったら、その画面は認証の関心の中に入る」——
 * 入った画面については**これまでと同じ双方向の保証**が残る(着地を 1 つ足したら出し分けを
 * 足さないと通らない・逆も同じ)。宣言しなければ、その画面の `variants` はレイアウトの
 * 出し分けとして認証の外にある。題材の製品の `screen-guest`(5 着地が 5 variant を名指す)では
 * 判定は 1 件も変わらない。
 */
function checkVariantParity(flow: AuthFlowSpec, byId: ReadonlyMap<string, ScreenSpec>): Finding[] {
  const findings: Finding[] = [];
  const byScreen = new Map<string, typeof flow.landings>();
  for (const landing of flow.landings) {
    byScreen.set(landing.screen, [...(byScreen.get(landing.screen) ?? []), landing]);
  }
  for (const [screenId, landings] of byScreen) {
    const screen = byId.get(screenId);
    if (screen === undefined) continue;
    const keys = variantKeys(screen);
    // 着地が 1 つも variant を宣言しない画面は、認証の関心の外(排他表示はレイアウトの語彙)。
    const claimed = landings.some((landing) => landing.variant !== undefined);
    if (!claimed) continue;
    for (const landing of landings) {
      if (keys.size === 0 && landing.variant !== undefined) {
        findings.push(
          h2({
            message: `着地 ${landing.id} は variant を宣言していますが ${screenId} に排他表示はありません`,
            location: landing.location,
            suggestion: 'variant を消すか、画面仕様に variants を宣言する',
            counterexample: { landing: landing.id, variant: landing.variant },
          }),
        );
        continue;
      }
      if (keys.size > 0 && landing.variant === undefined) {
        findings.push(
          h2({
            message: `着地 ${landing.id} は排他表示を持つ画面 ${screenId} へ落ちるのに variant がありません`,
            location: landing.location,
            suggestion: `variant に ${[...keys].join(' / ')} のいずれかを書く(その人に何が出るかを宣言する)`,
            counterexample: { landing: landing.id, screen: screenId },
          }),
        );
        continue;
      }
      if (landing.variant !== undefined && !keys.has(landing.variant)) {
        findings.push(
          h2({
            message: `着地 ${landing.id} の variant ${landing.variant} は ${screenId} に宣言されていません`,
            location: landing.location,
            suggestion: `画面仕様の variants(${[...keys].join(' / ')})から選ぶか、画面側に足す`,
            counterexample: { landing: landing.id, variant: landing.variant },
          }),
        );
      }
    }
    findings.push(...checkUnreachedVariants(screen, keys, landings));
  }
  return findings;
}

/** 画面が持つのに誰も落ちてこない排他表示(出し分けの取り残し)。 */
function checkUnreachedVariants(
  screen: ScreenSpec,
  keys: ReadonlySet<string>,
  landings: AuthFlowSpec['landings'],
): Finding[] {
  const used = new Set(landings.map((landing) => landing.variant));
  return [...keys]
    .filter((key) => !used.has(key))
    .map((key) =>
      h2({
        message: `画面 ${screen.id} の排他表示 ${key} へ落ちる着地がありません`,
        location: screen.location,
        suggestion:
          'その表示になる人を landings に宣言するか、画面から variants を消す(誰も見ない出し分けを残さない)',
        counterexample: { screen: screen.id, variant: key },
      }),
    );
}

/** 画面が宣言した排他表示のキー。 */
function variantKeys(screen: ScreenSpec): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const slot of screen.layout.slots) {
    for (const component of slot.components) {
      if (component.variant !== undefined) keys.add(component.variant.key);
    }
  }
  return keys;
}

/** 関門の送り先が実在し、その画面自身が関門に掛からないこと。 */
function checkGates(flow: AuthFlowSpec, byId: ReadonlyMap<string, ScreenSpec>): Finding[] {
  return flow.gates.flatMap((gate) => {
    if (gate.to === undefined) return [];
    const screen = byId.get(gate.to);
    if (screen === undefined) {
      return [
        h2({
          message: `関門 ${gate.id} の送り先 ${gate.to} に対応する画面がありません`,
          location: gate.location,
          suggestion: 'screen_spec の id(例: screen-login)を書く',
          counterexample: { gate: gate.id, to: gate.to },
        }),
      ];
    }
    if (gate.guards === 'requires_auth' && screen.requiresAuth) {
      return [
        h2({
          message: `関門 ${gate.id} の送り先 ${gate.to} 自身がログインを必要とします`,
          location: gate.location,
          suggestion: '送り先を requires_auth でない画面にする(そうしないと同じ関門に掛かって無限に送り返される)',
          counterexample: { gate: gate.id, to: gate.to },
        }),
      ];
    }
    return [];
  });
}

/** 関門の実装(`パス::関数名`)が実在すること。 */
function checkGateImplementations(flow: AuthFlowSpec, repoRoot: string): Finding[] {
  return flow.gates.flatMap((gate) => {
    const [file, symbol] = gate.implementation.split('::');
    const absolute = file === undefined ? '' : path.join(repoRoot, file);
    if (file === undefined || symbol === undefined || !isFile(absolute)) {
      const missing = h2({
        message: `関門 ${gate.id} の implementation ${gate.implementation} が実在しません`,
        location: gate.location,
        suggestion: '"リポジトリルート相対パス::関数名" の形で、実在するモジュールと関数を指す',
        counterexample: { gate: gate.id, implementation: gate.implementation },
        grounding: 'implementation',
      });
      // 印は、書き方が正しいのにファイルが無い純粋な不在だけ(`パス::関数名` の形でない書き方の誤りは、範囲で外さない)。
      const wellFormed = file !== undefined && file !== '' && symbol !== undefined && symbol !== '';
      return [wellFormed ? absentFor({ kind: 'catalog', id: AUTH_FLOW_ID }, missing) : missing];
    }
    if (!readText(absolute).includes(symbol)) {
      return [
        h2({
          message: `関門 ${gate.id} の実装に ${symbol} がありません`,
          location: gate.location,
          suggestion: `${file} に ${symbol} を実装するか、implementation を実際の関数名に直す`,
          counterexample: { gate: gate.id, symbol },
          grounding: 'implementation',
        }),
      ];
    }
    return [];
  });
}
