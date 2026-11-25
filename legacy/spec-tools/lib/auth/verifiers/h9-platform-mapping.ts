/**
 * H9(プラットフォーム操作の宣言)のうち、**宣言した引数・返す欄と配線先の ABI との明示の対応表**の整合(束 B)。
 *
 * 宣言(`args` / `returns`)と配線先(`binding`)の実際の形は別の語彙で書かれ、片方だけ変わると画面が組まれたまま食い違う
 * (設計レビューの指摘: 欄の名前 `is_current` ⇔ `current`、引数 `keep_self` ⇔ `options.keepSelf`)。そこで対応表を宣言に持たせ、ここで過不足を拒む。
 *
 * | 見ること | 落とす例 |
 * |---|---|
 * | 配線先のポートが `platform_ports` に宣言されている | 宣言の無いポートへ配線した |
 * | 宣言した引数ごとに、対応する配線先の引数(かプロパティ)がちょうど 1 つ(未対応・余剰・重複) | `keep_self` を対応させ忘れた・同じ引数を 2 つに対応させた |
 * | 対応する型が一致する(`from: row` の識別子は `string`・`bool` は `boolean`・`int` は `number`) | `keep_self` を `string` に対応させた |
 * | `result` がある。`read` は行の配列 `{ rows }`(行の型 = shape の `row`)・`do` はスカラー | 戻り値の形を宣言していない |
 * | 返す欄の対応表がある。欄ごとに行のプロパティが実在し、同じプロパティを 2 つの欄に対応させない | 欄 `last_used_at` の対応先が行に無い |
 * | `from: row` の識別子の欄は、行の `string`(null にならない)に対応する | 識別子の欄が null になりうる |
 * | 対応先の行のプロパティ名にも秘密を指す語(`secret_field_words`)を含まない | 欄名は無害でも、行の `refreshToken` を写している |
 *
 * 配線先の TypeScript の形そのものとの突合(メソッドの実在・引数・戻り値)は `h9-platform-binding-source.ts`。
 */

import type { Finding } from '../../kernel/finding.js';
import type { AuthPlatformOps, PlatformArg, PlatformBindingParam, PlatformOpDecl, PlatformPortDecl, PlatformRowDecl, PlatformShape, PlatformValueType } from '../../model/auth/platform-ops.js';
import { VALUE_TYPE_OF_ARG } from '../../model/auth/platform-ops.js';

/** この検証器の ID(H9 の一部)。 */
const VERIFIER_ID = 'H9';

function h9(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { severity: 'error', verifier: VERIFIER_ID, ...args };
}

/** 対応先 1 件(宣言した引数の名前・配線先の側の型・どこに書かれたか)。 */
interface Mapped {
  readonly arg: string;
  readonly type: PlatformValueType;
  readonly where: string;
}

/** 配線先の引数の列から、宣言した引数への対応を集める。 */
function mappedArgs(params: readonly PlatformBindingParam[]): readonly Mapped[] {
  return params.flatMap((param): Mapped[] =>
    param.kind === 'scalar'
      ? [{ arg: param.map.arg, type: param.map.type, where: `引数 ${param.name}` }]
      : param.props.map((prop) => ({ arg: prop.arg, type: prop.type, where: `引数 ${param.name} のプロパティ ${prop.prop}` })),
  );
}

/** 宣言した引数が配線先で取る型。 */
function expectedType(arg: PlatformArg): PlatformValueType {
  return arg.kind === 'row' ? 'string' : VALUE_TYPE_OF_ARG[arg.type];
}

/** 引数の対応表(未対応・余剰・重複・型・引数名の重複)。 */
function checkParams(op: PlatformOpDecl): Finding[] {
  const findings: Finding[] = [];
  const mapped = mappedArgs(op.binding.params);
  const names = op.binding.params.map((param) => param.name);
  for (const name of names.filter((candidate, index) => names.indexOf(candidate) !== index)) {
    findings.push(h9({ message: `操作 ${op.id} の配線先の引数名 ${name} が重複しています`, location: op.location, suggestion: 'params の name は配線先のメソッドの引数名で、重複しない', counterexample: { op: op.id, param: name } }));
  }
  for (const arg of op.args) {
    const hits = mapped.filter((entry) => entry.arg === arg.name);
    if (hits.length === 0) {
      findings.push(
        h9({
          message: `操作 ${op.id} の引数 ${arg.name} の対応先が、配線先の引数にありません(未対応)`,
          location: arg.location,
          suggestion: `binding.params に、配線先のメソッド ${op.binding.method} の引数かプロパティを { arg: ${arg.name}, type: … } で書く(宣言した引数を配線先へ渡す道が無いと、画面の入力が捨てられる)`,
          counterexample: { op: op.id, arg: arg.name },
        }),
      );
      continue;
    }
    if (hits.length > 1) {
      findings.push(
        h9({
          message: `操作 ${op.id} の引数 ${arg.name} が、配線先の複数の引数に対応しています(${hits.map((hit) => hit.where).join(' / ')})`,
          location: arg.location,
          suggestion: '宣言した引数は配線先のちょうど 1 つの引数かプロパティに対応させる(同じ値を 2 か所へ渡す必要があるなら、配線先のメソッドの引数を 1 つにまとめる)',
          counterexample: { op: op.id, arg: arg.name },
        }),
      );
    }
    const wrong = hits.find((hit) => hit.type !== expectedType(arg));
    if (wrong !== undefined) {
      findings.push(
        h9({
          message: `操作 ${op.id} の引数 ${arg.name} の型が配線先と食い違います(${wrong.where} は ${wrong.type}・宣言からは ${expectedType(arg)})`,
          location: arg.location,
          suggestion: '識別子(from: row)は string・bool は boolean・int は number に対応させる',
          counterexample: { op: op.id, arg: arg.name, binding: wrong.type, declared: expectedType(arg) },
        }),
      );
    }
  }
  for (const entry of mapped.filter((candidate) => !op.args.some((arg) => arg.name === candidate.arg))) {
    findings.push(
      h9({
        message: `操作 ${op.id} の配線先の${entry.where}が、宣言に無い引数 ${entry.arg} を指しています(余剰)`,
        location: op.location,
        suggestion: `args に ${entry.arg} を宣言するか、配線先の引数の対応を消す(宣言に無い入力を配線先へ渡さない)`,
        counterexample: { op: op.id, arg: entry.arg },
      }),
    );
  }
  return findings;
}

/** 戻り値の対応(result がある・read は行の配列で行の型が shape と一致・do はスカラー)。 */
function checkResult(op: PlatformOpDecl, section: AuthPlatformOps, port: PlatformPortDecl | undefined): Finding[] {
  const result = op.binding.result;
  if (result === undefined) {
    return [
      h9({
        message: `操作 ${op.id} の binding.result がありません(配線先の戻り値の形が宣言されていません)`,
        location: op.location,
        suggestion: op.kind === 'read' ? 'result に { rows: 行の型名 } を書く(行の型は platform_ports の rows)' : 'result に string / boolean / number を書く(結果の union の value の型)',
        counterexample: { op: op.id },
      }),
    ];
  }
  if (op.kind === 'do') {
    return result.kind === 'scalar'
      ? []
      : [h9({ message: `操作 ${op.id} は kind: do なのに result が行の配列です`, location: op.location, suggestion: 'do の result は string / boolean / number(行を返すのは kind: read だけ)', counterexample: { op: op.id } })];
  }
  if (result.kind !== 'rows') {
    return [h9({ message: `読み ${op.id} の result が行の配列ではありません`, location: op.location, suggestion: 'read の result は { rows: 行の型名 }', counterexample: { op: op.id } })];
  }
  const findings: Finding[] = [];
  if (port !== undefined && !port.rows.some((row) => row.name === result.row)) {
    findings.push(h9({ message: `読み ${op.id} の行の型 ${result.row} が、ポート ${port.name} の rows にありません`, location: op.location, suggestion: `platform_ports.${port.name}.rows に ${result.row} を宣言する`, counterexample: { op: op.id, row: result.row } }));
  }
  const shape = section.shapes.find((candidate) => candidate.name === op.returns);
  if (shape?.row !== undefined && shape.row !== result.row) {
    findings.push(
      h9({
        message: `読み ${op.id} の result の行の型 ${result.row} と、shape ${shape.name} の row ${shape.row} が食い違います`,
        location: op.location,
        suggestion: '読みが返す行の型と、返す欄の対応表の row は同じ行の型にする',
        counterexample: { op: op.id, result: result.row, shape: shape.row },
      }),
    );
  }
  return findings;
}

/** 返す欄の対応表(あること・行のプロパティが実在・同じプロパティを 2 つの欄に対応させない・秘密語)。 */
function checkShape(shape: PlatformShape, row: PlatformRowDecl | undefined, secretWords: readonly string[]): Finding[] {
  if (shape.mapping === undefined || shape.row === undefined) {
    return [
      h9({
        message: `shape ${shape.name} に、欄 → 配線先の行のプロパティの対応表がありません`,
        location: shape.location,
        suggestion: `shapes.${shape.name} を { row: 行の型名, fields: { 欄: 行のプロパティ, … } } で書く(欄ごとに対応を省略しない)`,
        counterexample: { shape: shape.name },
      }),
    ];
  }
  const findings: Finding[] = [];
  const seen = new Map<string, string>();
  for (const entry of shape.mapping) {
    if (row !== undefined && !row.props.some((prop) => prop.name === entry.from)) {
      findings.push(
        h9({
          message: `shape ${shape.name} の欄 ${entry.field} の対応先 ${entry.from} が、行の型 ${row.name} にありません`,
          location: shape.location,
          suggestion: `行の型 ${row.name} のプロパティ(${row.props.map((prop) => prop.name).join(' / ')})のどれかにする`,
          counterexample: { shape: shape.name, field: entry.field, from: entry.from },
        }),
      );
    }
    const earlier = seen.get(entry.from);
    if (earlier !== undefined) {
      findings.push(
        h9({
          message: `shape ${shape.name} の欄 ${earlier} と ${entry.field} が、同じ行のプロパティ ${entry.from} に対応しています(重複)`,
          location: shape.location,
          suggestion: '1 つの行のプロパティは 1 つの欄にだけ対応させる',
          counterexample: { shape: shape.name, from: entry.from },
        }),
      );
    }
    seen.set(entry.from, entry.field);
    const word = secretWords.find((candidate) => entry.from.toLowerCase().includes(candidate));
    if (word !== undefined) {
      findings.push(
        h9({
          message: `shape ${shape.name} の欄 ${entry.field} の対応先 ${entry.from} は秘密を指す語 ${word} を含みます`,
          location: shape.location,
          suggestion: '欄名を無害にしても、秘密の行のプロパティを写せば画面へ流れる。対応先を秘密でないプロパティにする',
          counterexample: { shape: shape.name, field: entry.field, from: entry.from, word },
        }),
      );
    }
  }
  return findings;
}

/** `from: row` の識別子の欄が、行の null にならない string に対応する。 */
function checkIdentifierFields(op: PlatformOpDecl, section: AuthPlatformOps): Finding[] {
  return op.args.flatMap((arg) => {
    if (arg.kind !== 'row') return [];
    const source = section.ops.find((candidate) => candidate.id === arg.of);
    const shape = section.shapes.find((candidate) => candidate.name === source?.returns);
    const port = section.ports.find((candidate) => candidate.name === source?.binding.port);
    const from = shape?.mapping?.find((entry) => entry.field === arg.field)?.from;
    const prop = port?.rows.find((row) => row.name === shape?.row)?.props.find((candidate) => candidate.name === from);
    if (prop === undefined || (prop.type === 'string' && !prop.nullable)) return [];
    return [
      h9({
        message: `操作 ${op.id} の引数 ${arg.name} の識別子の欄 ${arg.field} が、行のプロパティ ${prop.name}(${prop.type}${prop.nullable ? '・null がありうる' : ''})に対応しています`,
        location: arg.location,
        suggestion: '識別子の欄は null にならない string の行のプロパティに対応させる(ボタンが渡す値が決まらない)',
        counterexample: { op: op.id, arg: arg.name, field: arg.field, property: prop.name },
      }),
    ];
  });
}

/** `skip_if`(出どころの行の真偽値の欄)・`labels` / `formats` の鍵(欄の部分集合)・`datetime` は文字列の欄だけ。 */
function checkDisplay(op: PlatformOpDecl, section: AuthPlatformOps): Finding[] {
  const findings: Finding[] = [];
  for (const arg of op.args) {
    if (arg.kind !== 'row' || arg.skipIf === undefined) continue;
    const source = section.ops.find((candidate) => candidate.id === arg.of);
    const shape = section.shapes.find((candidate) => candidate.name === source?.returns);
    const from = shape?.mapping?.find((entry) => entry.field === arg.skipIf)?.from;
    const prop = section.ports.find((port) => port.name === source?.binding.port)?.rows.find((row) => row.name === shape?.row)?.props.find((candidate) => candidate.name === from);
    if (shape !== undefined && (prop === undefined || prop.type !== 'boolean' || prop.nullable)) {
      findings.push(
        h9({
          message: `操作 ${op.id} の引数 ${arg.name} の skip_if ${arg.skipIf} が、出どころ ${arg.of} の行の null にならない真偽値の欄ではありません`,
          location: arg.location,
          suggestion: 'skip_if には、出どころの shape の欄で、行の boolean(null にならない)に対応するものを書く',
          counterexample: { op: op.id, arg: arg.name, skipIf: arg.skipIf },
        }),
      );
    }
  }
  return findings;
}

/** `labels` / `formats` の鍵が欄の部分集合・`datetime` は string の欄だけ。 */
function checkShapeDisplay(shape: PlatformShape, row: PlatformRowDecl | undefined): Finding[] {
  const findings: Finding[] = [];
  const words = [...(shape.labels?.map((entry) => ({ key: 'labels', field: entry.field })) ?? []), ...(shape.formats?.map((entry) => ({ key: 'formats', field: entry.field })) ?? [])];
  for (const { key, field } of words.filter((entry) => !shape.fields.includes(entry.field))) {
    findings.push(h9({ message: `shape ${shape.name} の ${key} の ${field} が、shape の欄にありません`, location: shape.location, suggestion: `${key} の鍵は fields の欄にする`, counterexample: { shape: shape.name, field } }));
  }
  for (const entry of shape.formats ?? []) {
    const from = shape.mapping?.find((candidate) => candidate.field === entry.field)?.from;
    const prop = row?.props.find((candidate) => candidate.name === from);
    if (prop !== undefined && prop.type !== 'string') {
      findings.push(h9({ message: `shape ${shape.name} の欄 ${entry.field} の整形 ${entry.format} は、string の欄にだけ書けます(行のプロパティ ${prop.name} は ${prop.type})`, location: shape.location, suggestion: 'formats から消す', counterexample: { shape: shape.name, field: entry.field } }));
    }
  }
  return findings;
}

/**
 * 対応表の整合を検証する。
 *
 * @param section `platform_ops` の節
 * @returns 違反のリスト
 */
export function verifyPlatformMapping(section: AuthPlatformOps): Finding[] {
  const findings: Finding[] = [];
  for (const op of section.ops) {
    const port = section.ports.find((candidate) => candidate.name === op.binding.port);
    if (port === undefined) {
      findings.push(
        h9({
          message: `操作 ${op.id} の配線先のポート ${op.binding.port} が platform_ports に宣言されていません`,
          location: op.location,
          suggestion: `platform_ports に ${op.binding.port}: { result: {…}, refusals: {…}, rows: {…} } を宣言する(結果の union・失敗の理由と文言・行の型)`,
          counterexample: { op: op.id, port: op.binding.port },
        }),
      );
    }
    findings.push(...checkParams(op), ...checkResult(op, section, port), ...checkIdentifierFields(op, section), ...checkDisplay(op, section));
  }
  const readShapes = new Set(section.ops.flatMap((op) => (op.kind === 'read' && op.returns !== undefined ? [op.returns] : [])));
  for (const shape of section.shapes.filter((candidate) => readShapes.has(candidate.name))) {
    const reader = section.ops.find((op) => op.returns === shape.name);
    const row = section.ports.find((port) => port.name === reader?.binding.port)?.rows.find((candidate) => candidate.name === shape.row);
    findings.push(...checkShape(shape, row, section.secretWords), ...checkShapeDisplay(shape, row));
  }
  return findings;
}
