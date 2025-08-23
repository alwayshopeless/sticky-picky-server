CREATE TABLE IF NOT EXISTS users
(
    id        INT PRIMARY KEY AUTO_INCREMENT,
    token     VARCHAR(64)  NOT NULL,
    matrix_id VARCHAR(200) NOT NULL UNIQUE,
    favorites JSON DEFAULT '[]',
    recent    JSON DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS stickerpacks
(
    id            INT PRIMARY KEY AUTO_INCREMENT,
    repository    VARCHAR(200) NOT NULL,
    homeserver    VARCHAR(200) NOT NULL,
    name          VARCHAR(200) NOT NULL,
    internal_name VARCHAR(200) NOT NULL,
    type          VARCHAR(50)  NOT NULL,
    UNIQUE KEY unique_repo_internal_name (repository, internal_name)
);

CREATE TABLE IF NOT EXISTS user_stickerpacks
(
    user_id        INT NOT NULL,
    stickerpack_id INT NOT NULL,
    PRIMARY KEY (user_id, stickerpack_id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (stickerpack_id) REFERENCES stickerpacks (id) ON DELETE CASCADE
);