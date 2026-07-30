const { isNewerVersion } = require('../main/updater');

describe('updater semver comparison', () => {
  test('correctly identifies newer patch versions', () => {
    expect(isNewerVersion('1.5.6', '1.5.7')).toBe(true);
    expect(isNewerVersion('v1.5.6', 'v1.5.7')).toBe(true);
  });

  test('correctly identifies newer minor and major versions', () => {
    expect(isNewerVersion('1.5.6', '1.6.0')).toBe(true);
    expect(isNewerVersion('1.5.6', '2.0.0')).toBe(true);
  });

  test('returns false when current version is equal or newer', () => {
    expect(isNewerVersion('1.5.6', '1.5.6')).toBe(false);
    expect(isNewerVersion('1.6.0', '1.5.6')).toBe(false);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false);
  });
});

describe('logUpdater logger helper', () => {
  const fs = require('fs');
  const path = require('path');
  const { logUpdater } = require('../main/updater');

  test('writes timestamped logs without throwing', () => {
    expect(() => {
      logUpdater('Test update message');
      logUpdater('Test error message', new Error('Mock update error'));
    }).not.toThrow();

    const logPath = path.join(process.cwd(), 'updater.log');
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      expect(content).toContain('Test update message');
      expect(content).toContain('Mock update error');
      try { fs.unlinkSync(logPath); } catch (e) {}
    }
  });
});
