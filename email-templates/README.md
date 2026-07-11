# VÆST — Supabase email templates

Branded, email-client-safe (table layout + inline CSS + system fonts + gradient
accent) replacements for the default Supabase auth emails. Night-prismatic CI.

Paste into: Supabase → Authentication → Emails → Templates → (pick template) →
"Source" / HTML editor → replace all → Save. Set the Subject as below.

| Supabase template   | File                          | Subject line                    |
|---------------------|-------------------------------|---------------------------------|
| Reset Password      | reset-password.html           | Reset your VÆST password        |
| Confirm signup      | confirm-signup.html           | Confirm your VÆST email         |
| Invite user         | invite.html                   | You're invited to VÆST          |
| Magic Link          | magic-link.html               | Your VÆST sign-in link          |

All use {{ .ConfirmationURL }} (the link Supabase builds) — do not change the
URL structure; the app's root→/app forwarder + detectRecovery handle it.
Change Email / Reauthentication can reuse confirm-signup.html if desired.
