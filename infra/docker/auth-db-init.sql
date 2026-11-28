\getenv auth_password AUTH_DB_PASSWORD
SELECT 'CREATE ROLE wrc_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrc_auth') \gexec
ALTER ROLE wrc_auth PASSWORD :'auth_password';
SELECT 'CREATE DATABASE who_ruined_auth OWNER wrc_auth'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'who_ruined_auth') \gexec
REVOKE CONNECT ON DATABASE postgres, template1, who_ruined_auth FROM PUBLIC;
GRANT CONNECT ON DATABASE who_ruined_auth TO wrc_auth;
ALTER ROLE wrc_auth IN DATABASE who_ruined_auth SET statement_timeout = '5s';
ALTER ROLE wrc_auth IN DATABASE who_ruined_auth SET lock_timeout = '4s';
