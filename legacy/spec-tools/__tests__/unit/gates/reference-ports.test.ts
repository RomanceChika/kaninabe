import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * **ドメイン仕様のモデルの「名前を書く口」の全数を固定し、参照の口が全部どこかの接地の検査に載っていることを見る**。
 *
 * 綴りで効く宣言(列名・ロール名・集約名・状態機械名・イベント名)は、当たらなければ**何も起きない**宣言になる。
 * 隠し列の `fields_hidden[].field` / `from` が実際にそうだった —— 形だけを読み、どの検査も実在を見ていなかったので、
 * `field: emial` も `from: [anonymus]` も verify を通り、surface のビューは素の列を誰にでも出した。
 *
 * そこで、モデルの型(`lib/model/types-*.ts`)の**文字列を持つ欄**を AST で全部拾い、ここの表(`PORTS`)で 1 つずつ分類させる。
 *
 *   1. 型の中の文字列の欄(`string` / `readonly string[]` / `Record<string, string>` / 文字列のタプル / `number | string`)は、
 *      すべて表に載っている(欄を足したら分類を足さないと赤・表だけにある欄も赤)
 *   2. **参照**(他の宣言を名指す欄)は、接地を見る検査の ID と**その判定を書いたファイル**を持つ。そのファイルは
 *      その欄を `.{欄}` で読んでいる(配線を外した・別の欄を読むように書き換えた形を拾う)。**読み込みの段(V1)で
 *      接地するもの**は、判定のファイルがその欄を**組み立てる**側(`{ 欄 }` / `欄: …` を書く)なので、組み立てを見る
 *   3. **参照でない**欄(自分が名前を宣言する欄・表示の文言・式そのもの)は、なぜ接地の対象でないかを理由で書く
 *
 * 限界:
 *   - 見るのはドメイン仕様のモデル(`TYPE_FILES`)だけである。他の種類(query_spec ほか)の口は各群の検査が持ち、ここは見ない
 *   - 2 は「判定のファイルがその欄を読む」ことまでで、**読んだ上で実在を確かめているか**は見ない(それは各検査の負例のテストが見る)
 *   - 式(`guard` / `when` / `binding` …)の中のパスは「式」として 1 つに数える。式の中の接地は V2 の `checkExpr` が持つ
 */

const LIB_DIR = fileURLToPath(new URL('../../../lib/', import.meta.url));

/** 走査するモデルの型のファイル(ドメイン仕様)。 */
const TYPE_FILES = [
  'model/types-common.ts',
  'model/types-access.ts',
  'model/types-entity.ts',
  'model/types-state.ts',
  'model/types-role.ts',
  'model/types-invariant.ts',
  'model/types-model.ts',
  // 受け入れの型は読み手のファイルに住むが、モデルの名前を書く欄なので数える(点検 13 回目 A13-1 / A13-4)。
  'model/parse-global-key.ts',
  'model/parse-copy-accept.ts',
] as const;

/** 参照の口: 接地を見る検査と、その判定を書いたファイル(`lib/` からの相対)。 */
interface Grounded {
  readonly check: string;
  readonly file: string;
}

/** 参照でない口: なぜ接地の対象でないか。 */
interface NotReference {
  readonly not: string;
}

type Port = Grounded | NotReference;

const DECLARES = '名前を宣言する側の欄(参照される側。一意は各ローダーが見る)';
const PROSE = '人が読む文言(どの宣言も指さない)';
const EXPR = 'ガード式。式の中のパスの接地は V2 の checkExpr が持つ(1 つの口として数えない)';

/** 文字列の欄の分類(`{型}.{欄}`)。無名の型の欄は、それを持つ型の名前で数える。 */
const PORTS: Readonly<Record<string, Port>> = {
  // ---- access_spec
  'ReadScope.entity': { check: 'V2', file: 'verify/verifiers/v2-paths.ts' },
  'ReadFilter.field': { check: 'V2', file: 'verify/verifiers/v2-access-reads.ts' },
  'ReadFilter.actorField': { check: 'V2', file: 'verify/verifiers/v2-access-reads.ts' },
  'ReadFilter.entity': { check: 'V2', file: 'model/read-filter-path.ts' },
  'ReadFilterAccept.by': { check: 'V2', file: 'verify/verifiers/v2-access-fields.ts' },
  'ReadFilterAccept.field': { check: 'V2', file: 'verify/verifiers/v2-access-fields.ts' },
  'ReadFilterAccept.events': { check: 'V2', file: 'verify/verifiers/v2-access-fields.ts' },
  'ReadFilterAccept.reason': { not: PROSE },
  // 受け入れの鍵の列は、今の鍵と同じ集合でなければ腐った受け入れになる(V26)。
  'GlobalKeyAccept.keys': { check: 'V26', file: 'verify/verifiers/v26-unique-keys.ts' },
  'GlobalKeyAccept.reason': { not: PROSE },
  // 受け入れの相手と読み手は、実際の崩れ(隠した相手 × 写し先の reads の by)と一致しなければ腐った受け入れになる(V12 / T15。判定は 1 か所)。
  'CopyAccept.role': { check: 'V12', file: 'semantics/copy-exposure.ts' },
  'CopyAccept.reader': { check: 'V12', file: 'semantics/copy-exposure.ts' },
  'CopyAccept.reason': { not: PROSE },
  'TriggerCopyAccept.column': { check: 'T15', file: 'data/verifiers/t15-supplied-mechanism.ts' },
  'FieldDef.unbounded': { not: PROSE },
  // 実行者の集約の参照の欄がテナントの境界でない理由(A5-4)。人が読む文で、名前を指さない。
  'FieldDef.notBoundary': { not: PROSE },
  // 未ログインに開く書き込みの理由つき受け入れ(R5)。人が読む文で、名前を指さない。
  'WriteRule.public': { not: PROSE },
  'DeleteRule.public': { not: PROSE },
  'EventDef.public': { not: PROSE },
  // 未ログインの作成の歯止め(R5): 鍵の欄と期間を切る日時の欄は、自集約の欄に実在するかを R5 が見る。期間の幅は名前でなく字面(形は読み込みと R5 が閉じる)。
  'AbusePerKey.column': { check: 'R5', file: 'risk/verifiers/r5-abuse.ts' },
  'AbuseDecl.at': { check: 'R5', file: 'risk/verifiers/r5-abuse.ts' },
  'AbuseWindow.per': { not: '期間の幅の字面(`1 hour`)。名前を指さない' },
  'ReadRule.by': { check: 'V11', file: 'verify/verifiers/v11-role-grounding.ts' },
  'ReadRule.when': { not: EXPR },
  'FieldHiddenRule.field': { check: 'V2', file: 'verify/verifiers/v2-access-fields.ts' },
  'FieldHiddenRule.from': { check: 'V11', file: 'verify/verifiers/v11-role-grounding.ts' },
  'CreateRule.by': { check: 'V11', file: 'verify/verifiers/v11-role-grounding.ts' },
  // 代理で作ってよい理由(人が読む文。名前を指さない。空は parse-access が落とす)。
  // 作成の代理の欄(欄を名指す。集約は作る集約と同じことを読み込みが閉じ、欄の接地 —— 作成の input にある実行者への参照 —— は V18 が見る。A10-2)
  'DelegateDecl.entity': { check: 'V1', file: 'model/parse-access.ts' },
  'DelegateDecl.field': { check: 'V18', file: 'verify/verifiers/v18-delegate.ts' },
  'DelegateDecl.reason': { not: PROSE },
  'CreateRule.when': { not: EXPR },
  'DeleteRule.by': { check: 'V11', file: 'verify/verifiers/v11-role-grounding.ts' },
  'DeleteRule.when': { not: EXPR },
  'WriteRule.by': { check: 'V11', file: 'verify/verifiers/v11-role-grounding.ts' },
  'WriteRule.fields': { check: 'V2', file: 'verify/verifiers/v2-access-fields.ts' },
  'WriteRule.when': { not: EXPR },
  'WriteRule.effects': { check: 'J1', file: 'model/notification/effect-refs.ts' },
  // 遷移だけが書く列(実在と、どの遷移も書かない腐った宣言を V19 が見る)。
  'AccessSpec.transitionWrites': { check: 'V19', file: 'verify/verifiers/v19-records-actor.ts' },
  'AccessSpec.id': { not: DECLARES },
  'AccessSpec.entity': { check: 'V2', file: 'verify/verifiers/v2-access-fields.ts' },
  // ---- entity_spec
  'FieldType.values': { not: '値域の宣言(enum の値そのもの)' },
  'FieldType.entity': { check: 'V2', file: 'verify/verifiers/v2-reference-integrity.ts' },
  'FieldType.machine': { check: 'V2', file: 'verify/verifiers/v2-reference-integrity.ts' },
  'FieldDef.name': { not: DECLARES },
  'FieldDef.label': { not: PROSE },
  'FieldDef.labels': { check: 'V16', file: 'verify/verifiers/v16-enum-labels.ts' },
  'BearerDecl.expiresAt': { check: 'R16', file: 'risk/verifiers/r16-bearer.ts' },
  'BearerDecl.usedAt': { check: 'R16', file: 'risk/verifiers/r16-bearer.ts' },
  'BearerDecl.reason': { not: '使い回しを受け入れる理由(受け入れた危険の文言。どの宣言も指さない)' },
  'FieldDef.description': { not: PROSE },
  'FieldDef.pattern': { not: '値の形の正規表現(どの宣言も指さない)' },
  'FieldDef.personalPlaceholder': { not: '消去したときに置く値(どの宣言も指さない)' },
  'EntitySpec.entity': { not: DECLARES },
  'EntitySpec.label': { not: PROSE },
  'EntitySpec.summary': { not: PROSE },
  'EntitySpec.displayField': { check: 'V22', file: 'verify/verifiers/v22-display-field.ts' },
  'EntitySpec.table': { check: 'T1', file: 'data/verifiers/t1-entity-consistency.ts' },
  'EntitySpec.context': { check: 'V2', file: 'verify/verifiers/v2-context.ts' },
  // ---- state_spec
  'SettlesTermDecl.id': { not: DECLARES },
  'SettlesTermDecl.label': { not: PROSE },
  'EventDef.id': { not: DECLARES },
  'EventDef.label': { not: PROSE },
  'EventDef.from': { check: 'V2', file: 'verify/verifiers/v2-reference-integrity.ts' },
  'EventDef.to': { check: 'V2', file: 'verify/verifiers/v2-reference-integrity.ts' },
  'EventDef.by': { check: 'V11', file: 'verify/verifiers/v11-role-grounding.ts' },
  'EventDef.guard': { not: EXPR },
  'EventDef.otherwiseForbidden': { not: PROSE },
  'EventDef.recordsActor': { check: 'V19', file: 'verify/verifiers/v19-records-actor.ts' },
  'EventDef.recordsTime': { check: 'V19', file: 'verify/verifiers/v19-records-actor.ts' },
  'EventDef.clears': { check: 'V19', file: 'verify/verifiers/v19-records-actor.ts' },
  'ForbiddenDef.event': { check: 'V2', file: 'verify/verifiers/v2-reference-integrity.ts' },
  'ForbiddenDef.from': { check: 'V2', file: 'verify/verifiers/v2-reference-integrity.ts' },
  'ForbiddenDef.reason': { not: PROSE },
  'SnapshotFieldMap.from': { check: 'V12', file: 'verify/verifiers/v12-snapshot-source.ts' },
  'SnapshotFieldMap.to': { check: 'V12', file: 'verify/verifiers/v12-snapshot-mapping.ts' },
  'SnapshotDef.to': { check: 'V12', file: 'verify/verifiers/v12-snapshot-mapping.ts' },
  'EffectDef.on': { check: 'V2', file: 'verify/verifiers/v2-reference-integrity.ts' },
  'EffectDef.do': { check: 'J1', file: 'model/notification/effect-refs.ts' },
  'StateMachineSpec.machine': { not: DECLARES },
  'StateMachineSpec.states': { not: DECLARES },
  'StateMachineSpec.stateLabels': { check: 'V1', file: 'model/parse-state.ts' },
  'StateMachineSpec.stateTone': { check: 'V1', file: 'model/parse-state.ts' },
  'StateMachineSpec.stateSettles': { check: 'V1', file: 'model/parse-state.ts' },
  'StateMachineSpec.settlesVocabulary': { not: DECLARES },
  'StateMachineSpec.summary': { not: PROSE },
  'StateMachineSpec.stateSummaries': { check: 'V1', file: 'model/parse-state.ts' },
  'StateMachineSpec.initial': { check: 'V1', file: 'model/parse-state.ts' },
  'StateMachineSpec.final': { check: 'V1', file: 'model/parse-state.ts' },
  // ---- role_spec
  'RoleDef.id': { not: DECLARES },
  'RoleDef.label': { not: PROSE },
  'RoleDef.binding': { not: EXPR },
  'RoleDef.claim': { check: 'V11', file: 'verify/verifiers/v11-claim-grounding.ts' },
  'RoleDef.claimValues': { check: 'V11', file: 'model/role-claim.ts' },
  'RoleDef.implies': { check: 'V1', file: 'model/parse-role.ts' },
  // ---- invariant_spec
  'InvariantFormal.expr': { not: EXPR },
  // 鍵が全体で一意であることの理由(V26 の受け入れ。A12-3)。人が読む文で、名前を指さない。
  'InvariantFormal.keys': { check: 'V10', file: 'verify/verifiers/v10-invariant-formal.ts' },
  'InvariantFormal.where': { not: EXPR },
  'InvariantFormal.range': { check: 'V10', file: 'verify/verifiers/v10-invariant-exclusion.ts' },
  'InvariantFormal.max': { check: 'V10', file: 'verify/verifiers/v10-invariant-formal.ts' },
  'InvariantFormal.if': { not: EXPR },
  'InvariantFormal.then': { not: EXPR },
  'EnforcementDef.ref': { check: 'V10', file: 'verify/verifiers/v10-invariant-enforcement.ts' },
  'InvariantDef.id': { not: DECLARES },
  'InvariantDef.statement': { not: PROSE },
  'InvariantDef.entities': { check: 'V10', file: 'verify/verifiers/v10-invariant-enforcement.ts' },
  'InvariantDef.involves': { check: 'V10', file: 'verify/verifiers/v10-invariant-enforcement.ts' },
  // 形式定義を書かない理由(点検 22 回目 C22-3)。人が読む文で、名前を指さない。
  'InvariantDef.formalOutside': { not: PROSE },
  // ---- R2 の受け入れ(欄 × 役 × 書き手を名指す。名指した組が R2 の書き込みの経路に無い・書き手が宣言の by に無いなら腐った受け入れとして止まる)
  'SelfAssignDecl.entity': { check: 'R2', file: 'model/parse-self-assign.ts' },
  'SelfAssignDecl.field': { check: 'R2', file: 'model/parse-self-assign.ts' },
  'SelfAssignDecl.role': { check: 'R2', file: 'model/parse-self-assign.ts' },
  'SelfAssignDecl.by': { check: 'R2', file: 'risk/verifiers/r2-ground-writers.ts' },
  'SelfAssignDecl.reason': { not: PROSE },
  // ---- 集約の束
  'AggregateSpecs.name': { not: DECLARES },
  'MachineRef.aggregate': { not: '走査の結果(仕様の宣言ではない)' },
};

/** 型の字面が文字列を運ぶか(リテラルの和・オブジェクト・真偽・数だけの欄は名前を書く口ではない)。 */
function carriesString(type: ts.TypeNode): boolean {
  if (type.kind === ts.SyntaxKind.StringKeyword) return true;
  if (ts.isTypeOperatorNode(type)) return carriesString(type.type);
  if (ts.isArrayTypeNode(type)) return carriesString(type.elementType);
  if (ts.isTupleTypeNode(type)) return type.elements.some((element) => carriesString(element));
  if (ts.isUnionTypeNode(type)) return type.types.some((member) => carriesString(member));
  if (ts.isTypeReferenceNode(type)) {
    const name = type.typeName.getText();
    if (name === 'Readonly' || name === 'Record') return (type.typeArguments ?? []).some((argument) => carriesString(argument));
  }
  return false;
}

/** 型の宣言(interface / type)の名前と、その中の文字列の欄(無名の型の中も同じ名前で数える)。 */
function stringFields(file: string): readonly string[] {
  const source = ts.createSourceFile(file, readFileSync(`${LIB_DIR}${file}`, 'utf-8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visitMembers = (owner: string, members: ts.NodeArray<ts.TypeElement>): void => {
    for (const member of members) {
      if (!ts.isPropertySignature(member) || member.type === undefined) continue;
      if (carriesString(member.type)) found.push(`${owner}.${member.name.getText()}`);
    }
  };
  const visitType = (owner: string, type: ts.TypeNode): void => {
    if (ts.isTypeLiteralNode(type)) visitMembers(owner, type.members);
    else if (ts.isUnionTypeNode(type)) for (const member of type.types) visitType(owner, member);
  };
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement)) visitMembers(statement.name.text, statement.members);
    else if (ts.isTypeAliasDeclaration(statement)) visitType(statement.name.text, statement.type);
  }
  return [...new Set(found)];
}

/** 読み込みの段の検査(判定のファイルは欄を組み立てる側)。 */
const PARSE_CHECK = 'V1';

/**
 * そのファイルが欄に触れているか。既定は**読む**形(`.{欄}`・分割代入の鍵)、`builds` なら**組み立てる**形
 * (`{ 欄 }`・`欄: …`。読み込みの段が値を確かめてからモデルに入れる)。
 */
function touches(file: string, field: string, builds = false): boolean {
  const source = ts.createSourceFile(file, readFileSync(`${LIB_DIR}${file}`, 'utf-8'), ts.ScriptTarget.Latest, true);
  let hit = false;
  const visit = (node: ts.Node): void => {
    if (hit) return;
    if (ts.isPropertyAccessExpression(node) && node.name.text === field) hit = true;
    else if (ts.isBindingElement(node) && (node.propertyName ?? node.name).getText() === field) hit = true;
    else if (builds && (ts.isShorthandPropertyAssignment(node) || ts.isPropertyAssignment(node)) && node.name.getText() === field) hit = true;
    else ts.forEachChild(node, visit);
  };
  visit(source);
  return hit;
}

/** 読む形だけを見る(検出器の自己検査に使う)。 */
function reads(file: string, field: string): boolean {
  return touches(file, field);
}

describe('ドメイン仕様のモデルの名前を書く口(参照の口が接地の検査に載っている)', () => {
  const discovered = TYPE_FILES.flatMap((file) => stringFields(file)).sort();

  it('型の中の文字列の欄は、全部が表に分類されている(足した欄・消えた欄の両方で赤)', () => {
    expect(discovered).toEqual(Object.keys(PORTS).sort());
  });

  it('参照の口は、接地を見る検査の判定のファイルがその欄を読んでいる', () => {
    const missing = Object.entries(PORTS)
      .filter((entry): entry is [string, Grounded] => 'check' in entry[1])
      .filter(([key, port]) => !touches(port.file, key.split('.')[1] ?? '', port.check === PARSE_CHECK))
      .map(([key, port]) => `${key} → ${port.check}(${port.file})`);
    expect(missing).toEqual([]);
  });

  it('参照でない口は、理由を持つ', () => {
    const blank = Object.entries(PORTS)
      .filter((entry): entry is [string, NotReference] => 'not' in entry[1])
      .filter(([, port]) => port.not.trim().length < 10)
      .map(([key]) => key);
    expect(blank).toEqual([]);
  });

  it('検出器の効き目: 文字列の欄を拾い、真偽・リテラルの和の欄は拾わない(自己検査)', () => {
    expect(discovered).toContain('FieldHiddenRule.field');
    expect(discovered).toContain('FieldHiddenRule.from');
    expect(discovered).not.toContain('FieldDef.required');
    expect(discovered).not.toContain('EnforcementDef.kind');
    expect(reads('verify/verifiers/v2-access-fields.ts', 'fieldsHidden')).toBe(true);
    expect(reads('verify/verifiers/v2-access-fields.ts', 'noSuchField')).toBe(false);
  });
});
