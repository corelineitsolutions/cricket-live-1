-- CreateTable
CREATE TABLE `leagues` (
    `id` VARCHAR(191) NOT NULL,
    `sportmonks_id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(32) NULL,
    `image_url` VARCHAR(512) NULL,
    `country` VARCHAR(120) NULL,
    `type` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `leagues_sportmonks_id_key`(`sportmonks_id`),
    INDEX `leagues_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seasons` (
    `id` VARCHAR(191) NOT NULL,
    `sportmonks_id` INTEGER NOT NULL,
    `league_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `start_date` DATETIME(3) NULL,
    `end_date` DATETIME(3) NULL,
    `is_current` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `seasons_sportmonks_id_key`(`sportmonks_id`),
    INDEX `seasons_league_id_idx`(`league_id`),
    INDEX `seasons_is_current_idx`(`is_current`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teams` (
    `id` VARCHAR(191) NOT NULL,
    `sportmonks_id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `short_name` VARCHAR(32) NULL,
    `image_url` VARCHAR(512) NULL,
    `country` VARCHAR(120) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `teams_sportmonks_id_key`(`sportmonks_id`),
    INDEX `teams_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `players` (
    `id` VARCHAR(191) NOT NULL,
    `sportmonks_id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `image_url` VARCHAR(512) NULL,
    `country` VARCHAR(120) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `players_sportmonks_id_key`(`sportmonks_id`),
    INDEX `players_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `matches` (
    `id` VARCHAR(191) NOT NULL,
    `sportmonks_id` INTEGER NOT NULL,
    `league_id` VARCHAR(191) NOT NULL,
    `season_id` VARCHAR(191) NOT NULL,
    `local_team_id` VARCHAR(191) NOT NULL,
    `visitor_team_id` VARCHAR(191) NOT NULL,
    `winner_team_id` VARCHAR(191) NULL,
    `venue_name` VARCHAR(191) NULL,
    `venue_city` VARCHAR(120) NULL,
    `status` ENUM('SCHEDULED', 'LIVE', 'COMPLETED', 'ABANDONED', 'CANCELLED', 'POSTPONED', 'INTERRUPTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `status_detail` VARCHAR(120) NULL,
    `match_type` VARCHAR(32) NULL,
    `round` VARCHAR(64) NULL,
    `start_time` DATETIME(3) NOT NULL,
    `result_summary` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `matches_sportmonks_id_key`(`sportmonks_id`),
    INDEX `matches_status_start_time_idx`(`status`, `start_time`),
    INDEX `matches_league_id_start_time_idx`(`league_id`, `start_time`),
    INDEX `matches_season_id_idx`(`season_id`),
    INDEX `matches_local_team_id_idx`(`local_team_id`),
    INDEX `matches_visitor_team_id_idx`(`visitor_team_id`),
    INDEX `matches_winner_team_id_idx`(`winner_team_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fcm_devices` (
    `id` VARCHAR(191) NOT NULL,
    `device_id` VARCHAR(128) NOT NULL,
    `fcm_token` VARCHAR(512) NOT NULL,
    `platform` ENUM('ANDROID', 'IOS') NOT NULL,
    `app_version` VARCHAR(32) NULL,
    `last_seen_at` DATETIME(3) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `fcm_devices_device_id_key`(`device_id`),
    INDEX `fcm_devices_fcm_token_idx`(`fcm_token`),
    INDEX `fcm_devices_is_active_idx`(`is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ads` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `image_url` VARCHAR(512) NOT NULL,
    `click_url` VARCHAR(512) NOT NULL,
    `placement` ENUM('HOME_BANNER', 'MATCH_LIST', 'MATCH_DETAIL', 'SPLASH', 'INTERSTITIAL') NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT false,
    `start_at` DATETIME(3) NULL,
    `end_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ads_placement_is_active_priority_idx`(`placement`, `is_active`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admins` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admins_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `seasons` ADD CONSTRAINT `seasons_league_id_fkey` FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matches` ADD CONSTRAINT `matches_league_id_fkey` FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matches` ADD CONSTRAINT `matches_season_id_fkey` FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matches` ADD CONSTRAINT `matches_local_team_id_fkey` FOREIGN KEY (`local_team_id`) REFERENCES `teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matches` ADD CONSTRAINT `matches_visitor_team_id_fkey` FOREIGN KEY (`visitor_team_id`) REFERENCES `teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matches` ADD CONSTRAINT `matches_winner_team_id_fkey` FOREIGN KEY (`winner_team_id`) REFERENCES `teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
