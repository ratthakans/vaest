# VÆST — Supabase email templates

Branded, email-client-safe (table layout + inline CSS + system fonts + gradient
accent, night-prismatic CI) replacements for the default Supabase auth emails.

Paste into: Supabase → Authentication → Emails → Templates → (pick template) →
replace the HTML → set the Subject → Save.

| Supabase template | File                  | Subject line              | Fires on           |
|-------------------|-----------------------|---------------------------|--------------------|
| Confirm signup    | confirm-signup.html   | Confirm your VÆST email   | new registration   |
| Reset Password    | reset-password.html   | Reset your VÆST password  | forgot password    |
| Invite user       | invite.html           | You're invited to VÆST    | admin invite       |
| Magic Link        | magic-link.html       | Your VÆST sign-in link    | magic-link sign-in |

All use {{ .ConfirmationURL }} — do not change the URL structure; the app's
root→/app forwarder + detectRecovery handle it. Change Email / Reauthentication
can reuse confirm-signup.html.
