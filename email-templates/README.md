# VÆST — email templates

Branded, email-client-safe (table layout + inline CSS + system fonts + gradient
accent, night-prismatic CI) replacements for the default Supabase auth emails,
plus a standalone welcome email.

## Supabase auth templates (paste into Authentication → Emails → Templates)

| Supabase template   | File                  | Subject line                    | Fires on            |
|---------------------|-----------------------|---------------------------------|---------------------|
| Confirm signup      | confirm-signup.html   | Confirm your VÆST email         | new registration    |
| Reset Password      | reset-password.html   | Reset your VÆST password        | forgot password     |
| Invite user         | invite.html           | You're invited to VÆST          | admin invite        |
| Magic Link          | magic-link.html       | Your VÆST sign-in link          | magic-link sign-in  |

All use {{ .ConfirmationURL }} — do not change the URL structure; the app's
root→/app forwarder + detectRecovery handle it. Change Email / Reauthentication
can reuse confirm-signup.html.

## Standalone

| File          | What it is                                            | How to send                                   |
|---------------|-------------------------------------------------------|-----------------------------------------------|
| welcome.html  | "Thank you for joining" — static button → /app        | Manually via Resend, or a Supabase Auth Hook on user-confirmed |

Note: Supabase has no native "welcome after confirmation" email. To send it
automatically, wire a Send-Email Auth Hook / Database Webhook to POST to Resend
when a user confirms. Ask if you want this set up.
