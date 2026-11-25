/**
 * S2 参照実在のチェック。
 *
 * screen-spec-writing.md の S2:「`reads` が query_spec に、`actions`(`overlays[].actions` を
 * 含む)がドメインイベント ID(または予約 ID)に、`navigations[].to` と `chrome` がそれぞれ
 * 画面 / クロームに実在する。`on` はドットを含むなら `{接地したイベント ID}.success` 形で、
 * その操作が同じ画面の `actions`(`overlays[].actions` を含む)に宣言されていること。
 * ドットを含まないなら自由語彙(snake_case)。同じ `on` を 2 回書かないこと。
 * `overlays[].opened_by` が layout の部品に実在し、`overlays[].closes_on` が `on` と同じ語彙で
 * あること」。
 *
 * **`on` の母集合に重ね表示の `actions` を含める**のは Phase C-6 第 2 波の決定である(V9)。
 * 第 1 波の 1 例目(`workshop_manage` の中止確認)では、確認ダイアログが発火する操作の結果で
 * 画面が読み直されることを書くために、同じ操作を画面と重ね表示の両方へ並べる必要があった。
 * 2 例目(`workshop_detail` の下書き削除)で同じ二重宣言が出たため、「どこに置かれたボタンでも
 * 発火するのはその画面である」という生成物(`screens.ts` の `actions`)側の扱いに合わせた。
 *
 * 画面仕様は**他の仕様を再定義しない**(ARCH-SP-0002)。だからこの群の中心はここになる —
 * 画面が書けるのは他所にある名前だけであり、名前が実在しなければ「画面が仕様を発明した」
 * という状態になる。逆向き(ドメインイベントに UI 到達経路があるか)の網羅はここではなく S10 が見る。
 */

import type { Finding, ScreenContext, ScreenVerifier } from '../verifier.js';
import { foreignBlocked, screenFinding } from '../verifier.js';
import type { SourceLocation } from '../../model/types.js';
import type { ScreenInput, ScreenRef, ScreenSpec } from '../../model/screen/types.js';
import { componentNames } from '../../model/screen/parse-layout.js';
import { SUCCESS_SUFFIX, indexChromes, indexScreens, queryIds } from '../../model/screen/lookup.js';
import { isGroundedAction } from '../../semantics/action-ground.js';
import { declaredActionRefs } from '../../model/screen/declared-actions.js';
import { PLATFORM_OP_PREFIX } from '../../model/auth/platform-ops.js';

/** 自由語彙の `on`(ドットを含まない snake_case)。 */
const FREE_ON = /^[a-z][a-z0-9_]*$/;

/** S2: 画面が書いた参照がすべて実在するかを検証する。 */
export const referenceExistenceVerifier: ScreenVerifier = {
  id: 'S2',
  title: '参照実在 — reads / actions / navigations / chrome / opened_by の参照先がある',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    const screens = indexScreens(input.screens);
    const chromes = indexChromes(input.screens);
    const queries = queryIds(input.queries);
    const readsHeld = foreignBlocked(ctx, 'queries'); // query_spec が阻害なら reads の実在は言わない(行は呼び手が言う)
    return input.screens.screens.flatMap((screen) => [
      ...(readsHeld ? [] : checkReads(screen, input, queries)),
      ...checkActions(screen, input),
      ...checkNavigations(screen, screens, input),
      ...checkChrome(screen, chromes),
      ...checkOverlays(screen, input),
    ]);
  },
};

/** reads が query_spec に実在するか。query_spec を読めていない環境では検査しない。 */
function checkReads(
  screen: ScreenSpec,
  input: ScreenInput,
  queries: ReadonlySet<string>,
): Finding[] {
  if (!input.queries.available) return [];
  return screen.reads
    .filter((read) => !queries.has(read.id))
    .map((read) =>
      screenFinding('S2', {
        message: `reads の ${read.id} に対応する query_spec がありません`,
        location: read.location,
        suggestion:
          `specs/backend/queries/{aggregate}/{name}.md を作って id: ${read.id} を宣言するか、` +
          '実在する query_spec の id に直す(画面が読める経路は query_spec が宣言したものだけ)',
        counterexample: { screen: screen.name, read: read.id },
      }),
    );
}

/** actions(と overlays の actions)がドメイン仕様に接地するか。 */
function checkActions(screen: ScreenSpec, input: ScreenInput): Finding[] {
  return declaredActionRefs(screen)
    .filter((action) => !isGroundedAction(input.domain, action.id))
    .map((action) => ungroundedAction(screen, action));
}

/** ドメインに接地しない操作の指摘(`actions` と `on` の両方から使う)。 */
function ungroundedAction(screen: ScreenSpec, action: ScreenRef): Finding {
  return screenFinding('S2', {
    message: `actions の ${action.id} に対応するドメインイベントがありません`,
    location: action.location,
    suggestion:
      '書けるのは state_spec のイベント ID(`{machine}.{event}`)か、' +
      '予約 ID(`{entity}.create` / `.delete` / `.update`。接地先は access_spec)だけ。' +
      '画面から出したい操作がドメインに無いなら、先に specs/domain 側を直す',
    counterexample: { screen: screen.name, action: action.id },
  });
}

/** navigations の遷移先・`on` の形・`on` の重複を見る。 */
function checkNavigations(
  screen: ScreenSpec,
  screens: ReadonlyMap<string, ScreenSpec>,
  input: ScreenInput,
): Finding[] {
  const actionIds = new Set(declaredActionRefs(screen).map((action) => action.id));
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const navigation of screen.navigations) {
    if (!screens.has(navigation.to)) {
      findings.push(
        screenFinding('S2', {
          message: `navigations の遷移先 ${navigation.to} に対応する画面がありません`,
          location: navigation.location,
          suggestion:
            `specs/frontend/screens/{group}/{name}.md を作って id: ${navigation.to} を宣言するか、` +
            '実在する画面 id に直す(リンク切れの遷移はここでエラーにする)' +
            (navigation.viaChrome === undefined
              ? ''
              : `。この遷移は ${navigation.viaChrome} から継承しているので、直すのは chrome の側`),
          counterexample: { screen: screen.name, to: navigation.to },
        }),
      );
    }
    findings.push(
      ...checkTrigger(screen, {
        key: 'navigations の on',
        value: navigation.on,
        location: navigation.location,
        actionIds,
        input,
      }),
    );
    if (seen.has(navigation.on)) {
      findings.push(duplicateOn(screen, navigation));
    }
    seen.add(navigation.on);
  }
  return findings;
}

/** きっかけ(`navigations[].on` / `overlays[].closes_on`)1 件の検査に要るもの。 */
interface TriggerCheck {
  /** 指摘の文面に出す欄の名前(例: `navigations の on`)。 */
  readonly key: string;
  /** 書かれたきっかけの文字列。 */
  readonly value: string;
  readonly location: SourceLocation;
  /** この画面が発火すると宣言した操作の ID(画面 + 重ね表示)。 */
  readonly actionIds: ReadonlySet<string>;
  readonly input: ScreenInput;
}

/**
 * きっかけの語彙を検査する。
 *
 * **`navigations[].on` と `overlays[].closes_on` は同じ語彙である。** どちらも
 * 「ドットを含むなら `{接地したイベント}.success`、含まないなら自由語彙(snake_case)」であり、
 * 前者はその操作をこの画面が発火すると宣言していることを求める。`closes_on` を野放しに
 * すると、`entry.delete.sucess` のような綴り違いや、この画面が起こさない操作の結果で
 * 閉じるという宣言が黙って通る(第 2 波で 2 例目の重ね表示が出るまで検査が無かった)。
 */
function checkTrigger(screen: ScreenSpec, check: TriggerCheck): Finding[] {
  const { key, value, location } = check;
  if (!value.includes('.')) {
    if (FREE_ON.test(value)) return [];
    return [
      screenFinding('S2', {
        message: `${key}(${value})が自由語彙の形式ではありません`,
        location,
        suggestion:
          'UI 都合のきっかけは snake_case で書く(例: cancel / workshop_selected)。' +
          '操作の結果を指すなら "{イベント ID}.success" にする',
        counterexample: { screen: screen.name, on: value },
      }),
    ];
  }

  if (!value.endsWith(SUCCESS_SUFFIX)) {
    return [
      screenFinding('S2', {
        message: `${key}(${value})が "{イベント ID}.success" の形ではありません`,
        location,
        suggestion:
          'ドットを含むきっかけは操作の結果を指す宣言であり、書けるのは成功だけである' +
          '(綴りが違うなら .success に直す)。**操作の失敗では遷移も閉じもしない**のが既定で、' +
          '拒否は同じ画面に表示する。UI 都合のきっかけならドットを含まない自由語彙にする',
        counterexample: { screen: screen.name, on: value },
      }),
    ];
  }

  const event = value.slice(0, -SUCCESS_SUFFIX.length);
  if (event.startsWith(PLATFORM_OP_PREFIX)) return []; // プラットフォーム操作の結果は S20 が見る(ドメインイベントではない)
  if (event.startsWith(USECASE_PREFIX)) return checkUsecaseTrigger(screen, check, event.slice(USECASE_PREFIX.length));
  if (!isGroundedAction(check.input.domain, event)) {
    return [ungroundedAction(screen, { id: event, location })];
  }
  if (check.actionIds.has(event)) return [];
  return [
    screenFinding('S2', {
      message: `${key}(${value})が指す操作をこの画面は発火しません`,
      location,
      suggestion:
        `actions(または overlays[].actions)に ${event} を足すか、` +
        'きっかけを UI 都合の自由語彙(例: cancel)に直す。' +
        '「操作の結果」と書けるのは、その操作を宣言している画面だけ',
      counterexample: { screen: screen.name, on: value, action: event },
    }),
  ];
}

/**
 * 保存点の結果を指すきっかけ(`usecase.{ユースケース名}.{保存点 ID}.success`)。
 *
 * 操作(ドメインイベント)ではなく**保存点**を指す。書けるのは、その保存点を `usecases` に
 * 宣言している画面だけである(操作の場合と同じ規則)。保存点そのものの実在と、手順が
 * 操作として並んでいることは S16 が見る。
 */
function checkUsecaseTrigger(screen: ScreenSpec, check: TriggerCheck, save: string): Finding[] {
  if (screen.usecases.some((declared) => declared.id === save)) return [];
  return [
    screenFinding('S2', {
      message: `${check.key}(${check.value})が指す保存点をこの画面は宣言していません`,
      location: check.location,
      suggestion:
        `usecases に ${save} を足すか、きっかけを UI 都合の自由語彙(例: cancel)に直す。` +
        '「保存点の結果」と書けるのは、その保存点を宣言している画面だけ',
      counterexample: { screen: screen.name, on: check.value, usecase: save },
    }),
  ];
}

/** 保存点の結果を指すきっかけの前置(`usecase.`)。ドメインイベント ID とは名前空間が違う。 */
const USECASE_PREFIX = 'usecase.';

/** 同じきっかけに 2 つの遷移先がある(どちらへ行くか決まらない)。 */
function duplicateOn(screen: ScreenSpec, navigation: ScreenSpec['navigations'][number]): Finding {
  return screenFinding('S2', {
    message: `navigations の on(${navigation.on})が重複しています`,
    location: navigation.location,
    suggestion:
      '同じきっかけに 2 つの行き先があると、どちらへ遷移するかが宣言から決まらない。' +
      'どちらかを消すか、きっかけを別の語彙に分ける' +
      (navigation.viaChrome === undefined
        ? ''
        : `(この遷移は ${navigation.viaChrome} から継承したもの。画面側の同名の宣言を消せば足りる)`),
    counterexample: { screen: screen.name, on: navigation.on, to: navigation.to },
  });
}

/** chrome が実在するか。 */
function checkChrome(screen: ScreenSpec, chromes: ReadonlyMap<string, { readonly id: string }>): Finding[] {
  const chrome = screen.chrome;
  if (chrome === undefined || chromes.has(chrome.id)) return [];
  return [
    screenFinding('S2', {
      message: `chrome の ${chrome.id} に対応する chrome_spec がありません`,
      location: chrome.location,
      suggestion:
        `specs/frontend/chrome/{name}.md を作って id: ${chrome.id} を宣言するか、実在する id に直す`,
      counterexample: { screen: screen.name, chrome: chrome.id },
    }),
  ];
}

/** overlays の `opened_by` が画面の部品に実在するか、`closes_on` の語彙が正しいか。 */
function checkOverlays(screen: ScreenSpec, input: ScreenInput): Finding[] {
  const parts = componentNames(screen.layout);
  const actionIds = new Set(declaredActionRefs(screen).map((action) => action.id));
  return screen.overlays.flatMap((overlay) => [
    ...(overlay.openedBy !== undefined && !parts.has(overlay.openedBy)
      ? [
          screenFinding('S2', {
            message: `overlays の opened_by(${overlay.openedBy})が layout にありません`,
            location: overlay.location,
            suggestion:
              'これを開く部品を layout のどこかのスロットに置く(名前を書き間違えていないか確認する)。' +
              '開く口の無い重ね表示は、どこからも出せない画面と同じで到達できない',
            counterexample: { screen: screen.name, overlay: overlay.id, opened_by: overlay.openedBy },
          }),
        ]
      : []),
    ...overlay.closesOn.flatMap((closesOn) =>
      checkTrigger(screen, {
        key: `overlays(${overlay.id})の closes_on`,
        value: closesOn,
        location: {
          file: overlay.location.file,
          ...(overlay.location.pointer === undefined
            ? {}
            : { pointer: `${overlay.location.pointer}.closes_on` }),
        },
        actionIds,
        input,
      }),
    ),
  ]);
}
