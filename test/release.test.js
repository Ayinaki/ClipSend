const {
  bumpPatch,
  versionsMatch,
  buildChangelogEntry,
  serializeChangelogEntry,
  serializeJson,
  escapeJsString
} = require('../scripts/release');

describe('release script: bumpPatch', () => {
  test('bumps the patch digit', () => {
    expect(bumpPatch('1.8.18')).toBe('1.8.19');
    expect(bumpPatch('0.0.1')).toBe('0.0.2');
  });

  test('handles versions with fewer than three parts', () => {
    expect(bumpPatch('1.8')).toBe('1.8.1'); // treated as 1.8.0
    expect(bumpPatch('1')).toBe('1.0.1'); // treated as 1.0.0
  });

  test('strips a v prefix and tolerates non-numeric parts', () => {
    expect(bumpPatch('v1.8.18')).toBe('1.8.19');
    expect(bumpPatch('1.8.x')).toBe('1.8.1');
  });
});

describe('release script: versionsMatch', () => {
  test('matches a plain tag against the package version', () => {
    expect(versionsMatch('v1.8.19', '1.8.19')).toBe(true);
    expect(versionsMatch('1.8.19', '1.8.19')).toBe(true);
  });

  test('rejects mismatches', () => {
    expect(versionsMatch('v1.8.19', '1.8.18')).toBe(false);
    expect(versionsMatch('v1.8.18', '1.8.19')).toBe(false);
    expect(versionsMatch('v1.8.19', 'v1.8.19')).toBe(false); // package version never has v
  });
});

describe('release script: changelog entry', () => {
  test('builds a well-formed entry with a summary', () => {
    const entry = buildChangelogEntry('1.8.19', 'Release Tooling', 'August 2026');
    expect(entry.version).toBe('v1.8.19: Release Tooling');
    expect(entry.date).toBe('August 2026');
    expect(entry.changes).toEqual(['Release Tooling']);
  });

  test('defaults to a bare version title when no summary is given', () => {
    const entry = buildChangelogEntry('1.8.19', '', 'August 2026');
    expect(entry.version).toBe('v1.8.19');
    expect(entry.changes).toEqual(['Release 1.8.19']);
  });

  test('escapes quotes, backslashes and control characters in the summary', () => {
    const entry = buildChangelogEntry('1.8.19', 'Fix "weird" \\ path', 'August 2026');
    expect(entry.changes[0]).toBe('Fix \\"weird\\" \\\\ path');
    const multiLine = buildChangelogEntry('1.8.19', 'line1\nline2\t\r', 'August 2026');
    expect(multiLine.changes[0]).toBe('line1\\nline2\\t\\r');
  });

  test('serializes into the exact format the changelog file uses', () => {
    const entry = buildChangelogEntry('1.8.19', 'Release Tooling', 'August 2026');
    const serialized = serializeChangelogEntry(entry, '\r\n');
    expect(serialized).toBe(
      '  {\r\n' +
        '    "version": "v1.8.19: Release Tooling",\r\n' +
        '    "date": "August 2026",\r\n' +
        '    "changes": [\r\n' +
        '      "Release Tooling"\r\n' +
        '    ]\r\n' +
        '  },'
    );
  });
});

describe('release script: JSON EOL preservation', () => {
  test('serializeJson emits the requested line ending everywhere', () => {
    const out = serializeJson({ version: '1.8.19' }, '\r\n');
    expect(out).toBe('{\r\n  "version": "1.8.19"\r\n}\r\n');
    expect(out.includes('\n')).toBe(true); // CRLF contains LF
    expect(out.split('\r\n').length).toBe(4); // 3 line breaks
    expect(out.endsWith('\r\n')).toBe(true);
  });

  test('serializeJson defaults to LF for LF files', () => {
    const out = serializeJson({ version: '1.8.19' }, '\n');
    expect(out).toBe('{\n  "version": "1.8.19"\n}\n');
    expect(out.includes('\r')).toBe(false);
  });
});

describe('release script: string escaping', () => {
  test('escapeJsString escapes quotes, backslashes, newlines and tabs', () => {
    expect(escapeJsString('a"b\\c')).toBe('a\\"b\\\\c');
    expect(escapeJsString('x\ny\tz')).toBe('x\\ny\\tz');
    expect(escapeJsString('plain')).toBe('plain');
  });
});
