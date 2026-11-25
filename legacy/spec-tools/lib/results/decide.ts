/**
 * 結果表が判断に渡す**材料**と、返ってきた拒否の受け取り方(束 ⑳-5b / ⑳-5b-b)。
 *
 * 判定は 1 行も書かない。ここがするのは 3 つだけである。
 *
 *   1. 仕様から engine の規則表を組む(`engineTablesOf`)
 *   2. 仕様からロール解決の表を組む(`roleTablesOf`)
 *   3. 返ってきた拒否を、表の凡例が読める形に写す(`asResultDecision`)
 *
 * ロールの数え方・ガード変数の割り当て・形ごとの照会・手順の回し方は**すべて app の関数**
 * である(`engine-bridge.ts` が借りてくる)—— 束 ⑳-5b にあった docs 側の写し(約 60 行)は
 * 消した。写しが残っていると、実行器が変わっても表だけが古い判定を engine の名前で主張する
 * (独立レビュー ⑳-5b 観点 2)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import { createInputFields } from '../usecase/actor-bound.js';
import type { GuardServices } from '../guard/ast.js';
import { allMachines } from '../model/types.js';
import {
  anonymousRoleId,
  globalRoleId,
  loginCondition,
  roleGateTable,
  roleImplicationTable,
  systemRoleId,
} from '../model/role-hierarchy.js';
import {
  createTableData,
  deleteTableData,
  machineTableData,
  writeTableData,
} from './engine-tables.js';
import type {
  CreateTable,
  DeleteTable,
  MachineTable,
  WriteTable,
} from '@kaninabe/runtime/engine';
import type { ShapeDecision } from '@kaninabe/runtime/step-decision';
import type { RoleTables } from '@kaninabe/runtime/template/actor-roles';

/** 1 マスの判定(許可か、拒否の理由と診断)。 */
export interface ResultDecision {
  readonly allowed: boolean;
  /** engine の拒否の分類(許可なら空文字)。 */
  readonly reason: string;
  /** その操作を許すロール(`role_forbidden` のときだけ埋まる)。 */
  readonly allowedRoles: readonly string[];
  /** 成立しなかったガード式の原文(ガードの拒否のときだけ埋まる)。 */
  readonly guardSource: string | null;
  /** 遷移元でない状態での禁止理由(仕様の `otherwise_forbidden`)。 */
  readonly otherwiseForbidden: string | null;
  /** 評価できなかったガード式のパス(`guard_unknown` のときだけ埋まる)。 */
  readonly unresolvedPaths: readonly string[];
}

/** 許可(理由を持たない)。 */
export const ALLOWED: ResultDecision = {
  allowed: true,
  reason: '',
  allowedRoles: [],
  guardSource: null,
  otherwiseForbidden: null,
  unresolvedPaths: [],
};

/** 判定に届かなかった手順の置き値(許可でも拒否でもない)。 */
export const NOT_REACHED: ResultDecision = { ...ALLOWED, allowed: false };

/** engine が読む規則表の全数(仕様から組んだもの。生成物の中身と同じデータ)。 */
export interface EngineTables {
  /** 状態機械名 → 遷移表。 */
  readonly machines: ReadonlyMap<string, MachineTable>;
  /** 集約 → 作成規則表。 */
  readonly creates: ReadonlyMap<string, CreateTable>;
  /** 集約 → 削除規則表。 */
  readonly deletes: ReadonlyMap<string, DeleteTable>;
  /** 集約 → 編集規則表。 */
  readonly writes: ReadonlyMap<string, WriteTable>;
}

/**
 * 仕様から engine の規則表を組む。
 *
 * 生成物(`{machine}.transitions.ts` 等)を読まないのは、**生成物より先に**この表が要る
 * からである(結果表は同じ `npm run generate` の中で書かれる)。中身は生成物と同じ 1 つの
 * 組み立て(`engine-tables.ts`)から出る。
 *
 * @param model ドメイン仕様
 * @param guards ガード式の解析
 * @param actions action_spec(作成の規則の縛り = 入力に出した欄の区別に使う。無ければ全部を入力に無い欄として扱う)
 * @returns 形ごとの規則表
 */
export function engineTablesOf(model: SpecModel, guards: GuardServices, actions: ActionSpecModel | null = null): EngineTables {
  const machines = new Map<string, MachineTable>();
  for (const { machine } of allMachines(model)) {
    machines.set(machine.machine, machineTableData(machine, guards));
  }
  const creates = new Map<string, CreateTable>();
  const deletes = new Map<string, DeleteTable>();
  const writes = new Map<string, WriteTable>();
  for (const specs of model.aggregates.values()) {
    const access = specs.access;
    if (access === undefined) continue;
    if (access.creates.length > 0) {
      creates.set(access.entity, createTableData(access, guards, { domain: model, inputFields: createInputFields(actions, access.entity) }));
    }
    if (access.deletes.length > 0) {
      deletes.set(access.entity, deleteTableData(access, guards));
    }
    if (access.writes.length > 0) {
      writes.set(access.entity, writeTableData(access, guards));
    }
  }
  return { machines, creates, deletes, writes };
}

/**
 * 仕様からロール解決の表を組む(生成物 `roles.ts` の `GLOBAL_ROLES` / `ROLE_IMPLICATIONS` と
 * 同じ導出)。
 *
 * 実行器はこの表を生成物から読むが、結果表は 4 題材の仕様に対しても同じ判断を引くので、
 * **仕様から組んで引数で渡す**(app の `actor-roles.ts` が表を引数に取るのはそのためである)。
 *
 * @param domain ドメイン仕様
 * @returns ロール解決が読む表
 */
export function roleTablesOf(domain: SpecModel): RoleTables {
  const roles = domain.roles.roles;
  const login = loginCondition(roles);
  const gates = roleGateTable(roles);
  return {
    anonymous: anonymousRoleId(roles) ?? '',
    authenticated: globalRoleId(roles, 'authenticated_default') ?? '',
    system: systemRoleId(roles) ?? '',
    implications: roleImplicationTable(roles),
    // 行の条件(ADR-0018)は宣言があるときだけ持つ —— 生成物 `roles.ts` と同じ導出。
    ...(login === null ? {} : { authenticatedWhen: login }),
    ...(Object.keys(gates).length === 0 ? {} : { gates }),
  };
}

/**
 * app が返した判断を、表の凡例が読める形に写す。
 *
 * 拒否の中身は**engine の診断そのもの**である —— 許されるロール・成立しなかったガード式の
 * 原文・仕様の `otherwise_forbidden` は、どれも engine が返したものをそのまま運ぶ(凡例の
 * 文言をここで組み立てない)。
 *
 * @param decision app の判断(許可・拒否)
 * @returns 1 マスの判定
 */
export function asResultDecision(decision: ShapeDecision): ResultDecision {
  if (decision.allowed) return ALLOWED;
  const rejected: {
    readonly reason?: string;
    readonly allowedRoles?: readonly string[];
    readonly guardSource?: string | undefined;
    readonly otherwiseForbidden?: string | undefined;
    readonly unresolvedPaths?: readonly string[];
  } = decision.rejection.rejected;
  return {
    allowed: false,
    reason: rejected.reason ?? '',
    allowedRoles: rejected.allowedRoles ?? [],
    guardSource: rejected.guardSource ?? null,
    otherwiseForbidden: rejected.otherwiseForbidden ?? null,
    unresolvedPaths: rejected.unresolvedPaths ?? [],
  };
}
