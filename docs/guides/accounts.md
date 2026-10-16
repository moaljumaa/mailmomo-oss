# Connecting email accounts

Mailmomo speaks plain **IMAP** (read/sync) and **SMTP** (send), so any provider that offers both works — there is no
per-provider integration and no OAuth. Add as many accounts as you like; they appear in a unified inbox or per account.

| Provider | IMAP | SMTP | Notes |
|---|---|---|---|
| Gmail / Google Workspace | `imap.gmail.com:993` SSL | `smtp.gmail.com:587` STARTTLS | 2FA + an [app password](https://myaccount.google.com/apppasswords) |
| Microsoft 365 / Outlook.com | `outlook.office365.com:993` SSL | `smtp.office365.com:587` STARTTLS | Basic auth must be enabled for the mailbox/tenant |
| iCloud | `imap.mail.me.com:993` SSL | `smtp.mail.me.com:587` STARTTLS | App-specific password |
| Fastmail | `imap.fastmail.com:993` SSL | `smtp.fastmail.com:465` SSL | App password |
| Yahoo | `imap.mail.yahoo.com:993` SSL | `smtp.mail.yahoo.com:465` SSL | App password |
| Zoho | `imap.zoho.com:993` SSL | `smtp.zoho.com:465` SSL | |
| Proton | `127.0.0.1:1143` | `127.0.0.1:1025` | Via Proton Mail Bridge |
| AWS SES (send only) | — | `email-smtp.<region>.amazonaws.com:587` | Use *SMTP credentials*, not IAM keys; pair with an IMAP mailbox |
| Dovecot / Mailcow / Mailu / any host | your server | your server | |

Use **Test connection** in the add-account form; it reports exactly which step fails. Self-signed certificates can be allowed
per account. Passwords are encrypted at rest with `MASTER_KEY` and never sent to the browser.

> Provider hostnames change; check your provider's docs if a connection fails.
