/**
 * V11(ロール接地)の Finding ビルダー。
 *
 * `v11-role-grounding.ts` が使う。どれも「何が・どこで・どう直すか」の 3 点セットを組むだけである。
 */

import type { RoleDef, SourceLocation } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';

/** ロールが使われている 1 箇所。 */
export interface RoleUsage {
  readonly roleId: string;
  /** 使用箇所の説明(例: "entry.submit の by")。メッセージに埋め込む。 */
  readonly where: string;
  readonly location: SourceLocation;
  /** true なら文脈依存ロールの解決可能性まで検査する(権限を与えている箇所)。 */
  readonly grantsAccess: boolean;
}

/** 未定義ロール使用の Finding。 */
export function undefinedRoleFinding(usage: RoleUsage, knownRoles: readonly string[]): Finding {
  return {
    verifier: 'V11',
    severity: 'error',
    message: `${usage.where} のロール ${usage.roleId} は roles.md に定義されていません`,
    location: usage.location,
    suggestion: `roles.md に id: ${usage.roleId} を追加するか、定義済みロール(${knownRoles.join(', ')})のいずれかへ直してください`,
    counterexample: { role: usage.roleId, used_at: usage.where, defined_roles: knownRoles.join(', ') },
  };
}

/**
 * 経路が 2 通り以上ある Finding(束 ⑲-2a)。
 *
 * **中継が違えば指す行も違う。** 宣言順で先に見つかった方を黙って採ると、著者は何の警告も無く
 * 「意図と別の行を指すロール」を得る(レビューが、ロールの参照が 2 通りある題材で実測)。どちらを通るかは
 * 書き手が決める宣言であり、仕組みが良い方を選ぶ賢さは持たない。
 */
export function ambiguousContextFinding(
  usage: RoleUsage,
  aggregate: string,
  role: RoleDef,
  entity: string,
  routes: readonly (readonly string[])[],
): Finding {
  const shown = routes.map((route) => [aggregate, ...route].join(' → ')).join(' / ');
  return {
    verifier: 'V11',
    severity: 'error',
    message:
      `${usage.where} で文脈依存ロール ${usage.roleId} を使っていますが、` +
      `${aggregate} から ${entity} へ context を辿る経路が ${routes.length} 通りあります(${shown})`,
    location: usage.location,
    suggestion:
      `どちらの行を指すのかを宣言してください —— ${aggregate} の entity.md の context に ` +
      `「${entity}: ${aggregate}.${entity}_id」のような参照パスを直接足すか、` +
      '中継のどちらかから ' +
      `${entity} への context を外す(中継が違えば指す行も違うので、仕組みは選びません)`,
    counterexample: {
      role: usage.roleId,
      binding: role.binding ?? '',
      used_at: usage.where,
      ambiguous_context: entity,
      routes: shown,
    },
  };
}

/** context 解決パス不足の Finding。 */
export function missingContextFinding(usage: RoleUsage, aggregate: string, role: RoleDef, entity: string): Finding {
  return {
    verifier: 'V11',
    severity: 'error',
    message:
      `${usage.where} で文脈依存ロール ${usage.roleId} を使っていますが、` +
      `${aggregate} から ${entity} へ context を 2 段までで辿れません`,
    location: usage.location,
    suggestion:
      `${aggregate} の entity.md の context に「${entity}: ${aggregate}.${entity}_id」のような参照パスを追加するか、` +
      `中継するエンティティの context に ${entity} への参照パスを宣言してください(段は 2 つまで辿れます)`,
    counterexample: {
      role: usage.roleId,
      binding: role.binding ?? '',
      used_at: usage.where,
      missing_context: entity,
    },
  };
}
