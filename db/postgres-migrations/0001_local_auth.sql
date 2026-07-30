CREATE TABLE IF NOT EXISTS user_credentials (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  password_iterations integer NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until bigint,
  password_changed_at bigint NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS user_credentials_locked_until_idx
  ON user_credentials (locked_until);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at bigint NOT NULL,
  last_seen_at bigint NOT NULL,
  created_at bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_hash_unique
  ON auth_sessions (token_hash);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx
  ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx
  ON auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS auth_invitations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at bigint NOT NULL,
  accepted_at bigint,
  created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_invitations_token_hash_unique
  ON auth_invitations (token_hash);
CREATE INDEX IF NOT EXISTS auth_invitations_user_id_idx
  ON auth_invitations (user_id);
CREATE INDEX IF NOT EXISTS auth_invitations_expires_at_idx
  ON auth_invitations (expires_at);
