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
