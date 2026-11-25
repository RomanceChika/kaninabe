/**
 * V8〜V11 の検証器テスト専用のモデルビルダーと GuardServices スタブ。
 *
 * 検証器テストは SpecModel をテスト内でリテラル構築する規約なので、ここでは
 * 「省略値の穴埋め」だけを行う薄いビルダーを提供する(ロジックは持たない)。
 * GuardServices は並行開発中の具象を import せず、戻り値を固定できるスタブを注入する。
 */

import type {
  AccessSpec,
  AggregateSpecs,
  CreateRule,
  DeleteRule,
  EntitySpec,
  EventDef,
  FieldDef,
  FieldHiddenRule,
  FieldType,
  InvariantDef,
  InvariantFormal,
  InvariantSpec,
  ReadFilterAccept,
  ReadRule,
  RoleDef,
  RoleKind,
  RoleSpec,
  SourceLocation,
  SpecModel,
  StateMachineSpec,
  WriteRule,
} from '../../lib/model/types.js';
import type {
  CoexistResult,
  DomainEnv,
  GuardExpr,
  GuardParseResult,
  GuardServices,
  PathRef,
  ReachProblem,
  ReachResult,
  SatResult,
  Satisfiability,
} from '../../lib/guard/ast.js';
import type { VerifyContext } from '../../lib/check-api/contract.js';
import { TEST_ROOTS } from './product-roots.js';
import { NO_DOMAIN_INPUTS } from './verify-inputs.js';

/** テスト用の SourceLocation。pointer は与えたときだけ持たせる。 */
export function loc(file = 'docs/specs/domain/test.md', pointer?: string): SourceLocation {
  return pointer === undefined ? { file } : { file, pointer };
}

/**
 * 慣例名のロール ID → `kind` の既定値(model-builder.ts と同じ既定。binding 無しのときだけ適用)。
 * 実物の roles.md と同じ綴りを使うフィクスチャが、`kind` を明示しなくても
 * `globalRoleId` / `systemRoleId` で引けるようにする。
 */
const DEFAULT_KIND_BY_ID: Readonly<Record<string, RoleKind>> = {
  anonymous: 'anonymous',
  member: 'authenticated_default',
  system: 'system',
};

/** ロール定義。binding を渡すと文脈依存ロールになる。implies はロール階層(RBAC)の宣言。 */
export function role(id: string, binding?: string, implies?: readonly string[], kind?: RoleKind): RoleDef {
  const resolvedKind = kind ?? (binding === undefined ? DEFAULT_KIND_BY_ID[id] : undefined);
  return {
    id,
    ...(resolvedKind === undefined ? {} : { kind: resolvedKind }),
    ...(binding === undefined ? {} : { binding }),
    ...(implies === undefined ? {} : { implies }),
    location: loc(),
  };
}

/** roles.md 相当。 */
export function roleSpec(roles: readonly RoleDef[]): RoleSpec {
  return { roles, location: loc('docs/specs/domain/roles.md') };
}

/** エンティティのフィールド。required / auto / personal / session は既定 false。 */
export function field(name: string, type: FieldType, extra: Partial<FieldDef> = {}): FieldDef {
  return {
    name,
    type,
    required: false,
    auto: false,
    personal: false,
    session: false,
    location: loc(),
    ...extra,
  };
}

/** entity.md 相当。context は省略時に空。 */
export function entitySpec(
  entity: string,
  fields: readonly FieldDef[],
  context: Readonly<Record<string, string>> = {},
): EntitySpec {
  return { entity, context, fields, location: loc(`docs/specs/domain/${entity}/entity.md`) };
}

/** 遷移イベント。guard は与えたときだけ持たせる(exactOptionalPropertyTypes 対応)。 */
export function event(init: {
  id: string;
  from: readonly string[];
  to: string;
  by?: readonly string[];
  guard?: string;
  /** この遷移が実行者を書き留める自分の列(state_spec の `records_actor`)。 */
  recordsActor?: readonly string[];
  /** この遷移が「いま」を書き留める自分の列(state_spec の `records_time`)。 */
  recordsTime?: readonly string[];
  /** この遷移が空にする自分の列(state_spec の `clears`)。 */
  clears?: readonly string[];
  pointer?: string;
}): EventDef {
  const base = {
    id: init.id,
    from: init.from,
    to: init.to,
    by: init.by ?? ['member'],
    ...(init.recordsActor === undefined ? {} : { recordsActor: init.recordsActor }),
    ...(init.recordsTime === undefined ? {} : { recordsTime: init.recordsTime }),
    ...(init.clears === undefined ? {} : { clears: init.clears }),
    location: loc('docs/specs/domain/test/states.md', init.pointer ?? `events.${init.id}`),
  };
  return init.guard === undefined ? base : { ...base, guard: init.guard };
}

/** states.md 相当。initial / final / events は省略可。 */
export function machine(init: {
  machine: string;
  states: readonly string[];
  initial?: string;
  final?: readonly string[];
  events?: readonly EventDef[];
}): StateMachineSpec {
  return {
    machine: init.machine,
    states: init.states,
    stateLabels: {},
    stateTone: {},
    stateSettles: {},
    settlesVocabulary: {},
    stateSummaries: {},
    initial: init.initial ?? init.states[0] ?? '',
    final: init.final ?? [],
    events: init.events ?? [],
    forbidden: [],
    effects: [],
    location: loc(`docs/specs/domain/${init.machine}/states.md`),
  };
}

/** access.md の reads 行。when(行の状態の条件)は与えたときだけ持たせる。 */
export function readRule(by: string, scope: ReadRule['scope'], when?: string): ReadRule {
  const base = { by, scope, location: loc('docs/specs/domain/test/access.md', `reads.${by}`) };
  return when === undefined ? base : { ...base, when };
}

/** access.md の writes 行。when は与えたときだけ持たせる。 */
export function writeRule(by: string, fields: readonly string[], when?: string): WriteRule {
  const base = { by, fields, location: loc('docs/specs/domain/test/access.md', `writes.${by}`) };
  return when === undefined ? base : { ...base, when };
}

/** access.md の creates 行。when は与えたときだけ持たせる。 */
export function createRule(by: string, when?: string): CreateRule {
  const base = { by, location: loc('docs/specs/domain/test/access.md', `creates.${by}`) };
  return when === undefined ? base : { ...base, when };
}

/** access.md の deletes 行。when は与えたときだけ持たせる。 */
export function deleteRule(by: string, when?: string): DeleteRule {
  const base = { by, location: loc('docs/specs/domain/test/access.md', `deletes.${by}`) };
  return when === undefined ? base : { ...base, when };
}

/** access.md の fields_hidden 行。 */
export function fieldHiddenRule(field: string, from: readonly string[]): FieldHiddenRule {
  return { field, from, location: loc('docs/specs/domain/test/access.md', `fields_hidden.${field}`) };
}

/** access.md 相当。 */
export function accessSpec(
  entity: string,
  init: {
    /** 文書 ID(例: "entry-access")。spec_ids の接地先になる。 */
    id?: string;
    reads?: readonly ReadRule[];
    fieldsHidden?: readonly FieldHiddenRule[];
    creates?: readonly CreateRule[];
    writes?: readonly WriteRule[];
    /** 遷移だけが書く列(`transition_writes`。V19)。 */
    transitionWrites?: readonly string[];
    deletes?: readonly DeleteRule[];
    /** テナント境界を宣言しないことの理由つき受け入れ(V20)。 */
    accepts?: readonly ReadFilterAccept[];
  } = {},
): AccessSpec {
  return {
    ...(init.id === undefined ? {} : { id: init.id }),
    entity,
    reads: init.reads ?? [],
    fieldsHidden: init.fieldsHidden ?? [],
    creates: init.creates ?? [],
    writes: init.writes ?? [],
    transitionWrites: init.transitionWrites ?? [],
    deletes: init.deletes ?? [],
    accepts: init.accepts ?? [],
    location: loc(`docs/specs/domain/${entity}/access.md`),
  };
}

/** 不変条件 1 件。formal を省略すると「DSL 外(集計制約など)」の不変条件になる。 */
export function invariant(init: {
  id: string;
  formal?: InvariantFormal;
  /** 形式定義を書かない理由(`formal_outside`。点検 22 回目 C22-3 のテスト用)。 */
  formalOutside?: string;
  enforcedBy?: InvariantDef['enforcedBy'];
  statement?: string;
  entities?: readonly string[];
  /** 別集約を数える不変条件が参照する集約の一覧(A7 の involves 拡張のテスト用)。 */
  involves?: readonly string[];
}): InvariantDef {
  return {
    id: init.id,
    statement: init.statement ?? `${init.id} の宣言文`,
    entities: init.entities ?? ['test'],
    ...(init.involves === undefined ? {} : { involves: init.involves }),
    ...(init.formal === undefined ? {} : { formal: init.formal }),
    ...(init.formalOutside === undefined ? {} : { formalOutside: init.formalOutside }),
    enforcedBy: init.enforcedBy ?? [],
    location: loc('docs/specs/domain/test/invariants.md', `invariants.${init.id}`),
  };
}

/** invariants.md 相当。 */
export function invariantSpec(invariants: readonly InvariantDef[]): InvariantSpec {
  return { invariants, location: loc('docs/specs/domain/test/invariants.md') };
}

/** 1 集約。省略した仕様は持たせない。 */
export function aggregate(init: {
  name: string;
  entity?: EntitySpec;
  stateMachines?: readonly StateMachineSpec[];
  access?: AccessSpec;
  invariants?: InvariantSpec;
}): AggregateSpecs {
  return {
    name: init.name,
    stateMachines: init.stateMachines ?? [],
    ...(init.entity === undefined ? {} : { entity: init.entity }),
    ...(init.access === undefined ? {} : { access: init.access }),
    ...(init.invariants === undefined ? {} : { invariants: init.invariants }),
  };
}

/**
 * `roles` を省略したテストのための既定のグローバルロール 3 つ(anonymous/member/system。
 * それぞれ `kind` 込み)。多くの検証器テストは role_spec そのものではなく `by: [...]` の
 * 解決だけに関心があり、`kind: system` を引けないと `isHumanRole` が `system` を人間ロールと
 * 誤判定してしまう(かつての `SYSTEM_ROLE_ID` 固定と違い、モデルの宣言に依存する設計になった
 * ため)。
 */
const DEFAULT_ROLES: readonly RoleDef[] = [role('anonymous'), role('member'), role('system')];

/** SpecModel。aggregates は名前をキーに組み立てる。 */
export function specModel(init: {
  roles?: readonly RoleDef[];
  aggregates?: readonly AggregateSpecs[];
}): SpecModel {
  return {
    roles: roleSpec(init.roles ?? DEFAULT_ROLES),
    aggregates: new Map((init.aggregates ?? []).map((specs) => [specs.name, specs])),
  };
}

// ---------------------------------------------------------------------------
// GuardServices スタブ
// ---------------------------------------------------------------------------

/** ガードが省略された(= 常に真)ことを表す canCoexist のキー。 */
export const NO_GUARD_KEY = '(none)';

/** スタブの振る舞い設定。すべて「生文字列 → 期待値」の対応で書く。 */
export interface GuardStubConfig {
  /** パース失敗させる式。値はエラーメッセージ。 */
  readonly unparsable?: Readonly<Record<string, string>>;
  /** satisfiability の戻り値。verdict だけ書いても SatResult 全体を書いてもよい。未指定は 'satisfiable'。 */
  readonly satisfiability?: Readonly<Record<string, Satisfiability | SatResult>>;
  /**
   * canCoexist の戻り値。キーは "式A|式B"(順不同)。ガード省略側は NO_GUARD_KEY。
   * boolean だけ書いても CoexistResult 全体(witness 付き)を書いてもよい。
   */
  readonly coexist?: Readonly<Record<string, boolean | CoexistResult>>;
  /** coexist に載っていない組の既定値(省略時 false)。 */
  readonly defaultCoexist?: boolean;
  /** collectPaths の戻り値。未指定なら生文字列からドット付き識別子を拾う。 */
  readonly paths?: Readonly<Record<string, readonly string[]>>;
  /** boundedReachability の戻り値。キーは問いの鍵(`{集約}.{機械}.{state|event}.{id}`)。 */
  readonly reachability?: Readonly<Record<string, ReachResult>>;
  /**
   * reachability に載っていない問いの既定値。
   *
   * 省略時は **`no-solver`**(= 答えの表を配線していない)である。「到達できる」を既定に
   * すると、判定器を通していないスタブが**通したふり**をすることになり、V21 の
   * 「黙って縮まない」性質がテストの側から崩れる(もう一方のスタブ `stubGuards` と同じ既定)。
   */
  readonly defaultReach?: ReachResult;
}

/** 生文字列からパス候補(`a.b` 形式)を拾う既定実装。 */
const PATH_TOKEN = /[a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)+/g;

/** スタブの AST。生文字列を比較の右辺に埋め込み、後続の呼び出しで復元できるようにする。 */
export function makeStubExpr(source: string): GuardExpr {
  return {
    kind: 'compare',
    path: { segments: ['__stub__'] },
    op: '==',
    rhs: { kind: 'symbol', value: source },
  };
}

/** スタブ AST から元の生文字列を取り出す。 */
function stubSource(expr: GuardExpr | undefined): string {
  if (expr === undefined) return NO_GUARD_KEY;
  if (expr.kind === 'compare' && expr.rhs.kind === 'symbol') return expr.rhs.value;
  return NO_GUARD_KEY;
}

/**
 * GuardServices のテスト用スタブ。判定ロジックを持たず、設定した値を返すだけ。
 * 呼び出し履歴を公開するので「どの env で判定したか」もアサートできる。
 */
export class GuardStub implements GuardServices {
  /** satisfiability の呼び出し履歴(生文字列と env)。 */
  readonly satisfiabilityCalls: Array<{ source: string; env: DomainEnv }> = [];

  /** canCoexist の呼び出し履歴(両辺の生文字列と env)。 */
  readonly coexistCalls: Array<{ a: string; b: string; env: DomainEnv }> = [];

  /** boundedReachability の呼び出し履歴(問いそのもの)。 */
  readonly reachabilityCalls: ReachProblem[] = [];

  constructor(private readonly config: GuardStubConfig = {}) {}

  /** 設定された式だけ失敗させ、それ以外は生文字列を埋め込んだ AST を返す。 */
  parse(source: string): GuardParseResult {
    const message = this.config.unparsable?.[source];
    if (message !== undefined) return { ok: false, error: { message, offset: 0 } };
    return { ok: true, expr: makeStubExpr(source) };
  }

  /** 設定があればそれを、無ければ生文字列から機械的に拾ったパスを返す。 */
  collectPaths(expr: GuardExpr): PathRef[] {
    const source = stubSource(expr);
    const configured = this.config.paths?.[source];
    const raw = configured ?? source.match(PATH_TOKEN) ?? [];
    return raw.map((path) => ({ segments: path.split('.') }));
  }

  /** 設定された充足性を返す(既定 'satisfiable')。verdict のみの設定は witness 無しの SatResult にする。 */
  satisfiability(expr: GuardExpr, env: DomainEnv): SatResult {
    const source = stubSource(expr);
    this.satisfiabilityCalls.push({ source, env });
    const configured = this.config.satisfiability?.[source] ?? 'satisfiable';
    return typeof configured === 'string' ? { verdict: configured } : configured;
  }

  /** 設定された同時成立可否を返す(キーは順不同、既定は defaultCoexist)。 */
  canCoexist(a: GuardExpr | undefined, b: GuardExpr | undefined, env: DomainEnv): CoexistResult {
    const left = stubSource(a);
    const right = stubSource(b);
    this.coexistCalls.push({ a: left, b: right, env });
    const table = this.config.coexist ?? {};
    const configured = table[`${left}|${right}`] ?? table[`${right}|${left}`] ?? this.config.defaultCoexist ?? false;
    return typeof configured === 'boolean' ? { coexists: configured } : configured;
  }

  /** 設定された有界到達性を返す(既定は `no-solver` = 判定器を通していない)。 */
  boundedReachability(problem: ReachProblem): ReachResult {
    this.reachabilityCalls.push(problem);
    return (
      this.config.reachability?.[problem.key] ??
      this.config.defaultReach ?? { verdict: 'unknown', reason: 'no-solver' }
    );
  }
}

/** スタブを載せた VerifyContext を作る。 */
export function stubContext(config: GuardStubConfig = {}): { ctx: VerifyContext; guards: GuardStub } {
  const guards = new GuardStub(config);
  return { ctx: { guards, roots: TEST_ROOTS, ...NO_DOMAIN_INPUTS }, guards };
}
