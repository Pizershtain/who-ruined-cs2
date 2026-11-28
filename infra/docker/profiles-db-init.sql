\getenv profiles_password PROFILES_DATABASE_PASSWORD

-- Provision a dedicated runtime role and database on the existing local server.
-- Separate password and database prevent the runtime service from reading Core.
SELECT format('CREATE ROLE wrc_profiles LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'profiles_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wrc_profiles')
\gexec
SELECT format('CREATE DATABASE who_ruined_profiles OWNER wrc_profiles')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'who_ruined_profiles')
\gexec
REVOKE ALL ON DATABASE who_ruined_profiles FROM PUBLIC;
