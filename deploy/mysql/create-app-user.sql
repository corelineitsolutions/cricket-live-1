-- Run ONCE, manually, as a MySQL administrator on the EXISTING MySQL server:
--   sudo mysql < deploy/mysql/create-app-user.sql
-- Replace CHANGE_ME first. Nothing here drops or deletes data, and it is safe to re-run
-- (IF NOT EXISTS). Do not install a second MySQL server.

CREATE DATABASE IF NOT EXISTS `cricket_live`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- Application user, local connections only. Use the same password in DATABASE_URL
-- (URL-encode special characters).
CREATE USER IF NOT EXISTS 'cricket_live'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME';
CREATE USER IF NOT EXISTS 'cricket_live'@'localhost' IDENTIFIED BY 'CHANGE_ME';

-- Runtime + `prisma migrate deploy` (CREATE/ALTER/INDEX/REFERENCES are needed for migrations).
-- No global privileges, no GRANT OPTION, no access to other databases.
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON `cricket_live`.* TO 'cricket_live'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON `cricket_live`.* TO 'cricket_live'@'localhost';

FLUSH PRIVILEGES;

-- Verify (read-only):
--   SELECT @@global.time_zone, @@session.time_zone, @@character_set_server, @@collation_server;
--   SHOW GRANTS FOR 'cricket_live'@'127.0.0.1';
