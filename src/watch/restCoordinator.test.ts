import { beforeEach, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({ closeSession: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android', isPluginAvailable: () => true },
  registerPlugin: () => plugin,
}));
import { closeCoordinatedRest } from './restCoordinator';

beforeEach(() => plugin.closeSession.mockReset().mockResolvedValue({ timer: null }));

it('passes the close reason so a switch only cancels the rest', async () => {
  await closeCoordinatedRest('session_1', 'switch');
  await closeCoordinatedRest(null, 'restored');
  expect(plugin.closeSession.mock.calls).toEqual([
    [{ sessionId: 'session_1', reason: 'switch' }],
    [{ sessionId: null, reason: 'restored' }],
  ]);
});
