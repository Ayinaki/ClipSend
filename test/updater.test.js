const fs = require('fs');
const path = require('path');
const {
  isNewerVersion,
  logUpdater,
  computeUpdateApplied,
  writeUpdateAttemptMarker,
  processUpdateAttemptMarker
} = require('../main/updater');

describe('artifact naming contract (electron-updater latest.yml vs published asset)', () => {
  test('build artifactName renders to ClipSend.Setup.<version>.exe (dotted, matches release assets)', () => {
    const pkg = require('../package.json');
    const template = pkg.build.artifactName;
    expect(template).toBe('${productName}.Setup.${version}.${ext}');

    const rendered = template
      .replace('${productName}', pkg.build.productName)
      .replace('${version}', pkg.version)
      .replace('${ext}', 'exe');
    // electron-updater reads the installer URL from latest.yml; the name here
    // must be byte-identical to the asset actually uploaded to the GitHub
    // Release (dots, not hyphens) or updates 404 with "Cannot download".
    const product = pkg.build.productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(rendered).toMatch(new RegExp(`^${product}\\.Setup\\.\\d+\\.\\d+\\.\\d+\\.exe$`));
  });
});

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
  test('writes timestamped logs without throwing', () => {
    expect(() => {
      logUpdater('Test update message');
      logUpdater('Test error message', new Error('Mock update error'));
    }).not.toThrow();

    // The log is written to userData when electron is available, otherwise cwd.
    const logPath = path.join(process.cwd(), 'updater.log');
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      expect(content).toContain('Test update message');
      expect(content).toContain('Mock update error');
      try { fs.unlinkSync(logPath); } catch (e) {}
    }
  });
});

describe('update-attempt marker', () => {
  const markerPath = path.join(process.cwd(), 'update-attempt.json');

  afterEach(() => {
    try { fs.unlinkSync(markerPath); } catch (e) {}
  });

  test('computeUpdateApplied matches the marked version against the running version', () => {
    expect(computeUpdateApplied('1.8.18', '1.8.18')).toBe(true);
    expect(computeUpdateApplied('1.8.18', '1.8.17')).toBe(false);
    expect(computeUpdateApplied(null, '1.8.18')).toBe(false);
    expect(computeUpdateApplied('1.8.18', null)).toBe(false);
  });

  test('writes and processes the marker round-trip without throwing', () => {
    writeUpdateAttemptMarker('9.9.9');
    expect(fs.existsSync(markerPath)).toBe(true);

    expect(() => processUpdateAttemptMarker()).not.toThrow();
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  test('processUpdateAttemptMarker is a no-op when no marker exists', () => {
    expect(() => processUpdateAttemptMarker()).not.toThrow();
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  test('removes a malformed marker file without throwing (reported once, not every startup)', () => {
    fs.writeFileSync(markerPath, '{{{ not json', 'utf8');
    expect(() => processUpdateAttemptMarker()).not.toThrow();
    expect(fs.existsSync(markerPath)).toBe(false);
  });
});
