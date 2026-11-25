/**
 * specs/domain のドメイン仕様を表す型付きモデル。**利用側はこのファイルだけを import する。**
 *
 * loader が YAML フロントマターをパースしてこのモデルを構築し、
 * 検証器(Verifier)はこのモデルだけを入力として動く(ファイル I/O をしない)。
 * スキーマの正: docs/rules/process/common/specification/standards/domain-spec-writing.md
 *
 * 実体は doc_type ごとに置いてある(1 つの doc_type の型は 1 つのファイルで読み通せる)。
 * ここはその窓口(ファサード)であり、型を足すときは対応する types-*.ts に書いて、ここに 1 行足す。
 *
 *   types-common.ts    … 5 つの doc_type が共有する語彙(SourceLocation)
 *   types-role.ts      … role_spec       (roles.md)
 *   types-entity.ts    … entity_spec     ({aggregate}/entity.md)
 *   types-state.ts     … state_spec      ({aggregate}/states.md)
 *   types-access.ts    … access_spec     ({aggregate}/access.md)
 *   types-invariant.ts … invariant_spec  ({aggregate}/invariants.md)
 *   types-model.ts     … 集約とモデル全体、モデル横断のヘルパー
 */

export type { SelfAssignDecl, SourceLocation } from './types-common.js';
export type { RoleDef, RoleKind, RoleSpec } from './types-role.js';
export { ROLE_KINDS } from './types-role.js';
export { ACCEPT_KINDS, WRITE_ACCEPT_KINDS, acceptsRead } from './types-access.js';
export type { BearerDecl, EntitySpec, FieldDef, FieldType, SuppliedBy } from './types-entity.js';
export { canBeEmpty, isInputAbsent, isSystemSupplied, SUPPLIED_BY_VALUES } from './types-entity.js';
export type {
  EffectDef,
  EventDef,
  ForbiddenDef,
  SettlesTermDecl,
  SnapshotDef,
  SnapshotFieldMap,
  StateMachineSpec,
  StateTone,
} from './types-state.js';
export { STATE_TONES } from './types-state.js';
export type {
  AbuseDecl,
  AbusePerKey,
  AbuseWindow,
  AccessSpec,
  CreateRule,
  DelegateDecl,
  DeleteRule,
  FieldHiddenRule,
  ReadFilter,
  ReadFilterAccept,
  WriteAcceptKind,
  AcceptKind,
  ReadRule,
  ReadScope,
  WriteRule,
} from './types-access.js';
export type {
  EnforcementDef,
  InvariantDef,
  InvariantFormal,
  InvariantSpec,
} from './types-invariant.js';
export type { AggregateSpecs, MachineRef, SpecModel } from './types-model.js';
export { allMachines } from './types-model.js';
