# Harness compatibility

## Harness 0.2.2-alpha.2

Version `0.2.2-dsh.20261028.1` admits the Harness 0.2.2-alpha.2 and matching Cordis package cohort. Existing account authorization, data roots and plugin configuration are retained. Runtime acceptance is recorded separately from source and artifact checks.

The obsolete runtime invariant companion is removed with the Harness registry; the Host and client entries retain their behavior. The paired upgrade guide covers removing optional profile rows.

The native inventory retires only `./invariant`, matching the removed upstream registry and the paired upgrade guide. All other inventoried exports, tools, commands, routes, storage, and permission checks remain required.
