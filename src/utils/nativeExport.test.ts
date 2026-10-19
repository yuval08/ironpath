import { beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerDownload } from './excelExport';

const native = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  writeFile: vi.fn(),
  share: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: native }));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: native.writeFile },
  Directory: { Cache: 'CACHE' },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: native.share } }));

beforeEach(() => {
  vi.clearAllMocks();
  native.writeFile.mockResolvedValue({ uri: 'file:///cache/export.json' });
  native.share.mockResolvedValue({ activityType: 'test' });
});

describe('Android exports', () => {
  it('shares the exact UTF-8 bytes from app cache', async () => {
    const text = '{"name":"José 🏋"}';
    await triggerDownload(new Blob([text], { type: 'application/json' }), 'backup.json');
    const written = native.writeFile.mock.calls[0]![0];
    expect(Buffer.from(written.data, 'base64').toString('utf8')).toBe(text);
    expect(written).toMatchObject({ directory: 'CACHE', recursive: true });
    expect(written.path).toMatch(/^exports\/\d+-backup\.json$/);
    expect(native.share).toHaveBeenCalledWith({
      title: 'backup.json',
      files: ['file:///cache/export.json'],
      dialogTitle: 'Save or share export',
    });
  });

  it('preserves binary workbook bytes', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0, 128, 255]);
    await triggerDownload(new Blob([bytes]), 'workout.xlsx');
    expect([...Buffer.from(native.writeFile.mock.calls[0]![0].data, 'base64')]).toEqual([...bytes]);
  });

  it('reports storage failure without showing a successful share', async () => {
    native.writeFile.mockRejectedValue(new Error('Storage full'));
    await expect(triggerDownload(new Blob(['backup']), 'backup.json')).rejects.toThrow(
      'Storage full',
    );
    expect(native.share).not.toHaveBeenCalled();
  });
});
