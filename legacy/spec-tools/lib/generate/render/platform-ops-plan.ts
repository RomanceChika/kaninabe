/**
 * auth_spec の `platform_ops`(認証基盤の操作を画面から叩く閉じた一覧。ADR-0019)→ **生成の入力**(操作ごとの名前・入力・出力の型・呼び口の式・行の型)。
 *
 * 生成器(`code-platform-ops-app.ts` の型・入口・組み立ての根、`code-platform-ops-tests.ts` の生成テスト、`code-platform-parts.ts` の画面の部品)が同じ導出を見る
 * (表の `screen-read-plan.ts` と同じ理由)。名前の規約・入力の zod の式・配線先を呼ぶ式・行の写しはここ 1 か所。
 *
 * 純関数で throw しない。**宣言が H9 に通っていることを前提にしない**(H9 が赤でも生成器が落ちない) —— 引けない相手(ポート・行の型・shape)は計画から外す。
 * この導出は アプリの語彙を 1 語も持たない(W1)。
 */

import type { AuthSpecModel } from '../../model/auth/types.js';
import type { PlatformArg, PlatformBindingParam, PlatformFieldFormat, PlatformOpDecl, PlatformPortDecl, PlatformRowDecl, PlatformShape, PlatformValueType } from '../../model/auth/platform-ops.js';
import { VALUE_TYPE_OF_ARG } from '../../model/auth/platform-ops.js';
import { toCamelCase, toPascalCase } from '../../gen-kit/code-emit.js';

/** 返す欄 1 つ。 */
export interface PlatformFieldPlan {
  /** 宣言した欄(スネークケース。画面の `shows` の綴り)。 */
  readonly field: string;
  /** 画面の行の型のプロパティ(キャメルケース)。 */
  readonly prop: string;
  /** 配線先の行のプロパティ。 */
  readonly from: string;
  readonly type: PlatformValueType;
  readonly nullable: boolean;
  /** 見出し(宣言した `labels`。無ければ欄名)。 */
  readonly label: string;
  /** 表示の整形(宣言した `formats`。`boolean` は型から)。 */
  readonly format: 'text' | 'boolean' | PlatformFieldFormat;
}

/** 返す欄の集合(画面の行の型)。 */
export interface PlatformShapePlan {
  readonly name: string;
  /** 画面の行の型名(`SessionSummaryRow`)。 */
  readonly typeName: string;
  /** 配線先の行の型名。 */
  readonly bindingRow: string;
  readonly fields: readonly PlatformFieldPlan[];
}

/** 入力 1 つ(宣言した引数)。 */
export interface PlatformInputPlan {
  readonly arg: string;
  /** 入力の型のプロパティ(キャメルケース)。 */
  readonly prop: string;
  /** 行から受ける識別子か(`from: row`)。 */
  readonly row: boolean;
  readonly type: PlatformValueType;
  /** zod の式(`z.string().min(1).max(128)`)。 */
  readonly zod: string;
  /** UUID の形を要求する識別子か(`format: uuid`)。 */
  readonly uuid: boolean;
  /** 行から受ける識別子の出どころ(操作 ID と欄)。 */
  readonly source?: { readonly of: string; readonly field: string; readonly skipIf?: string };
}

/** 操作 1 つの生成の入力。 */
export interface PlatformOpPlan {
  readonly op: PlatformOpDecl;
  readonly id: string;
  /** キャメルケースの基底名(`sessionEndMine`)。Server Action は `{base}Action`・入力のスキーマは `{base}InputSchema`。 */
  readonly base: string;
  /** パスカルケースの基底名(`SessionEndMine`)。入力の型は `{pascal}Input`・組み立ての根は `run{pascal}`。 */
  readonly pascal: string;
  readonly inputs: readonly PlatformInputPlan[];
  readonly shape?: PlatformShapePlan;
  /** 戻り値の値の TypeScript の型(`boolean` / `readonly SessionSummaryRow[]`)。 */
  readonly outputType: string;
  readonly port: PlatformPortDecl;
  /** ポートの組み立て関数の名前(`sessionManagement`)。 */
  readonly portFactory: string;
}

/** 計画の全体。 */
export interface PlatformPlan {
  readonly ops: readonly PlatformOpPlan[];
  readonly shapes: readonly PlatformShapePlan[];
  readonly ports: readonly PlatformPortDecl[];
}

const EMPTY: PlatformPlan = { ops: [], shapes: [], ports: [] };

/** 識別子の長さの上限(メンバー ID・セッション ID は UUID。悪意の長い入力を zod の段で止める)。 */
const ID_MAX = 128;

/** TypeScript の型(行のプロパティ)。 */
export function tsTypeOf(type: PlatformValueType, nullable: boolean): string {
  return nullable ? `${type} | null` : type;
}

/** UUID の形(大文字小文字を問わない。配線先の部品が確かめる形と同じ)。 */
export const UUID_PATTERN = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

/** 入力の zod の式。 */
function zodOf(arg: PlatformArg): string {
  if (arg.kind === 'row') return arg.format === 'uuid' ? `z.string().regex(${UUID_PATTERN})` : `z.string().min(1).max(${ID_MAX})`;
  const base = arg.type === 'bool' ? 'z.boolean()' : arg.type === 'int' ? 'z.number().int()' : 'z.string()';
  return arg.default === undefined ? base : `${base}.default(${JSON.stringify(arg.default)})`;
}

/** 入力の型。 */
function inputOf(arg: PlatformArg): PlatformInputPlan {
  return {
    arg: arg.name,
    prop: toCamelCase(arg.name),
    row: arg.kind === 'row',
    type: arg.kind === 'row' ? 'string' : VALUE_TYPE_OF_ARG[arg.type],
    zod: zodOf(arg),
    uuid: arg.kind === 'row' && arg.format === 'uuid',
    ...(arg.kind === 'row' ? { source: { of: arg.of, field: arg.field, ...(arg.skipIf === undefined ? {} : { skipIf: arg.skipIf }) } } : {}),
  };
}

/** 返す欄の計画(対応表が無い shape・引けない行の型は null)。 */
function shapeOf(shape: PlatformShape, row: PlatformRowDecl | undefined): PlatformShapePlan | null {
  if (shape.mapping === undefined || shape.row === undefined || row === undefined) return null;
  const fields: PlatformFieldPlan[] = [];
  for (const entry of shape.mapping) {
    const prop = row.props.find((candidate) => candidate.name === entry.from);
    if (prop === undefined) return null;
    const format = shape.formats?.find((candidate) => candidate.field === entry.field)?.format;
    fields.push({
      field: entry.field,
      prop: toCamelCase(entry.field),
      from: entry.from,
      type: prop.type,
      nullable: prop.nullable,
      label: shape.labels?.find((candidate) => candidate.field === entry.field)?.label ?? entry.field,
      format: format ?? (prop.type === 'boolean' ? 'boolean' : 'text'),
    });
  }
  return { name: shape.name, typeName: `${toPascalCase(shape.name)}Row`, bindingRow: shape.row, fields };
}

/**
 * 計画を作る。宣言の無い製品は空(何も出さない)。
 *
 * @param auth 読み込み済みの auth_spec
 * @returns 生成の入力
 */
export function buildPlatformPlan(auth: AuthSpecModel | undefined): PlatformPlan {
  const section = auth?.flow?.platformOps;
  if (section === undefined || section.ops.length === 0) return EMPTY;
  const shapes = section.shapes.flatMap((shape) => {
    const reader = section.ops.find((op) => op.returns === shape.name);
    const port = section.ports.find((candidate) => candidate.name === reader?.binding.port);
    const plan = shapeOf(shape, port?.rows.find((row) => row.name === shape.row));
    return plan === null ? [] : [plan];
  });
  const ops = section.ops.flatMap((op): PlatformOpPlan[] => {
    const port = section.ports.find((candidate) => candidate.name === op.binding.port);
    if (port === undefined) return [];
    const shape = op.returns === undefined ? undefined : shapes.find((candidate) => candidate.name === op.returns);
    if (op.kind === 'read' && shape === undefined) return [];
    const [group = '', name = ''] = op.id.split('.');
    const base = toCamelCase(`${group}_${name}`);
    const scalar = op.binding.result?.kind === 'scalar' ? op.binding.result.type : 'boolean';
    return [
      {
        op,
        id: op.id,
        base,
        pascal: toPascalCase(`${group}_${name}`),
        inputs: op.args.map(inputOf),
        ...(shape === undefined ? {} : { shape }),
        outputType: shape === undefined ? scalar : `readonly ${shape.typeName}[]`,
        port,
        portFactory: `${port.name.charAt(0).toLowerCase()}${port.name.slice(1)}`,
      },
    ];
  });
  return { ops, shapes, ports: [...new Map(ops.map((plan) => [plan.port.name, plan.port])).values()] };
}

/** 配線先を呼ぶときの引数の式(`input.sessionId` / `{ keepSelf: input.keepSelf }`)。 */
export function callArguments(plan: PlatformOpPlan): readonly string[] {
  return plan.op.binding.params.map((param: PlatformBindingParam) =>
    param.kind === 'scalar'
      ? `input.${toCamelCase(param.map.arg)}`
      : `{ ${param.props.map((prop) => `${prop.prop}: input.${toCamelCase(prop.arg)}`).join(', ')} }`,
  );
}

/** 配線先の行 → 画面の行の写しの式(明示の射影。宣言した欄だけを写し、宣言に無い欄は写らない)。 */
export function projectionLines(shape: PlatformShapePlan, indent: string): readonly string[] {
  return shape.fields.map((field) => `${indent}${field.prop}: row.${field.from},`);
}
