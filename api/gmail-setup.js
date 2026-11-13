/**
 * /api/gmail-setup — retired.
 *
 * It used to mint Gmail tokens for any rep key without checking who was asking, and needed the
 * token pasted into Vercel. Mailboxes are now connected from inside the app by signed-in users:
 *   - your own Gmail:     Sign in with Google (api/auth/google.js)
 *   - your BDR mailbox:   Settings → My BDR (api/bdr.js)
 *   - company mailbox:    Settings → Email Status, admins (api/mailboxes.js)
 */
export default function handler(req, res) {
  res.setHeader('Location', '/settings');
  return res.status(302).end();
}
