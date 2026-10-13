-- CreateTable
CREATE TABLE `identity_player_map` (
    `id` VARCHAR(191) NOT NULL,
    `latiyal_player_id` INTEGER NOT NULL,
    `hist_person_id` CHAR(8) NOT NULL,
    `status` ENUM('PROPOSED', 'CONFIRMED', 'REJECTED') NOT NULL DEFAULT 'PROPOSED',
    `method` VARCHAR(32) NOT NULL,
    `confidence` TINYINT UNSIGNED NOT NULL,
    `evidence` JSON NULL,
    `reviewed_by` VARCHAR(64) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `identity_player_map_hist_person_id_idx`(`hist_person_id`),
    INDEX `identity_player_map_status_confidence_idx`(`status`, `confidence`),
    UNIQUE INDEX `identity_player_map_latiyal_player_id_hist_person_id_key`(`latiyal_player_id`, `hist_person_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `identity_team_map` (
    `id` VARCHAR(191) NOT NULL,
    `latiyal_team_id` INTEGER NOT NULL,
    `hist_team_id` INTEGER NOT NULL,
    `gender` VARCHAR(16) NOT NULL,
    `status` ENUM('PROPOSED', 'CONFIRMED', 'REJECTED') NOT NULL DEFAULT 'PROPOSED',
    `method` VARCHAR(32) NOT NULL,
    `confidence` TINYINT UNSIGNED NOT NULL,
    `evidence` JSON NULL,
    `reviewed_by` VARCHAR(64) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `identity_team_map_hist_team_id_idx`(`hist_team_id`),
    INDEX `identity_team_map_status_confidence_idx`(`status`, `confidence`),
    UNIQUE INDEX `identity_team_map_latiyal_team_id_hist_team_id_gender_key`(`latiyal_team_id`, `hist_team_id`, `gender`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `identity_venue_map` (
    `id` VARCHAR(191) NOT NULL,
    `live_venue_key` VARCHAR(191) NOT NULL,
    `live_venue_name` VARCHAR(191) NOT NULL,
    `live_venue_city` VARCHAR(120) NULL,
    `hist_venue_id` INTEGER NOT NULL,
    `status` ENUM('PROPOSED', 'CONFIRMED', 'REJECTED') NOT NULL DEFAULT 'PROPOSED',
    `method` VARCHAR(32) NOT NULL,
    `confidence` TINYINT UNSIGNED NOT NULL,
    `evidence` JSON NULL,
    `reviewed_by` VARCHAR(64) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `identity_venue_map_hist_venue_id_idx`(`hist_venue_id`),
    INDEX `identity_venue_map_status_confidence_idx`(`status`, `confidence`),
    UNIQUE INDEX `identity_venue_map_live_venue_key_hist_venue_id_key`(`live_venue_key`, `hist_venue_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
