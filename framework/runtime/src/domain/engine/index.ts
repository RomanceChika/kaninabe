/**
 * 汎用状態機械エンジンの公開入口。
 *
 * 呼び出し側（operation）はこのモジュールだけを見ればよい。個別機能に遷移ロジックを
 * 書く場所は作らない（ADR-0004 / ARCH-BE-0013）。
 *
 * 許可の証明（`FireAllowed`）を**作る**手段はここから出ていない。作れるのは `canFire` だけであり、
 * 外部は `transitionOf` で中身を読むことしかできない（machine.ts のブランドの説明を参照）。
 */

export { canFire, isFinal, knownEvents, transitionOf } from './machine';
export type { AllowedTransition, FireAllowed, FireDecision } from './machine';
export { canCreate } from './create';
export type { CreateAllowed, CreateDecision } from './create';
export { canDelete } from './delete';
export type { DeleteAllowed, DeleteDecision } from './delete';
export { canWrite } from './write';
export type { WriteAllowed, WriteDecision } from './write';
export { containsKey, evaluateGuard, unresolvedPaths } from './guard';
export type { GuardResult } from './guard';
export { assertValidTable } from './validate';
export type {
  CreateContext,
  CreateRejected,
  CreateRejectionReason,
  CreateRuleDef,
  CreateTable,
  DeleteContext,
  DeleteRejected,
  DeleteRejectionReason,
  DeleteRuleDef,
  DeleteTable,
  FireContext,
  FireRejected,
  FireRejectionReason,
  GuardEnv,
  GuardExprData,
  GuardValue,
  MachineTable,
  TransitionDef,
  WriteContext,
  WriteRejected,
  WriteRejectionReason,
  WriteRuleDef,
  WriteTable,
} from './types';
