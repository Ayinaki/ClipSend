/**
 * @jest-environment jsdom
 *
 * Unit tests for the release-notes sanitizer used by the update modal.
 * The renderer source is ES module syntax; the Jest transform in package.json
 * converts it to CommonJS for this suite.
 */
const { sanitizeReleaseNotes } = require('../../renderer/utils/release-notes.js');

describe('sanitizeReleaseNotes', () => {
  test('renders GitHub changelog structure without raw attributes', () => {
    const notes = `<h2>What's Changed</h2>
<ul>
<li>Update a preset by <a class="user-mention notranslate" data-hovercard-url="/users/Ayinaki/hovercard" href="https://github.com/Ayinaki">@Ayinaki</a> in <a href="https://github.com/Ayinaki/ClipSend/pull/3">#3</a></li>
</ul>
<p><strong>Full Changelog</strong>: <a class="commit-link" href="https://github.com/Ayinaki/ClipSend/compare/v2.2.0...v2.2.1"><tt>v2.2.0...v2.2.1</tt></a></p>`;

    const html = sanitizeReleaseNotes(notes);

    // Structure is preserved and rendered.
    expect(html).toContain('<h2>');
    expect(html).toContain("<li>Update a preset by ");
    // The mention link keeps its href but sheds all GitHub hovercard attrs.
    expect(html).toContain('<a href="https://github.com/Ayinaki">@Ayinaki</a>');
    expect(html).not.toContain('user-mention');
    expect(html).not.toContain('data-hovercard');
    expect(html).not.toContain('onclick');
  });

  test('drops active content subtrees entirely', () => {
    const html = sanitizeReleaseNotes('<p>before</p><script>alert(1)</script><style>body{}</style><p>after</p>');
    expect(html).not.toContain('script');
    expect(html).not.toContain('alert');
    expect(html).not.toContain('style');
    expect(html).toContain('before');
    expect(html).toContain('after');
  });

  test('unwraps unknown tags but keeps their prose', () => {
    const html = sanitizeReleaseNotes('<section>hello <em>world</em></section>');
    expect(html).not.toContain('section');
    expect(html).toContain('hello');
    expect(html).toContain('<em>world</em>');
  });

  test('strips non-http(s) hrefs so unsafe links are inert', () => {
    const html = sanitizeReleaseNotes('<a href="javascript:alert(1)">x</a><a href="data:text/html,hi">y</a><a href="mailto:hi@example.com">z</a><a href="https://ok.example">ok</a>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:');
    expect(html).not.toContain('mailto:');
    expect(html).toContain('<a href="https://ok.example">ok</a>');
  });

  test('escapes plain text so it can be assigned to innerHTML', () => {
    const html = sanitizeReleaseNotes('plain < notes & more');
    expect(html).toContain('plain &lt; notes &amp; more');
  });

  test('returns empty string for empty or non-string input', () => {
    expect(sanitizeReleaseNotes('')).toBe('');
    expect(sanitizeReleaseNotes('   ')).toBe('');
    expect(sanitizeReleaseNotes(null)).toBe('');
    expect(sanitizeReleaseNotes(undefined)).toBe('');
    expect(sanitizeReleaseNotes(42)).toBe('');
  });
});
