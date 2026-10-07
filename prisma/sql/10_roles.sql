-- Rol de la aplicación. Debe correr ANTES de 20_reglas.sql (que hace REVOKE/GRANT sobre app_user).
-- Los roles son del CLÚSTER, no de la base: por eso es idempotente (la base sombra de `migrate dev` repite la migración).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN CREATE ROLE app_user NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
-- Después de crear el rol: ALTER ROLE app_user LOGIN PASSWORD '...' (fuera de la migración; la contraseña no se versiona).
