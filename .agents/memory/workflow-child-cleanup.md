---
name: Workflow child cleanup
description: A workflow removal can leave supervised child process groups alive and holding service ports.
---

After removing or replacing a multi-process workflow, verify that its backend and supporting-service ports are no longer listening before starting the replacement.

**Why:** Removing the workflow configuration did not terminate every child process group, so an orphaned backend kept port 3000 occupied and caused repeated startup failures.

**How to apply:** When replacing a supervised workflow, inspect expected listener ports after stopping the old workflow. Terminate only confirmed stale project processes before starting the new workflow.