// Lightweight formatting for the welcome email template.
// The template is stored as plain text with markers — **bold**, *italic*,
// __underline__ — which render to HTML at send time (and in the editor
// preview). Recipients with plain-text mail clients get the marker-stripped
// text fallback.

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Marker text → email-safe HTML (escapes everything else).
export function welcomeBodyToHtml(text) {
  let h = escapeHtml(text)
  h = h.replace(/\*\*([^*\n][^*]*?)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/__([^_\n][^_]*?)__/g, '<u>$1</u>')
  h = h.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
  h = h.replace(/\n/g, '<br/>')
  return `<div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:14px;color:#111;line-height:1.6;">${h}</div>`
}

// Marker text → clean plain text (the email's text/plain fallback).
export function stripFormatMarkers(text) {
  return String(text ?? '')
    .replace(/\*\*([^*\n][^*]*?)\*\*/g, '$1')
    .replace(/__([^_\n][^_]*?)__/g, '$1')
    .replace(/\*([^*\n]+?)\*/g, '$1')
}
