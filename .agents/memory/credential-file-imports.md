---
name: Credential file imports
description: Prevent plaintext credentials supplied as uploaded config files from entering Git history.
---

Uploaded dotenv or backend configuration files containing credentials are
transient input only. Import their sensitive values through Replit Secrets and
ensure the uploaded file is excluded before staging any setup commit.

**Why:** Automated setup commits can include unrelated untracked attachments,
turning a convenient credential upload into a repository secret disclosure.

**How to apply:** Before committing after any credential-file upload, verify
that no attachment or dotenv file is tracked and that sensitive values exist
only in Replit Secrets. If one was staged, amend/purge it rather than adding a
later deletion commit.