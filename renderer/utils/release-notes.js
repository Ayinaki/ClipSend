// Safe rendering of GitHub release notes in the update modal.
//
// electron-updater hands us the raw HTML that GitHub generates for a release
// body (the `<h2>What's Changed</h2> ...` block). Rendering it verbatim via
// innerHTML would execute anything a release author put in there, so instead
// we parse it and rebuild a whitelisted subset: plain structure, links, and
// inline emphasis only. Everything else (scripts, embeds, images, arbitrary
// attributes, event handlers) is dropped. The result is safe to assign to
// innerHTML and much prettier than dumping the markup as preformatted text.

// Structure/inline content we keep. Everything not listed is unwrapped (its
// children are kept) so no prose is lost.
const ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'div', 'span', 'br',
  'ul', 'ol', 'li',
  'strong', 'b', 'em', 'i',
  'a', 'code', 'tt', 'pre', 'blockquote',
  'details', 'summary',
]);

// Active content / embedded media whose whole subtree is discarded. We drop
// the element *and* its children: the contents of a script/style tag are not
// meant to be shown as prose.
const DROPPED_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template',
  'link', 'meta', 'title', 'base', 'form', 'input', 'button', 'select',
  'textarea', 'img', 'svg', 'video', 'audio', 'canvas', 'picture', 'source',
]);

// Links may only point at http(s) targets, so a `javascript:` or `data:`
// href can never become clickable inside the app window. mailto: is also
// excluded: the shell:openExternal handler in main only opens http(s), so a
// retained mailto: link would silently do nothing.
function safeHref(href) {
  if (!href) return null;
  const trimmed = String(href).trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function appendSanitized(parent, node) {
  if (node.nodeType === Node.TEXT_NODE) {
    parent.appendChild(document.createTextNode(node.nodeValue));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const tag = node.tagName.toLowerCase();
  if (DROPPED_TAGS.has(tag)) return;

  // Unknown tags collapse to their children; whitelisted tags are rebuilt
  // from scratch so no attributes survive except an <a> href.
  const el = ALLOWED_TAGS.has(tag) ? document.createElement(tag) : parent;
  if (el !== parent && tag === 'a') {
    const href = safeHref(node.getAttribute('href'));
    if (href) el.setAttribute('href', href);
  }

  for (const child of Array.from(node.childNodes)) {
    appendSanitized(el, child);
  }
  if (el !== parent) parent.appendChild(el);
}

/**
 * Convert GitHub release-notes HTML into a sanitized HTML string.
 * Plain text (no markup) is escaped and returned unchanged in meaning, so
 * callers can assign the result to innerHTML either way.
 * Returns '' for empty/non-string input.
 */
export function sanitizeReleaseNotes(html) {
  if (typeof html !== 'string') return '';
  const trimmed = html.trim();
  if (!trimmed) return '';

  // No tags at all: treat as prose. Escape it via textContent so special
  // characters can't sneak markup in.
  if (!/<[a-z][\s\S]*>/i.test(trimmed)) {
    const el = document.createElement('div');
    el.textContent = trimmed;
    return el.innerHTML;
  }

  const doc = new DOMParser().parseFromString(trimmed, 'text/html');
  const out = document.createElement('div');
  for (const node of Array.from(doc.body.childNodes)) {
    appendSanitized(out, node);
  }
  return out.innerHTML;
}
