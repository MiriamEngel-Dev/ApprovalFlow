-- One shared PostgreSQL instance, one logical database per service (ADR-009).
-- Runs once, only when the data volume is freshly initialized.
CREATE DATABASE submission_db;
CREATE DATABASE decision_db;
CREATE DATABASE payment_db;
CREATE DATABASE audit_db;
