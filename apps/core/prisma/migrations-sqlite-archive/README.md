# Archived SQLite migration history

These migrations are the immutable history used by the retired SQLite runtime.
They are preserved for provenance and for understanding an existing owner
database during the explicit SQLite-to-PostgreSQL data migration.

They are **not** part of `prisma/migrations` and must never be executed by the
PostgreSQL migration runner. New installations use the PostgreSQL baseline in
`prisma/migrations/20261105000000_postgresql_initial`.
