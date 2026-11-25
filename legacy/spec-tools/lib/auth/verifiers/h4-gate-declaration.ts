/**
 * H4 関門の宣言 — screen_spec ⇔ auth_spec の双方向一致。
 *
 * auth-spec-writing.md の要求:「画面が掛かる関門は screen_spec の宣言から**機械的に**導かれ
 * (`requires_auth: true` → `guards: requires_auth` / `for: [{role}]` → `guards: role_gate`)、
 * その関門が `gates` に宣言されている。逆に、誰の画面も掛からない関門は警告」。
 *
 * 対応は 2 本だけの**閉じた辞書**であり、新しい語彙は増やさない(`GATE_SUBJECTS` がその値域)。
 * `role_gate` が見るロール ID は仕様側の宣言(`gates[].role`)であり、ここではロール名を
 * 決め打ちしない(かつては `STAFF_ROLE_ID = 'staff'` として仕組み側に固定していた)。
 * H2 は「関門の送り先・実装が実在するか」までしか見ておらず、「そもそもこの画面はどの関門に
 * 掛かるのか」を画面の宣言から導いて突き合わせる経路が無かった —— 関門を 1 つ増やしても、
 * どの画面がそれに掛かるべきかを機械は知らないままだった。ここがその欠けている半分を塞ぐ。
 *
 * **実装が本当にその関門を呼んでいるか**(`requireSession()` / `requireStaff()` の呼び出し)は
 * ここでは見ない —— screenTest 側の静的走査(`app/src/app/__screens__/gate-implementation.test.ts`)
 * が H2 の実装実在検査の延長として担う(検証器は仕様の閉世界を見る層、実装呼び出しの走査は
 * app 側のテストの層、という役割分担は auth-spec-writing.md の他の検査と同じ)。
 *
 * 「画面の宣言から掛かる関門を導く」写像(`requiredGuardsOf`)は意味解析の層
 * (`lib/semantics/required-guards.ts`)にある —— ナビの可視性の生成・ロールの到達・手数の数え方も
 * 同じ写像を読むので、検証器のファイルには置かない。
 */

import type { Finding } from '../../kernel/finding.js';
import type { CatalogInput } from '../../kernel/input-state.js';
import { readableValue } from '../../kernel/readable-value.js';
import { requiredGuardsOf, roleGateOf } from '../../semantics/required-guards.js';
import type { ScreenSpec, ScreenSpecModel } from '../../model/screen/types.js';
import type { AuthFlowSpec, AuthGateDecl, GateSubject } from '../../model/auth/types.js';
import { specPath } from '../../model/product/paths.js';
import type { SpecModel } from '../../model/types.js';
import type { ProductRoots } from '../../model/product/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'H4';

/** H4 の指摘を組み立てる。 */
function h4(args: Omit<Finding, 'verifier' | 'severity'> & { severity?: Finding['severity'] }): Finding {
  return { severity: 'error', ...args, verifier: VERIFIER_ID };
}

/**
 * 関門の宣言(screen_spec ⇔ auth_spec)を検証する。
 *
 * @param auth 読み込み済みの認証フロー仕様(null なら auth_spec 自体が壊れている = 他の検証器が指摘済み)
 * @param screensInput 画面仕様の入力の状態(読込済み = 双方向に判定する。**仕様を落とした阻害**は読めた画面が掛かる関門の宣言漏れだけを判定する —
 *   「どの画面も掛からない関門」は落とした画面が掛かっているかもしれないので言わない。未選択と、読めない阻害は何も判定しない。阻害は呼び手が行で言う)
 * @returns 違反のリスト
 */
export function verifyGateDeclaration(
  auth: AuthFlowSpec | null,
  screensInput: CatalogInput<ScreenSpecModel>,
  roots: ProductRoots,
): Finding[] {
  const screens = readableValue(screensInput);
  if (auth === null || screens === undefined || !screens.available) return [];
  const declared = new Set(auth.gates.map((gate) => gate.guards));
  const used = new Set<GateSubject>();
  const findings: Finding[] = [];
  for (const screen of screens.screens) {
    for (const guard of requiredGuardsOf(screen, auth.gates)) {
      used.add(guard);
      if (!declared.has(guard)) findings.push(missingGateFinding(screen, guard, auth.gates, roots));
    }
  }
  if (screensInput.state !== 'loaded') return findings;
  for (const gate of auth.gates) {
    if (!used.has(gate.guards)) findings.push(unusedGateFinding(gate));
  }
  return findings;
}

/**
 * ロールの関門(`guards: role_gate`)の宣言そのものの接地(screen_spec に依らない)。
 *
 * 画面が掛かる関門は `gates[].role` との**字面の一致**で導かれる(`requiredGuardsOf`)。だから:
 *
 * | 何 | 当たらないと何が起きるか |
 * |---|---|
 * | `role` が roles.md に実在する | 綴り違いのロールにはどの画面の `for` も一致せず、運営向けの画面が**関門に掛からないもの**として扱われる(関門の宣言漏れも、ナビの可視性も、実装が関門を呼ぶかの走査も黙る)。どの画面も掛からない関門の warning しか残らない |
 * | `role_gate` の行が高々 1 つ | 導出は最初の行しか見ないので、2 行目のロールは黙って無視される |
 *
 * @param auth 読み込み済みの認証フロー仕様(null なら他の検証器が指摘済み)
 * @param domain ドメイン仕様(ロールの実在を引く)
 * @returns 違反のリスト
 */
export function verifyGateRoles(auth: AuthFlowSpec | null, domain: SpecModel): Finding[] {
  if (auth === null) return [];
  const roles = domain.roles.roles.map((role) => role.id);
  const roleGates = auth.gates.filter((gate) => gate.guards === 'role_gate');
  const findings: Finding[] = roleGates
    .filter((gate) => gate.role !== undefined && !roles.includes(gate.role))
    .map((gate) =>
      h4({
        message: `関門 ${gate.id}(guards: role_gate)の role ${gate.role ?? ''} は roles.md に定義されていません`,
        location: gate.location,
        suggestion:
          `role を roles.md のロール(${roles.join(' / ')})に直す。綴り違いのロールにはどの画面の for も一致せず、` +
          'その画面は関門に掛からないものとして扱われる(実装が関門を呼ぶかの検査も、ナビの可視性も黙る)',
        counterexample: { gate: gate.id, role: gate.role ?? '' },
      }),
    );
  for (const extra of roleGates.slice(1)) {
    findings.push(
      h4({
        message: `関門 ${extra.id} は 2 つ目の guards: role_gate の行です(ロールの関門は 1 つだけ宣言できます)`,
        location: extra.location,
        suggestion:
          `${roleGates[0]?.id ?? ''} と ${extra.id} を 1 行にまとめる。画面が掛かる関門の導出は最初の行しか見ないので、` +
          '2 行目のロールは黙って無視される',
        counterexample: { gate: extra.id, first: roleGates[0]?.id ?? '' },
      }),
    );
  }
  return findings;
}

/** 画面が掛かるはずの関門を auth_spec が宣言していない。 */
function missingGateFinding(
  screen: ScreenSpec,
  guard: GateSubject,
  gates: readonly AuthGateDecl[],
  roots: ProductRoots,
): Finding {
  return h4({
    message: `画面 ${screen.name} は関門 ${guard} に掛かりますが、auth_spec の gates に宣言がありません`,
    location: screen.location,
    suggestion:
      `${specPath(roots, 'backend/auth.md')} の gates に guards: ${guard} の行を足す` +
      `(${screen.name} の ${guardOrigin(guard, gates)} が導く関門であり、宣言が無いと` +
      '入場を守る実装が実在するかを誰も検査していない状態になる)',
    counterexample: { screen: screen.name, guard },
  });
}

/** どの画面も掛からない関門(誰も通らない検問)。 */
function unusedGateFinding(gate: AuthGateDecl): Finding {
  return h4({
    severity: 'warning',
    message: `関門 ${gate.id}(guards: ${gate.guards})に掛かる画面が screen_spec に 1 つもありません`,
    location: gate.location,
    suggestion:
      gate.guards === 'requires_auth'
        ? 'requires_auth: true の画面を足すか、使われていない関門を消す'
        : `for: [${gate.role ?? '{role}'}] の画面を足すか、使われていない関門を消す`,
    counterexample: { gate: gate.id, guards: gate.guards },
  });
}

/** 関門を導いた画面側の宣言を人間に示す呼び名。 */
function guardOrigin(guard: GateSubject, gates: readonly AuthGateDecl[]): string {
  return guard === 'requires_auth' ? 'requires_auth: true' : `for: [${roleGateOf(gates)?.role ?? '{role}'}]`;
}
