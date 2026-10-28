---
kind: upgrade-guide
description: The obsolete @yejiming/dsh-data-agent/invariant entry point is removed with the Harness invariant registry.
---

# Remove the invariant companion

## Change

Harness has removed the runtime invariant registry. The optional `@yejiming/dsh-data-agent/invariant` entry point and its SDK dependency are removed; normal Host and client entries keep their registration and disposal behavior.

## Migration

1. Remove any `@yejiming/dsh-data-agent/invariant` row from `cordis.yml` and profile patches, and delete imports of that subpath.
2. Load the normal `@yejiming/dsh-data-agent` bundle and confirm the Data Agent connection panel opens and lists the existing connections. Existing connection settings and workspace files require no migration.
