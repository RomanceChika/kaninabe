/**
 * `kind: platform_actions`(行に依らないボタン列)と `kind: table` の `row_actions`(既存の表の行ごとの差し込み列に置く提供者とボタン)の本体の字面
 * (`code-platform-parts.ts` が呼ぶ)。確認ダイアログと拒否の表示は共有フック `usePlatformActions` が持つ。アプリの語彙は 1 語も持たない(W1)。
 */

import { docComment, tsString } from '../../gen-kit/code-emit.js';
import type { BodyModules } from '../body-modules.js';
import { actionsPropLines, importLines, operationLines } from './platform-parts-common.js';
import type { PlatformPartPlan } from './platform-parts-plan.js';
import { screenTestIdsName } from './screen-form-plan.js';
import { headerLines } from './screen-table-body.js';

/** `bar`(行に依らないボタン列)。 */
export function barLines(part: PlatformPartPlan, spec: string, modules: BodyModules): string[] {
  const testIds = screenTestIdsName(part.screen);
  return [
    "'use client';",
    '',
    ...headerLines(spec),
    '',
    ...importLines(part, modules),
    '',
    docComment(['部品の testid のキー(`testids.ts` のキーと同じ。`skin` のキーでもある)。']),
    `const KEY = ${tsString(part.path)} as const;`,
    '',
    docComment(['部品の testid(ボタン・拒否の表示はこれを接頭辞に持つ葉)。']),
    `const TESTID = ${testIds}[KEY];`,
    '',
    docComment(['行を持たないボタン列の「行」(ボタンの出し分けに使う行は無い)。']),
    'type NoRow = Readonly<Record<string, never>>;',
    'const NO_ROW: NoRow = {};',
    '',
    docComment([`${part.exportName} の props。`]),
    `export interface ${part.exportName}Props {`,
    ...actionsPropLines(part),
    '  /** 器が `className` を差し替える口(渡さなければ既定のスタイル)。 */',
    `  readonly skin?: ScreenSkin<${tsString(part.screen)}> | undefined;`,
    '}',
    '',
    docComment([
      `認証基盤の操作のボタン列(画面 ${part.screen} の部品 ${part.component})。`,
      '',
      `仕様: ${spec}`,
      '',
      '**このボタン列に業務の判断は 1 つも無い。** 確認が要る操作は確認の重ね表示を経て実行する。',
    ]),
    `export function ${part.exportName}({ actions, skin }: ${part.exportName}Props) {`,
    '  const bar = usePlatformActions<NoRow>({',
    '    testId: TESTID,',
    "    rowKey: () => 'bar',",
    '    operations: [',
    ...part.buttons.flatMap((button) => operationLines(part, button)),
    '    ],',
    '  });',
    '  return (',
    '    <div data-testid={TESTID} className={skin?.[KEY] ?? styles.screenRowActions}>',
    '      {bar.buttons(NO_ROW)}',
    '      {bar.footer}',
    '    </div>',
    '  );',
    '}',
    '',
  ];
}

/** `rows`(既存の表の行ごとの差し込み列に置く提供者とボタン)。 */
export function rowsLines(part: PlatformPartPlan, spec: string, modules: BodyModules): string[] {
  const testIds = screenTestIdsName(part.screen);
  const stem = part.exportName.replace(/Provider$/u, '');
  const rowType = `${stem}Row`;
  const keyProp = part.rowProps[0] ?? 'id';
  return [
    "'use client';",
    '',
    ...headerLines(spec),
    '',
    ...importLines(part, modules),
    '',
    docComment(['部品の testid のキー(`testids.ts` のキーと同じ。表の部品と同じキー)。']),
    `const KEY = ${tsString(part.path)} as const;`,
    '',
    docComment(['部品の testid(行のボタン・拒否の表示はこれを接頭辞に持つ葉)。']),
    `const TESTID = ${testIds}[KEY];`,
    '',
    docComment(['ボタンが行から受ける欄(表の行の型のうち、宣言した `from: row` の欄)。']),
    `export interface ${rowType} {`,
    ...part.rowProps.map((prop) => `  readonly ${prop}: string;`),
    '}',
    '',
    `const Context = createContext<PlatformActions<${rowType}> | null>(null);`,
    '',
    docComment([`${part.exportName} の props。`]),
    `export interface ${part.exportName}Props {`,
    ...actionsPropLines(part),
    '  /** 表(行のボタンを差し込んだもの)。確認ダイアログと拒否の表示は表の外側に 1 回だけ置く。 */',
    '  readonly children: ReactNode;',
    '}',
    '',
    docComment([
      `表の行のボタンの提供者(画面 ${part.screen} の部品 ${part.component} の row_actions)。`,
      '',
      `仕様: ${spec}`,
      '',
      '表を子として包み、行のボタンの実行・確認ダイアログ・拒否の表示を引き受ける。確認の器は操作ごとに 1 つで、表の行の数に依らない。',
    ]),
    `export function ${part.exportName}({ actions, children }: ${part.exportName}Props) {`,
    `  const rowActions = usePlatformActions<${rowType}>({`,
    '    testId: TESTID,',
    `    rowKey: (row) => row.${keyProp},`,
    '    operations: [',
    ...part.buttons.flatMap((button) => operationLines(part, button)),
    '    ],',
    '  });',
    '  return (',
    '    <Context.Provider value={rowActions}>',
    '      {children}',
    '      {rowActions.footer}',
    '    </Context.Provider>',
    '  );',
    '}',
    '',
    docComment([`${stem}Buttons の props。`]),
    `export interface ${stem}ButtonsProps {`,
    '  /** ボタンの対象の行。 */',
    `  readonly row: ${rowType};`,
    '}',
    '',
    docComment(['1 行ぶんのボタン(提供者の中に置く。表の行ごとの差し込み列 `rowExtras` に入れる)。']),
    `export function ${stem}Buttons({ row }: ${stem}ButtonsProps) {`,
    '  const rowActions = useContext(Context);',
    `  if (rowActions === null) throw new Error('${stem}Buttons は ${part.exportName} の中に置く');`,
    '  return <>{rowActions.buttons(row)}</>;',
    '}',
    '',
  ];
}

