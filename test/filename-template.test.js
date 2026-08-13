const {
  sanitizeFilename,
  formatDate,
  formatTime,
  formatSizeMB,
  buildTemplateVars,
  renderFilenameTemplate
} = require('../main/filename-template');

describe('sanitizeFilename', () => {
  test('replaces Windows-illegal characters with underscores', () => {
    expect(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  test('strips trailing dots and spaces and trims', () => {
    expect(sanitizeFilename('  clip...  ')).toBe('clip');
  });

  test('collapses whitespace runs', () => {
    expect(sanitizeFilename('a   b\tc')).toBe('a b c');
  });
});

describe('formatDate / formatTime / formatSizeMB', () => {
  test('formats a fixed date as YYYY-MM-DD', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  test('formats a fixed time as HH-MM-SS', () => {
    expect(formatTime(new Date(2026, 0, 5, 9, 7, 3))).toBe('09-07-03');
  });

  test('renders sizes compactly', () => {
    expect(formatSizeMB(10)).toBe('10MB');
    expect(formatSizeMB(9.6)).toBe('9.6MB');
    expect(formatSizeMB(123.4)).toBe('123MB');
    expect(formatSizeMB(0)).toBe('');
    expect(formatSizeMB(NaN)).toBe('');
  });
});

describe('buildTemplateVars', () => {
  test('fills the standard token map', () => {
    const vars = buildTemplateVars({
      name: 'My Clip',
      codec: 'h264',
      res: '1920x1080',
      sizeMB: 9.6,
      date: new Date(2026, 0, 5)
    });
    expect(vars.name).toBe('My Clip');
    expect(vars.date).toBe('2026-01-05');
    expect(vars.codec).toBe('h264');
    expect(vars.res).toBe('1920x1080');
    expect(vars.size).toBe('9.6MB');
  });

  test('omits optional tokens that have no context', () => {
    const vars = buildTemplateVars({ name: 'x' });
    expect(vars.codec).toBeUndefined();
    expect(vars.size).toBeUndefined();
    expect(vars.name).toBe('x');
  });
});

describe('renderFilenameTemplate', () => {
  test('renders all tokens and sanitizes the result', () => {
    const vars = { name: 'a/b:c', date: '2026-01-05', codec: 'h264', res: '1280x720', size: '10MB' };
    expect(renderFilenameTemplate('{name} [{res}] {codec} {size} {date}', vars))
      .toBe('a_b_c [1280x720] h264 10MB 2026-01-05');
  });

  test('matches the default trim template output', () => {
    const out = renderFilenameTemplate('{name} - Trimmed', { name: 'myVideo' });
    expect(out).toBe('myVideo - Trimmed');
  });

  test('matches the default merge template output', () => {
    const out = renderFilenameTemplate('Merged Video - {date}', { date: '2026-01-05' });
    expect(out).toBe('Merged Video - 2026-01-05');
  });

  test('unknown tokens stay literal instead of crashing', () => {
    const out = renderFilenameTemplate('{name} {res}', { name: 'clip' });
    expect(out).toBe('clip {res}');
  });

  test('empty templates fall back to a safe default', () => {
    expect(renderFilenameTemplate('', {})).toBe('clip');
    expect(renderFilenameTemplate('   ', {})).toBe('clip');
    expect(renderFilenameTemplate(null, {})).toBe('clip');
  });
});
