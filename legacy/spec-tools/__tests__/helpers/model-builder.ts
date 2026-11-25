/**
 * 検証器テスト用の最小モデルビルダーと、GuardServices の最小スタブ。
 *
 * 規約 (scripts-code-quality.md) により検証器のテストはファイル I/O を行わず、
 * SpecModel をテスト内でリテラル構築する。ここではその定型部分(location の
 * 埋め草・省略可能フィールドの扱い)だけを引き受ける。
 *
 * guard の本実装は並行開発中のため import せず、V2 が必要とする
 * parse / collectPaths のみを動かす自己完結のスタブを提供する。
 */

import type {
  AccessSpec,
  AggregateSpecs,
  CreateRule,
  DeleteRule,
  EffectDef,
  EntitySpec,
  EventDef,
  FieldDef,
  FieldType,
  ForbiddenDef,
  ReadRule,
  ReadScope,
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
  CompareRhs,
  DomainEnv,
  GuardExpr,
  GuardParseResult,
  GuardServices,
  Literal,
  PathRef,
  ReachResult,
  SatResult,
} from '../../lib/guard/ast.js';

/**
 * テスト用の SourceLocation を作る。
 * @param file リポジトリルートからの相対パス
 * @param pointer YAML パス(省略可)
 */
export function loc(file = 'docs/specs/domain/test.md', pointer?: string): SourceLocation {
  return pointer === undefined ? { file } : { file, pointer };
}

/**
 * 慣例名のロール ID → `kind` の既定値。実物の roles.md(anonymous/member/system)と同じ
 * 綴りを使うテストフィクスチャが、`kind` を明示しなくても `globalRoleId` / `systemRoleId` で
 * 引けるようにするための既定(binding 無し・kind 未指定のときだけ適用)。
 */
const DEFAULT_KIND_BY_ID: Readonly<Record<string, RoleKind>> = {
  anonymous: 'anonymous',
  member: 'authenticated_default',
  system: 'system',
};

/**
 * ロール定義を作る。
 * @param id ロール ID
 * @param binding 渡すと文脈依存ロールになる(query_spec の `via` に書けるのはこちら)
 * @param implies このロールが必ず併せ持つロール(ロール階層。via の借用条件に効く)
 * @param kind グローバルロールの種別。省略時、id が anonymous/member/system のいずれかで
 *   binding が無ければ既定値を補う(下記 DEFAULT_KIND_BY_ID)
 */
export function role(
  id: string,
  binding?: string,
  implies?: readonly string[],
  kind?: RoleKind,
  label?: string,
): RoleDef {
  const base = { id, location: loc('docs/specs/domain/roles.md', `roles.${id}`) };
  const resolvedKind = kind ?? (binding === undefined ? DEFAULT_KIND_BY_ID[id] : undefined);
  return {
    ...base,
    ...(resolvedKind === undefined ? {} : { kind: resolvedKind }),
    ...(binding === undefined ? {} : { binding }),
    ...(implies === undefined ? {} : { implies }),
    ...(label === undefined ? {} : { label }),
  };
}

/** roles.md 相当。文字列を渡すと binding 無しのグローバルロールとして解釈する。 */
export function roleSpec(roles: readonly (string | RoleDef)[]): RoleSpec {
  return {
    roles: roles.map((r) => (typeof r === 'string' ? role(r) : r)),
    location: loc('docs/specs/domain/roles.md'),
  };
}

/** フィールド定義を作る。required / auto / personal / session は既定 false。 */
export function field(
  name: string,
  type: FieldType,
  opts: {
    readonly required?: boolean;
    readonly auto?: boolean;
    readonly label?: string;
    readonly description?: string;
    readonly personal?: boolean;
    readonly personalPlaceholder?: string | null;
    readonly session?: boolean;
  } = {},
): FieldDef {
  const base: FieldDef = {
    name,
    type,
    required: opts.required ?? false,
    auto: opts.auto ?? false,
    personal: opts.personal ?? false,
    session: opts.session ?? false,
    location: loc('docs/specs/domain/entity.md', `fields.${name}`),
  };
  return {
    ...base,
    ...(opts.label === undefined ? {} : { label: opts.label }),
    ...(opts.description === undefined ? {} : { description: opts.description }),
    ...(opts.personalPlaceholder === undefined ? {} : { personalPlaceholder: opts.personalPlaceholder }),
  };
}

/** entity_spec を作る。context / fields は省略時に空。 */
export function entitySpec(
  entity: string,
  opts: {
    readonly context?: Readonly<Record<string, string>>;
    readonly fields?: readonly FieldDef[];
    /** 集約の日本語名。生成器のテストだけが使う(検証器は label を見ない)。 */
    readonly label?: string;
  } = {},
): EntitySpec {
  return {
    entity,
    ...(opts.label === undefined ? {} : { label: opts.label }),
    context: opts.context ?? {},
    fields: opts.fields ?? [],
    location: loc(`docs/specs/domain/${entity}/entity.md`),
  };
}

/** イベント定義を作る。by は省略時 ["member"](V3〜V7 は by を見ない)。 */
export function event(
  id: string,
  opts: {
    readonly from: readonly string[];
    readonly to: string;
    readonly by?: readonly string[];
    readonly guard?: string;
    readonly otherwiseForbidden?: string;
    readonly file?: string;
    /** 人間向けの日本語名。生成器のテストだけが使う(検証器は label を見ない)。 */
    readonly label?: string;
    /** この遷移が実行者を書き留める自分の列(state_spec の `records_actor`)。 */
    readonly recordsActor?: readonly string[];
    /** この遷移が「いま」を書き留める自分の列(state_spec の `records_time`)。 */
    readonly recordsTime?: readonly string[];
    /** この遷移が空にする自分の列(state_spec の `clears`)。 */
    readonly clears?: readonly string[];
  },
): EventDef {
  const bare: EventDef = {
    id,
    from: opts.from,
    to: opts.to,
    by: opts.by ?? ['member'],
    ...(opts.recordsActor === undefined ? {} : { recordsActor: opts.recordsActor }),
    ...(opts.recordsTime === undefined ? {} : { recordsTime: opts.recordsTime }),
    ...(opts.clears === undefined ? {} : { clears: opts.clears }),
    location: loc(opts.file ?? 'docs/specs/domain/test/states.md', `events.${id}`),
  };
  const base = opts.label === undefined ? bare : { ...bare, label: opts.label };
  const withGuard = opts.guard === undefined ? base : { ...base, guard: opts.guard };
  return opts.otherwiseForbidden === undefined
    ? withGuard
    : { ...withGuard, otherwiseForbidden: opts.otherwiseForbidden };
}

/** 明示的な禁止(forbidden ブロック)を作る。 */
export function forbidden(eventId: string, from: readonly string[], reason: string): ForbiddenDef {
  return {
    event: eventId,
    from,
    reason,
    location: loc('docs/specs/domain/test/states.md', `forbidden.${eventId}`),
  };
}

/** 副作用定義(effects)を作る。 */
export function effect(on: string, dos: readonly string[]): EffectDef {
  return {
    on,
    do: dos,
    location: loc('docs/specs/domain/test/states.md', `effects.${on}`),
  };
}

/** 状態機械を作る。final / forbidden / effects / stateLabels は省略時に空。 */
export function machine(
  name: string,
  opts: {
    readonly states: readonly string[];
    readonly initial: string;
    readonly final?: readonly string[];
    readonly events?: readonly EventDef[];
    readonly forbidden?: readonly ForbiddenDef[];
    readonly effects?: readonly EffectDef[];
    /** 状態 ID → 日本語名。生成器のテストだけが使う(検証器は label を見ない)。 */
    readonly stateLabels?: Readonly<Record<string, string>>;
    /** 状態 ID → tone(negative を持つ状態のみ)。省略時は空(全 neutral)。 */
    readonly stateTone?: Readonly<Record<string, 'negative'>>;
    /** 状態 ID → settles(値は settlesVocabulary の id)。省略時は空(何も確定させない)。 */
    readonly stateSettles?: Readonly<Record<string, readonly string[]>>;
    /** 節の要約(人が書く文)。省略時は書かれていない。 */
    readonly summary?: string;
    /** 状態 ID → 段の場面(人が書く文)。省略時は空。 */
    readonly stateSummaries?: Readonly<Record<string, string>>;
    /** settles の語彙(id → 表示名)。省略時は空。 */
    readonly settlesVocabulary?: Readonly<Record<string, string>>;
  },
): StateMachineSpec {
  return {
    machine: name,
    states: opts.states,
    stateLabels: opts.stateLabels ?? {},
    stateTone: opts.stateTone ?? {},
    stateSettles: opts.stateSettles ?? {},
    settlesVocabulary: opts.settlesVocabulary ?? {},
    ...(opts.summary === undefined ? {} : { summary: opts.summary }),
    stateSummaries: opts.stateSummaries ?? {},
    initial: opts.initial,
    final: opts.final ?? [],
    events: opts.events ?? [],
    forbidden: opts.forbidden ?? [],
    effects: opts.effects ?? [],
    location: loc(`docs/specs/domain/${name}/states.md`),
  };
}

/**
 * 読み取り規則を作る。scope は文字列指定("own" / "context(workshop)" 等)も受ける。
 *
 * `filters` は実行者の属性で狭める境界(テナント)。`{ 列: 実行者の欄 }` で渡す。
 */
export function read(
  by: string,
  scope: ReadScope | string,
  filters?: Readonly<Record<string, string>>,
  when?: string,
): ReadRule {
  const base: ReadRule = {
    by,
    scope: typeof scope === 'string' ? parseScope(scope) : scope,
    location: loc('docs/specs/domain/test/access.md', `reads.${by}`),
    ...(when === undefined ? {} : { when }),
  };
  if (filters === undefined) return base;
  return {
    ...base,
    // 左辺が `{親の集約}.{列}` なら親の列(パーサーと同じ分け方)。
    filters: Object.entries(filters).map(([key, actorField]) => {
      const [head, column] = key.split('.');
      return column === undefined ? { field: key, actorField } : { entity: head ?? '', field: column, actorField };
    }),
  };
}

function parseScope(text: string): ReadScope {
  const context = /^context\(([a-z0-9_]+)\)$/.exec(text);
  if (context !== null && context[1] !== undefined) return { kind: 'context', entity: context[1] };
  if (text === 'own' || text === 'all' || text === 'none') return { kind: text };
  throw new Error(`未知の scope: ${text}`);
}

/** 作成規則を作る。 */
export function create(by: string, when?: string): CreateRule {
  const base: CreateRule = {
    by,
    location: loc('docs/specs/domain/test/access.md', `creates.${by}`),
  };
  return when === undefined ? base : { ...base, when };
}

/** 削除規則を作る。 */
export function del(by: string, when?: string): DeleteRule {
  const base: DeleteRule = {
    by,
    location: loc('docs/specs/domain/test/access.md', `deletes.${by}`),
  };
  return when === undefined ? base : { ...base, when };
}

/** 書き込み規則を作る。 */
export function write(
  by: string,
  fields: readonly string[],
  when?: string,
  effects?: readonly string[],
): WriteRule {
  const base: WriteRule = {
    by,
    fields,
    location: loc('docs/specs/domain/test/access.md', `writes.${by}`),
  };
  const withWhen = when === undefined ? base : { ...base, when };
  return effects === undefined ? withWhen : { ...withWhen, effects };
}

/** access_spec を作る。 */
export function accessSpec(
  entity: string,
  opts: {
    readonly reads?: readonly ReadRule[];
    readonly fieldsHidden?: readonly AccessSpec['fieldsHidden'][number][];
    readonly creates?: readonly CreateRule[];
    readonly writes?: readonly WriteRule[];
    /** 遷移だけが書く列(`transition_writes`。V19)。 */
    readonly transitionWrites?: readonly string[];
    readonly deletes?: readonly DeleteRule[];
    /** テナント境界を宣言しないことの理由つき受け入れ(V20)。 */
    readonly accepts?: AccessSpec['accepts'];
  } = {},
): AccessSpec {
  return {
    entity,
    reads: opts.reads ?? [],
    fieldsHidden: opts.fieldsHidden ?? [],
    creates: opts.creates ?? [],
    writes: opts.writes ?? [],
    transitionWrites: opts.transitionWrites ?? [],
    deletes: opts.deletes ?? [],
    accepts: opts.accepts ?? [],
    location: loc(`docs/specs/domain/${entity}/access.md`),
  };
}

/** 集約(1 ディレクトリ分の仕様の束)を作る。 */
export function aggregate(
  name: string,
  opts: {
    readonly entity?: EntitySpec;
    readonly stateMachines?: readonly StateMachineSpec[];
    readonly access?: AccessSpec;
    readonly invariants?: AggregateSpecs['invariants'];
  } = {},
): AggregateSpecs {
  const base: AggregateSpecs = { name, stateMachines: opts.stateMachines ?? [] };
  const a = opts.entity === undefined ? base : { ...base, entity: opts.entity };
  const b = opts.access === undefined ? a : { ...a, access: opts.access };
  return opts.invariants === undefined ? b : { ...b, invariants: opts.invariants };
}

/**
 * roles 省略時の既定ロール集合(anonymous/member/system。それぞれ既定の `kind` 込み)。
 * `globalRoleId` / `systemRoleId` を使う検証器のテストが、role_spec 自体には関心が無い
 * ケースでも `kind: system` 等を引けるようにする(model-builder-v8plus.ts の DEFAULT_ROLES と同じ理由)。
 */
const DEFAULT_ROLES: RoleSpec = roleSpec(['anonymous', 'member', 'system']);

/** SpecModel を作る。roles 省略時は既定のグローバルロール 3 つ。 */
export function specModel(aggregates: readonly AggregateSpecs[], roles: RoleSpec = DEFAULT_ROLES): SpecModel {
  return { roles, aggregates: new Map(aggregates.map((a) => [a.name, a])) };
}

/** 状態機械 1 つだけを持つモデルの短縮形(V3/V5/V6/V7 のテスト向け)。 */
export function modelWithMachine(m: StateMachineSpec, aggregateName = m.machine): SpecModel {
  return specModel([aggregate(aggregateName, { stateMachines: [m] })]);
}

// ---------------------------------------------------------------------------
// GuardServices スタブ
// ---------------------------------------------------------------------------

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);
/** 裸トークンでもパスとして解釈する予約語(ast.ts の CompareRhs の規約)。 */
const RESERVED_PATHS = new Set(['actor', 'now']);

/**
 * V2 のテスト用 GuardServices スタブ。
 * parse / collectPaths のみ実際に動き、satisfiability / canCoexist は
 * V2 が使わないため保守的な既定値を返す。
 */
export function stubGuards(): GuardServices {
  return {
    parse: parseGuard,
    collectPaths,
    satisfiability: (): SatResult => ({ verdict: 'unknown' }),
    canCoexist: (
      _a: GuardExpr | undefined,
      _b: GuardExpr | undefined,
      _env: DomainEnv,
    ): CoexistResult => ({ coexists: true }),
    boundedReachability: (): ReachResult => ({ verdict: 'unknown', reason: 'no-solver' }),
  };
}

function parseGuard(source: string): GuardParseResult {
  const tokens = source
    .replace(/([[\],])/g, ' $1 ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const state = { tokens, index: 0 };
  try {
    const expr = parseOr(state);
    if (state.index !== tokens.length) throw new Error(`余分なトークン: ${String(tokens[state.index])}`);
    return { ok: true, expr };
  } catch (e) {
    return { ok: false, error: { message: e instanceof Error ? e.message : String(e), offset: 0 } };
  }
}

interface ParseState {
  readonly tokens: readonly string[];
  index: number;
}

function peek(s: ParseState): string | undefined {
  return s.tokens[s.index];
}

function take(s: ParseState): string {
  const t = s.tokens[s.index];
  if (t === undefined) throw new Error('式が途中で終わっています');
  s.index += 1;
  return t;
}

function parseOr(s: ParseState): GuardExpr {
  let left = parseAnd(s);
  while (peek(s) === 'or') {
    s.index += 1;
    left = { kind: 'or', left, right: parseAnd(s) };
  }
  return left;
}

function parseAnd(s: ParseState): GuardExpr {
  let left = parseClause(s);
  while (peek(s) === 'and') {
    s.index += 1;
    left = { kind: 'and', left, right: parseClause(s) };
  }
  return left;
}

function parseClause(s: ParseState): GuardExpr {
  if (peek(s) === 'not') {
    s.index += 1;
    return { kind: 'not', operand: parseAtom(s) };
  }
  return parseAtom(s);
}

function parseAtom(s: ParseState): GuardExpr {
  const path = toPath(take(s));
  let op = take(s);
  const negated = op === 'not';
  if (negated) op = take(s);
  if (negated && op !== 'in') throw new Error('not は in の直前にのみ置けます');
  const atom = parseAtomBody(s, path, op);
  return negated ? { kind: 'not', operand: atom } : atom;
}

function parseAtomBody(s: ParseState, path: PathRef, op: string): GuardExpr {
  if (op === 'in') {
    if (take(s) !== '[') throw new Error('in の後は [ が必要です');
    const values: Literal[] = [literal(take(s))];
    while (peek(s) === ',') {
      s.index += 1;
      values.push(literal(take(s)));
    }
    if (take(s) !== ']') throw new Error('] が閉じていません');
    return { kind: 'in', path, values };
  }
  if (op === 'contains') return { kind: 'contains', path, ref: toPath(take(s)) };
  if (!OPS.has(op)) throw new Error(`未知の演算子: ${op}`);
  return {
    kind: 'compare',
    path,
    op: op as '==' | '!=' | '<' | '<=' | '>' | '>=',
    rhs: compareRhs(take(s)),
  };
}

/** 比較右辺の解釈: ドットを含む or 予約語ならパス、それ以外はリテラル。 */
function compareRhs(token: string): CompareRhs {
  return token.includes('.') || RESERVED_PATHS.has(token)
    ? { kind: 'path', path: toPath(token) }
    : literal(token);
}

function toPath(token: string): PathRef {
  if (!PATH_RE.test(token)) throw new Error(`パスとして解釈できません: ${token}`);
  return { segments: token.split('.') };
}

function literal(token: string): Literal {
  return /^-?\d+(\.\d+)?$/.test(token)
    ? { kind: 'number', value: Number(token) }
    : { kind: 'symbol', value: token };
}

function collectPaths(expr: GuardExpr): PathRef[] {
  switch (expr.kind) {
    case 'and':
    case 'or':
      return [...collectPaths(expr.left), ...collectPaths(expr.right)];
    case 'not':
      return collectPaths(expr.operand);
    case 'compare':
      return expr.rhs.kind === 'path' ? [expr.path, expr.rhs.path] : [expr.path];
    case 'in':
    case 'null':
      return [expr.path];
    case 'contains':
      return [expr.path, expr.ref];
  }
}
