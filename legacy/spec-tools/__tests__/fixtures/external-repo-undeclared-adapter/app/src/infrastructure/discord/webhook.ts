/** X1 のテスト用スタブ(DeliveryPort という名前が実装ファイル内に実在することだけを表す)。 */
export interface DeliveryPort {
  send(): Promise<void>;
}
export function createDiscordDeliveryAdapter(): DeliveryPort {
  return { send: async () => undefined };
}
