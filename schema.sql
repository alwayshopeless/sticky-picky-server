CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token VARCHAR(64) NOT NULL,
  matrix_id TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS stickerpacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repository VARCHAR(200) NOT NULL,
    homeserver VARCHAR(200) NOT NULL,
    name VARCHAR(200) NOT NULL,
    internal_name VARCHAR(200) NOT NULL,
    type VARCHAR(50) NOT NULL,
    UNIQUE(repository, internal_name)
    );

CREATE TABLE IF NOT EXISTS user_stickerpacks (
  user_id INTEGER NOT NULL,
  stickerpack_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, stickerpack_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (stickerpack_id) REFERENCES stickerpacks(id) ON DELETE CASCADE
);