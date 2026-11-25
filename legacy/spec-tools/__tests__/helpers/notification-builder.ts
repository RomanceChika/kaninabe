/**
 * notification_spec(通知カタログ)テスト用の最小ビルダー。
 *
 * 規約(scripts-code-quality.md)により検証器・生成器のテストはファイル I/O を行わず、
 * モデルをテスト内でリテラル構築する。ここではその定型部分(location・語彙の既定)を引き受ける。
 */

import type {
  NotificationCatalogSpec,
  NotificationDecl,
  NotificationSpecModel,
} from '../../lib/model/notification/types.js';
import type { ActionTestCase } from '../../lib/testcase/types.js';
import { loc } from './model-builder.js';

/** カタログの仕様ファイル(location に使う)。 */
const CATALOG_FILE = 'docs/specs/backend/notifications.md';

/** テスト用のテストケース宣言を 1 件作る。 */
export function notificationTestCase(id: string): ActionTestCase {
  return {
    id,
    type: 'unit',
    specIds: ['notification-catalog'],
    covers: ['success'],
    implementation: {
      raw: 'app/src/operation/__tests__/jobs/notification-catalog.test.ts::突合',
      file: 'app/src/operation/__tests__/jobs/notification-catalog.test.ts',
      testName: '突合',
    },
    location: loc(CATALOG_FILE, 'test_cases[0]'),
  };
}

/** 通知 1 本を作る。4 軸は既定値を持ち、必要なものだけ上書きする。 */
export function notification(
  id: string,
  opts: Partial<Omit<NotificationDecl, 'id' | 'location'>> = {},
): NotificationDecl {
  return {
    id,
    medium: 'discord',
    audience: 'staff_channel',
    mention: 'none',
    trigger: 'auto',
    summary: `${id} の説明`,
    recipient: { kind: 'role', role: 'staff' },
    ...opts,
    location: loc(CATALOG_FILE, `notifications.${id}`),
  };
}

/** カタログ 1 件を作る。語彙はビルダーの既定値を全部含む。 */
export function notificationCatalog(
  notifications: readonly NotificationDecl[],
): NotificationCatalogSpec {
  return {
    id: 'notification-catalog',
    vocabulary: {
      medium: [{ id: 'discord' }],
      audience: [
        { id: 'staff_channel', recipient: { kind: 'role', role: 'staff' } },
        { id: 'member_dm', recipient: { kind: 'self', subjectKey: 'member_id' } },
      ],
      mention: [{ id: 'none' }],
    },
    notifications,
    testCases: [notificationTestCase('TC-NOTIFICATION-CATALOG-001')],
    location: loc(CATALOG_FILE),
  };
}

/** NotificationSpecModel を作る(available は既定 true)。 */
export function notificationModel(
  notifications: readonly NotificationDecl[],
  available = true,
): NotificationSpecModel {
  return { available, catalog: notificationCatalog(notifications) };
}
