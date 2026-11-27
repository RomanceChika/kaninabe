/**
 * 許す文面の閉じた表(`helpers/absence-templates.ts`)自体の見張り。
 *
 * 表が緩いと、通した題材の「印つきの指摘は全部表に当たる」という検査が何も言わなくなる。だから表の側を 2 方向で押さえる:
 *   - 印を付ける枝の実際の文面(今のコードの文面)が、その検査の表に当たる
 *   - 同じ検査の**付けない枝**の実際の文面が、表のどれにも当たらない(ホストの設定・登録の食い違い・宣言の無い口 など)
 */

import { describe, expect, it } from 'vitest';
import { ABSENCE_TEMPLATES, matchesAbsenceTemplate } from '../../helpers/absence-templates.js';

/** [検査 ID, 印を付ける枝の文面]。 */
const TAGGED: readonly (readonly [string, string])[] = [
  ['A2', 'handles(sales_order.pay)に対応する Server Action の実装がありません'],
  ['A6', 'TC-ROOM-CREATE-001 の implementation が指すテストファイルがありません'],
  ['A6', 'TC-ROOM-CREATE-001 に対応する "@tc TC-ROOM-CREATE-001" がテストコードにありません'],
  ['A10', 'booking.expire の走査として宣言された app/src/jobs/expire.ts が存在しません'],
  ['G7', 'トークン --color-ok をどの実装 CSS からも参照していません(死語彙)'],
  ['G8', 'brand.icon が指すファイル app/src/app/icon.png が実在しません'],
  ['H2', '関門 session の implementation app/src/composition/auth.ts::requireSession が実在しません'],
  ['H3', 'TC-AUTH-SIGNIN-001 の implementation が指すテストファイルがありません'],
  ['J2', 'ジョブ stocktake_reminder_scan の implementation app/src/operation/jobs/stocktake-reminder.ts が実在しません'],
  ['J2', 'ジョブ stocktake_reminder_scan の endpoint /api/stocktake/remind に対応する Route Handler がありません'],
  ['J2', '/api/auth/callback に対応する Route Handler がありません'],
  ['J3', 'ジョブ nightly(scheduler: database)が supabase/migrations の cron.schedule に登録されていません'],
  ['K1', 'カタログの設定 BANK_TRANSFER_ENDPOINT を読んでいる実装がありません'],
  ['Q6', 'TC-ROOM-ROOM_LIST-001 の implementation が指すテストファイルがありません'],
  ['S7', 'route /mfa に対応する実ルートが app/src/app にありません'],
  ['S8', 'TC-SCREEN-BOOKING_NEW-003 の implementation が指すテストファイルがありません'],
  ['S11', 'screen-desk の smoke の implementation が指すファイル(app/e2e/desk.spec.ts)がありません'],
  ['T3', 'TC-TABLE-ROOMS-001 の implementation が指すテストファイルがありません'],
  ['T17', 'トリガ関数 check_room_overlap の handwritten が名指した migration 20260101000000_x.sql は実在しません'],
  ['V10', 'INV-CLAIM-001: enforced_by(kind: application)の ref "assertClaimHasLines" は app/src に export された関数・定数として実在しません'],
  ['V10', 'INV-CLAIM-001: enforced_by(kind: application)の ref "assertClaimHasLines" は app/src のどこからも呼ばれていません(宣言だけがあって、この不変条件を実際に守っているものがありません)'],
  ['X1', '連携 bank_transfer の adapter app/src/infrastructure/bank/transfer.ts が実在しません'],
  ['X4', 'TC-EXT-PAY-001 の implementation が指すテストファイルがありません'],
  ['Y9', 'TC-USECASE-BOOK_ROOM-001 の implementation が指すテストファイルがありません'],
  ['Z1', 'TC-GUAR-LOANS-001 の implementation が指すテストファイルがありません'],
];

/** [検査 ID, 印を付けない枝の文面]。どれも今のコードが出す文面。 */
const NEVER_TAGGED: readonly (readonly [string, string])[] = [
  ['A6', 'テストの "@tc TC-ROOM-CREATE-901" に対応するテストケースが、どの仕様(action_spec / query_spec)の test_cases にもありません'],
  ['A6', 'TC-ROOM-CREATE-001 のテスト名が implementation と一致しません'],
  ['A6', 'TC-ROOM-CREATE-001 の "@tc" は別のファイルにあります'],
  ['A2', '仕様ファイルの置き場所が handles(room.create)と一致しません'],
  ['J2', 'app/vercel.json がありません(Git 連携の自動デプロイを止める git.deploymentEnabled を宣言できない)'],
  ['J2', 'ジョブ stocktake_reminder_scan の口 /api/stocktake/remind が app/vercel.json に登録されていません'],
  ['J2', 'HTTP の入口 /api/stray(app/src/app/api/stray/route.ts)が、どの宣言にも当たりません(ジョブの endpoint・受信の連携・認証の口)'],
  ['J3', 'supabase/migrations/20990101000000_x.sql の pg_cron 登録 stray_job(0 * * * *)がジョブカタログに scheduler: database として宣言されていません'],
  ['K1', 'app/src/proxy.ts が読んでいる設定 NODE_ENV が設定カタログにありません'],
  ['S7', '実ルート /secret を宣言している screen_spec がありません'],
  ['S7', 'requires_auth: true の画面 mfa(/mfa)が proxy の matcher に覆われていません'],
  ['S7', '画面 booking_list の route /_hidden/bookings の置き場 src/app/_hidden/bookings/page.tsx は、役割 screen-shell の逆引きでは同じキーに戻りません'],
  ['X1', '連携 bank_transfer の実装 app/src/infrastructure/bank/transfer.ts に port BankPort がありません'],
  ['X1', 'app/src/infrastructure/external/stray.ts はどの連携にも adapter として宣言されていません'],
  ['H2', '関門 session の実装に requireSession がありません'],
  ['Q6', 'room_list に type: integration のテストケースがありません'],
  ['Z1', 'TC-GUAR-LOANS-001 のテスト名が implementation と一致しません'],
  ['G8', 'ハンドブック側のロゴの写し docs/book/assets/icon.png がありません'],
  ['V10', 'INV-CLAIM-001: enforced_by(kind: application)の ref が見つかりません'],
];

describe('許す文面の閉じた表', () => {
  it.each(TAGGED)('%s: 印を付ける枝の文面は表に当たる(%s)', (verifier, message) => {
    expect(matchesAbsenceTemplate(verifier, message)).toBe(true);
  });

  it.each(NEVER_TAGGED)('%s: 印を付けない枝の文面は表に当たらない(%s)', (verifier, message) => {
    expect(matchesAbsenceTemplate(verifier, message)).toBe(false);
  });

  it('表に無い検査 ID は、どんな文面も許さない(Z3 など)', () => {
    expect(matchesAbsenceTemplate('Z3', 'TC-FW-ENGINE-001 の implementation が指すテストファイルがありません')).toBe(false);
    expect(Object.keys(ABSENCE_TEMPLATES)).not.toContain('Z3');
  });

  it('表の正規表現は全部、行頭と行末(V10 の「呼ばれていません」だけは行頭のみ)を固定している', () => {
    for (const [verifier, templates] of Object.entries(ABSENCE_TEMPLATES)) {
      for (const template of templates) {
        expect(template.source.startsWith('^'), `${verifier} ${template.source}`).toBe(true);
        if (!template.source.includes('のどこからも呼ばれていません')) expect(template.source.endsWith('$'), `${verifier} ${template.source}`).toBe(true);
      }
    }
  });
});
