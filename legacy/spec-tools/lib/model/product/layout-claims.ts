/**
 * 置き場の**主張(claim)の衝突の一括検査**(`ProductLayout` の契約の検査)。
 *
 * 「この役割のこのキーの置き場を、この持ち主が取る」という主張を集めて、配置(`layout.ts`)に当てて解決し、**同じパスを 2 つの持ち主が取る**・
 * **多重度の違反**・**宣言されていない持ち主が取る**・**役割やキーが配置に合わない**を、理由つきで返す(throw しない)。契約が「衝突したら失敗」
 * (`onCollision: 'fail'`)と宣言するのは、文字列のパスの辞書だと、2 つの持ち主が同じパスを取っても片方が黙って勝つから。
 *
 * 主張を作る側(どの仕様から何を主張するか)は呼び手が持つ(例: ジョブの `endpoint` と受信口の URL = `job/verifiers/j2-entry-collision.ts`)。
 * ここはモデルも仕様も知らない純関数で、**パスは製品の根からの相対**で比べる(根の違いは衝突の有無に効かない)。
 */

import { layoutFoldedPlace, layoutKeyFits, layoutPath, layoutRoundTrips } from './layout.js';
import type { LayoutRole, ProductLayout, RoleOwner } from './layout.js';

/** 置き場の主張 1 件。 */
export interface LayoutClaim {
  /** 取りたい役割。 */
  readonly role: LayoutRole;
  /** 取りたいキー(キーを持たない役割は省略)。 */
  readonly key?: string;
  /** 取る持ち主(`product` = 製品が手で書く・それ以外は生成器 ID)。 */
  readonly owner: string;
  /** 人が読む出どころ(違反の説明に出る。例: `ジョブ example_job の endpoint`)。 */
  readonly source: string;
}

/** 衝突の検査の違反 1 件。 */
export interface LayoutClaimProblem {
  /** 何の違反か。 */
  readonly kind: 'unknown_role' | 'invalid_key' | 'unresolvable' | 'undeclared_owner' | 'not_reachable' | 'duplicate_path' | 'multiplicity';
  /** 人が読む説明。 */
  readonly message: string;
  /** 関わる主張(出どころ)。 */
  readonly sources: readonly string[];
}

/** 持ち主の名前(`product` / 生成器 ID / `product_declaration`)が宣言された持ち主に含まれるか。 */
function ownerDeclared(owner: string, owners: readonly RoleOwner[]): boolean {
  return owners.some((declared) =>
    declared.kind === 'generator' ? declared.id === owner : declared.kind === 'product' ? owner === 'product' : owner === 'product_declaration',
  );
}

/** 主張 1 件を、配置に当てて解決した形。 */
interface Resolved {
  readonly claim: LayoutClaim;
  readonly path: string;
}

/**
 * 主張を一括で配置に当て、衝突を返す。
 *
 * 見るのは 7 つ(すべて失敗): ①役割が配置に宣言されていない ②キーが役割のキーの形に合わない ③基準の役割が宣言されておらず置き場を決められない
 * ④持ち主が役割に宣言されていない ⑤**逆引きを持つ役割(画面の器)で、置き場 → 逆引きが同じキーに戻らない**(`not_reachable`)
 * ⑥**同じパスを 2 つ以上の主張が取る**(役割をまたいでも。URL の表記ゆれ — 先頭・末尾の `/` — は同じキーとして数える。**逆引きを持つ役割は、ルーティングの規約で
 *   同じ実体になる置き場も同じ置き場として数える** — `/(g)/x` と `/x` は同じ URL・同じ走査の根を取る画面の器と HTTP の入口は、同じセグメントに両方は置けない)
 * ⑦**多重度の違反**(`max: 1` の役割を 2 つの主張が取る)。
 *
 * @param layout 後段が与える配置
 * @param claims 置き場の主張(集める順のまま。違反の並びも同じ順)
 * @returns 違反(無ければ空)
 */
export function layoutClaimProblems(layout: ProductLayout, claims: readonly LayoutClaim[]): readonly LayoutClaimProblem[] {
  const problems: LayoutClaimProblem[] = [];
  const resolved: Resolved[] = [];
  for (const claim of claims) {
    const decl = layout[claim.role];
    if (decl === undefined) {
      problems.push({ kind: 'unknown_role', message: `${claim.source} が取る役割 ${claim.role} は、この配置に宣言されていません`, sources: [claim.source] });
      continue;
    }
    const path = layoutPath(layout, '', claim.role, claim.key);
    if (path === null && layoutKeyFits(layout, claim.role, claim.key)) {
      problems.push({ kind: 'unresolvable', message: `${claim.source} の置き場を決められません(役割 ${claim.role} の基準の役割が、この配置に宣言されていません)`, sources: [claim.source] });
      continue;
    }
    if (path === null) {
      problems.push({ kind: 'invalid_key', message: `${claim.source} のキー(${claim.key ?? '(なし)'})が、役割 ${claim.role} のキーの形(${decl.multiplicity.key})に合いません`, sources: [claim.source] });
      continue;
    }
    if (!layoutRoundTrips(layout, claim.role, claim.key ?? '')) {
      problems.push({
        kind: 'not_reachable',
        message: `${claim.source} の置き場 ${path} は、役割 ${claim.role} の逆引きでは同じキーに戻りません(実装の木を走査しても、この宣言の実体として読めない — 例: ルーティングに使わない名前の下・ルーティングで消える名前・1 本の URL に結べない動的なセグメント)`,
        sources: [claim.source],
      });
    }
    if (!ownerDeclared(claim.owner, decl.owners)) {
      problems.push({ kind: 'undeclared_owner', message: `${claim.source} の持ち主 ${claim.owner} は、役割 ${claim.role} の持ち主として宣言されていません`, sources: [claim.source] });
    }
    resolved.push({ claim, path });
  }
  problems.push(...duplicatePaths(layout, resolved), ...multiplicityProblems(layout, resolved));
  return problems;
}

/**
 * 同じパスを 2 つ以上の主張が取っている(1 つだけの役割の取り合いは、多重度の違反として別に言う)。
 * **大文字小文字だけ違うパスも同じ置き場として数える**(大文字小文字を区別しないファイルシステムでは同じディレクトリになり、片方がもう片方を上書きする)。
 * **逆引きを持つ役割は、置き場 → 逆引きで戻ったキーが同じ(畳んだ名前 `layoutFoldedPlace` が同じ)主張も同じ置き場として数える**(役割をまたぐ — 画面の器と
 * HTTP の入口が同じ URL を取る — ものも含む)。
 */
function duplicatePaths(layout: ProductLayout, resolved: readonly Resolved[]): LayoutClaimProblem[] {
  const groups = new Map<string, Resolved[]>();
  const add = (name: string, entry: Resolved): void => void groups.set(name, [...(groups.get(name) ?? []), entry]);
  for (const entry of resolved) {
    add(`path:${entry.path.toLowerCase()}`, entry);
    const folded = layoutFoldedPlace(layout, entry.claim.role, entry.claim.key ?? '');
    if (folded !== null) add(`folded:${folded.toLowerCase()}`, entry);
  }
  const reported: Set<number>[] = [];
  return [...groups.values()]
    .filter((entries) => entries.length > 1)
    .filter((entries) => !entries.every((entry) => entry.claim.role === entries[0]?.claim.role && layout[entry.claim.role]?.multiplicity.max === 1))
    .sort((a, b) => b.length - a.length)
    .filter((entries) => {
      // パスの一致と畳んだ名前の一致が同じ主張の組を指すときは 1 件で言う(大きい組を先に報告し、その部分集合は重ねない)。
      const members = new Set(entries.map((entry) => resolved.indexOf(entry)));
      if (reported.some((done) => [...members].every((member) => done.has(member)))) return false;
      reported.push(members);
      return true;
    })
    .map((entries) => {
      const spellings = [...new Set(entries.map((entry) => entry.path))];
      const caseOnly = new Set(spellings.map((spelling) => spelling.toLowerCase())).size === 1;
      const note =
        spellings.length === 1
          ? ''
          : caseOnly
            ? '(大文字小文字だけ違う綴りも、大文字小文字を区別しないファイルシステムでは同じ置き場)'
            : '(綴りは違うが、ルーティングの規約で同じ実体になる置き場)';
      return {
        kind: 'duplicate_path' as const,
        message: `同じ置き場 ${spellings.join(' / ')}${note} を ${entries.length} つの主張が取っています: ${entries.map((entry) => entry.claim.source).join(' / ')}`,
        sources: entries.map((entry) => entry.claim.source),
      };
    });
}

/** `max: 1` の役割を 2 つ以上の主張が取っている。 */
function multiplicityProblems(layout: ProductLayout, resolved: readonly Resolved[]): LayoutClaimProblem[] {
  const problems: LayoutClaimProblem[] = [];
  const roles = new Set(resolved.map((entry) => entry.claim.role));
  for (const role of roles) {
    if (layout[role]?.multiplicity.max !== 1) continue;
    const entries = resolved.filter((entry) => entry.claim.role === role);
    if (entries.length <= 1) continue;
    problems.push({
      kind: 'multiplicity',
      message: `役割 ${role} は 1 つだけなのに、${entries.length} つの主張が取っています: ${entries.map((entry) => entry.claim.source).join(' / ')}`,
      sources: entries.map((entry) => entry.claim.source),
    });
  }
  return problems;
}
