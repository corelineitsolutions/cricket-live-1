-- CreateTable
CREATE TABLE `hist_import_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `status` ENUM('RUNNING', 'COMPLETED', 'FAILED', 'ROLLED_BACK') NOT NULL DEFAULT 'RUNNING',
    `source_label` VARCHAR(191) NOT NULL,
    `options` JSON NOT NULL,
    `parser_version` INTEGER NOT NULL,
    `files_seen` INTEGER NOT NULL DEFAULT 0,
    `files_imported` INTEGER NOT NULL DEFAULT 0,
    `files_replaced` INTEGER NOT NULL DEFAULT 0,
    `files_skipped` INTEGER NOT NULL DEFAULT 0,
    `files_quarantined` INTEGER NOT NULL DEFAULT 0,
    `files_failed` INTEGER NOT NULL DEFAULT 0,
    `deliveries_imported` INTEGER NOT NULL DEFAULT 0,
    `warnings_count` INTEGER NOT NULL DEFAULT 0,
    `error_summary` VARCHAR(1000) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    `rolled_back_at` DATETIME(3) NULL,

    INDEX `hist_import_runs_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_import_files` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `run_id` INTEGER NOT NULL,
    `file_name` VARCHAR(128) NOT NULL,
    `cricsheet_match_id` VARCHAR(32) NULL,
    `sha256` CHAR(64) NULL,
    `size_bytes` INTEGER NOT NULL,
    `parser_version` INTEGER NOT NULL,
    `status` ENUM('IMPORTED', 'REPLACED', 'SKIPPED_UNCHANGED', 'SKIPPED_CHANGED', 'QUARANTINED', 'FAILED') NOT NULL,
    `deliveries` INTEGER NOT NULL DEFAULT 0,
    `warnings_count` INTEGER NOT NULL DEFAULT 0,
    `warning_codes` VARCHAR(500) NULL,
    `error_summary` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hist_import_files_cricsheet_match_id_idx`(`cricsheet_match_id`),
    INDEX `hist_import_files_status_idx`(`status`),
    UNIQUE INDEX `hist_import_files_run_id_file_name_key`(`run_id`, `file_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_people` (
    `id` CHAR(8) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hist_people_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_person_names` (
    `person_id` CHAR(8) NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    INDEX `hist_person_names_name_idx`(`name`),
    PRIMARY KEY (`person_id`, `name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_teams` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `team_type` VARCHAR(16) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `hist_teams_name_team_type_key`(`name`, `team_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_venues` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `normalized_key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `city` VARCHAR(120) NULL,
    `cricsheet_venue_id` CHAR(8) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `hist_venues_normalized_key_key`(`normalized_key`),
    INDEX `hist_venues_cricsheet_venue_id_idx`(`cricsheet_venue_id`),
    INDEX `hist_venues_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_matches` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cricsheet_match_id` VARCHAR(32) NOT NULL,
    `source_sha256` CHAR(64) NOT NULL,
    `format_version` VARCHAR(16) NOT NULL,
    `parser_version` INTEGER NOT NULL,
    `import_run_id` INTEGER NOT NULL,
    `match_type` VARCHAR(8) NOT NULL,
    `gender` VARCHAR(16) NOT NULL,
    `team_type` VARCHAR(16) NOT NULL,
    `season` VARCHAR(16) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `dates` JSON NOT NULL,
    `event_name` VARCHAR(191) NULL,
    `match_number` VARCHAR(32) NULL,
    `match_type_number` INTEGER NULL,
    `venue_id` INTEGER NOT NULL,
    `team1_id` INTEGER NOT NULL,
    `team2_id` INTEGER NOT NULL,
    `toss_winner_id` INTEGER NULL,
    `toss_decision` VARCHAR(8) NULL,
    `toss_uncontested` BOOLEAN NOT NULL DEFAULT false,
    `outcome` ENUM('WIN', 'TIE', 'DRAW', 'NO_RESULT', 'UNKNOWN') NOT NULL,
    `winner_id` INTEGER NULL,
    `win_by_runs` SMALLINT UNSIGNED NULL,
    `win_by_wickets` TINYINT UNSIGNED NULL,
    `win_by_innings` BOOLEAN NOT NULL DEFAULT false,
    `method` VARCHAR(32) NULL,
    `eliminator_team` VARCHAR(191) NULL,
    `bowl_out_team` VARCHAR(191) NULL,
    `overs_limit` SMALLINT UNSIGNED NULL,
    `balls_per_over` TINYINT UNSIGNED NOT NULL,
    `neutral_venue` BOOLEAN NOT NULL DEFAULT false,
    `has_super_over` BOOLEAN NOT NULL DEFAULT false,
    `deliveries_count` INTEGER NOT NULL DEFAULT 0,
    `officials` JSON NULL,
    `extra_info` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `hist_matches_cricsheet_match_id_key`(`cricsheet_match_id`),
    INDEX `hist_matches_match_type_gender_start_date_idx`(`match_type`, `gender`, `start_date`),
    INDEX `hist_matches_venue_id_idx`(`venue_id`),
    INDEX `hist_matches_team1_id_idx`(`team1_id`),
    INDEX `hist_matches_team2_id_idx`(`team2_id`),
    INDEX `hist_matches_winner_id_idx`(`winner_id`),
    INDEX `hist_matches_toss_winner_id_idx`(`toss_winner_id`),
    INDEX `hist_matches_import_run_id_idx`(`import_run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_match_players` (
    `match_id` INTEGER NOT NULL,
    `person_id` CHAR(8) NOT NULL,
    `team_id` INTEGER NOT NULL,
    `is_player_of_match` BOOLEAN NOT NULL DEFAULT false,

    INDEX `hist_match_players_person_id_idx`(`person_id`),
    INDEX `hist_match_players_team_id_idx`(`team_id`),
    PRIMARY KEY (`match_id`, `person_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_innings` (
    `match_id` INTEGER NOT NULL,
    `innings_no` TINYINT UNSIGNED NOT NULL,
    `batting_team_id` INTEGER NULL,
    `bowling_team_id` INTEGER NULL,
    `is_super_over` BOOLEAN NOT NULL DEFAULT false,
    `declared` BOOLEAN NOT NULL DEFAULT false,
    `forfeited` BOOLEAN NOT NULL DEFAULT false,
    `runs` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `wickets` TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `legal_balls` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `deliveries` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `extras` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `wides` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `noballs` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `byes` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `legbyes` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `penalty_in_deliveries` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `penalty_pre` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `penalty_post` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `target_runs` SMALLINT UNSIGNED NULL,
    `target_overs` VARCHAR(8) NULL,

    INDEX `hist_innings_batting_team_id_idx`(`batting_team_id`),
    INDEX `hist_innings_bowling_team_id_idx`(`bowling_team_id`),
    PRIMARY KEY (`match_id`, `innings_no`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_deliveries` (
    `match_id` INTEGER NOT NULL,
    `innings_no` TINYINT UNSIGNED NOT NULL,
    `seq` SMALLINT UNSIGNED NOT NULL,
    `over_no` SMALLINT UNSIGNED NOT NULL,
    `ball_no` TINYINT UNSIGNED NOT NULL,
    `legal_over_no` SMALLINT UNSIGNED NOT NULL,
    `legal_ball_no` TINYINT UNSIGNED NOT NULL,
    `batter_id` CHAR(8) NOT NULL,
    `non_striker_id` CHAR(8) NOT NULL,
    `bowler_id` CHAR(8) NOT NULL,
    `runs_batter` TINYINT UNSIGNED NOT NULL,
    `extras` TINYINT UNSIGNED NOT NULL,
    `wides` TINYINT UNSIGNED NOT NULL,
    `noballs` TINYINT UNSIGNED NOT NULL,
    `byes` TINYINT UNSIGNED NOT NULL,
    `legbyes` TINYINT UNSIGNED NOT NULL,
    `penalty` TINYINT UNSIGNED NOT NULL,
    `total_runs` TINYINT UNSIGNED NOT NULL,
    `is_legal` BOOLEAN NOT NULL,
    `non_boundary` BOOLEAN NOT NULL DEFAULT false,
    `team_wickets` TINYINT UNSIGNED NOT NULL DEFAULT 0,

    INDEX `hist_deliveries_batter_id_match_id_idx`(`batter_id`, `match_id`),
    INDEX `hist_deliveries_bowler_id_match_id_idx`(`bowler_id`, `match_id`),
    PRIMARY KEY (`match_id`, `innings_no`, `seq`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_wickets` (
    `match_id` INTEGER NOT NULL,
    `innings_no` TINYINT UNSIGNED NOT NULL,
    `seq` SMALLINT UNSIGNED NOT NULL,
    `ordinal` TINYINT UNSIGNED NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `player_out_id` CHAR(8) NULL,
    `player_out_name` VARCHAR(191) NULL,
    `bowler_id` CHAR(8) NOT NULL,
    `credited_to_bowler` BOOLEAN NOT NULL,
    `counts_as_team_wicket` BOOLEAN NOT NULL,
    `fielder1_id` CHAR(8) NULL,
    `fielder2_id` CHAR(8) NULL,
    `fielder3_id` CHAR(8) NULL,
    `fielder4_id` CHAR(8) NULL,
    `unresolved_fielders` VARCHAR(500) NULL,

    INDEX `hist_wickets_player_out_id_idx`(`player_out_id`),
    INDEX `hist_wickets_bowler_id_idx`(`bowler_id`),
    INDEX `hist_wickets_fielder1_id_idx`(`fielder1_id`),
    PRIMARY KEY (`match_id`, `innings_no`, `seq`, `ordinal`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_agg_player_batting` (
    `person_id` CHAR(8) NOT NULL,
    `match_type` VARCHAR(8) NOT NULL,
    `gender` VARCHAR(16) NOT NULL,
    `team_type` VARCHAR(16) NOT NULL,
    `matches` INTEGER NOT NULL DEFAULT 0,
    `innings` INTEGER NOT NULL DEFAULT 0,
    `not_outs` INTEGER NOT NULL DEFAULT 0,
    `runs` INTEGER NOT NULL DEFAULT 0,
    `balls_faced` INTEGER NOT NULL DEFAULT 0,
    `fours` INTEGER NOT NULL DEFAULT 0,
    `sixes` INTEGER NOT NULL DEFAULT 0,
    `highest` INTEGER NOT NULL DEFAULT 0,
    `highest_not_out` BOOLEAN NOT NULL DEFAULT false,
    `fifties` INTEGER NOT NULL DEFAULT 0,
    `hundreds` INTEGER NOT NULL DEFAULT 0,
    `ducks` INTEGER NOT NULL DEFAULT 0,
    `first_match_date` DATE NULL,
    `last_match_date` DATE NULL,

    INDEX `hist_agg_player_batting_match_type_gender_runs_idx`(`match_type`, `gender`, `runs`),
    PRIMARY KEY (`person_id`, `match_type`, `gender`, `team_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_agg_player_bowling` (
    `person_id` CHAR(8) NOT NULL,
    `match_type` VARCHAR(8) NOT NULL,
    `gender` VARCHAR(16) NOT NULL,
    `team_type` VARCHAR(16) NOT NULL,
    `innings` INTEGER NOT NULL DEFAULT 0,
    `legal_balls` INTEGER NOT NULL DEFAULT 0,
    `runs_conceded` INTEGER NOT NULL DEFAULT 0,
    `wickets` INTEGER NOT NULL DEFAULT 0,
    `dots` INTEGER NOT NULL DEFAULT 0,
    `fours_conceded` INTEGER NOT NULL DEFAULT 0,
    `sixes_conceded` INTEGER NOT NULL DEFAULT 0,
    `wides` INTEGER NOT NULL DEFAULT 0,
    `noballs` INTEGER NOT NULL DEFAULT 0,
    `best_wickets` INTEGER NOT NULL DEFAULT 0,
    `best_runs` INTEGER NOT NULL DEFAULT 0,
    `four_wickets` INTEGER NOT NULL DEFAULT 0,
    `five_wickets` INTEGER NOT NULL DEFAULT 0,

    INDEX `hist_agg_player_bowling_match_type_gender_wickets_idx`(`match_type`, `gender`, `wickets`),
    PRIMARY KEY (`person_id`, `match_type`, `gender`, `team_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_agg_venue` (
    `venue_id` INTEGER NOT NULL,
    `match_type` VARCHAR(8) NOT NULL,
    `gender` VARCHAR(16) NOT NULL,
    `matches` INTEGER NOT NULL DEFAULT 0,
    `result_matches` INTEGER NOT NULL DEFAULT 0,
    `bat_first_wins` INTEGER NOT NULL DEFAULT 0,
    `chasing_wins` INTEGER NOT NULL DEFAULT 0,
    `ties` INTEGER NOT NULL DEFAULT 0,
    `draws` INTEGER NOT NULL DEFAULT 0,
    `no_results` INTEGER NOT NULL DEFAULT 0,
    `first_innings_count` INTEGER NOT NULL DEFAULT 0,
    `first_innings_runs` INTEGER NOT NULL DEFAULT 0,
    `highest_total` INTEGER NOT NULL DEFAULT 0,
    `lowest_all_out_total` INTEGER NULL,
    `toss_winner_wins` INTEGER NOT NULL DEFAULT 0,
    `last_match_date` DATE NULL,

    PRIMARY KEY (`venue_id`, `match_type`, `gender`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_agg_player_venue` (
    `person_id` CHAR(8) NOT NULL,
    `venue_id` INTEGER NOT NULL,
    `match_type` VARCHAR(8) NOT NULL,
    `gender` VARCHAR(16) NOT NULL,
    `batting_innings` INTEGER NOT NULL DEFAULT 0,
    `runs` INTEGER NOT NULL DEFAULT 0,
    `balls_faced` INTEGER NOT NULL DEFAULT 0,
    `dismissals` INTEGER NOT NULL DEFAULT 0,
    `highest` INTEGER NOT NULL DEFAULT 0,
    `bowling_innings` INTEGER NOT NULL DEFAULT 0,
    `legal_balls` INTEGER NOT NULL DEFAULT 0,
    `runs_conceded` INTEGER NOT NULL DEFAULT 0,
    `wickets` INTEGER NOT NULL DEFAULT 0,

    INDEX `hist_agg_player_venue_venue_id_match_type_gender_idx`(`venue_id`, `match_type`, `gender`),
    PRIMARY KEY (`person_id`, `venue_id`, `match_type`, `gender`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_agg_head_to_head` (
    `team1_id` INTEGER NOT NULL,
    `team2_id` INTEGER NOT NULL,
    `match_type` VARCHAR(8) NOT NULL,
    `gender` VARCHAR(16) NOT NULL,
    `matches` INTEGER NOT NULL DEFAULT 0,
    `team1_wins` INTEGER NOT NULL DEFAULT 0,
    `team2_wins` INTEGER NOT NULL DEFAULT 0,
    `ties` INTEGER NOT NULL DEFAULT 0,
    `draws` INTEGER NOT NULL DEFAULT 0,
    `no_results` INTEGER NOT NULL DEFAULT 0,
    `last_match_date` DATE NULL,

    INDEX `hist_agg_head_to_head_team2_id_idx`(`team2_id`),
    PRIMARY KEY (`team1_id`, `team2_id`, `match_type`, `gender`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_agg_team_phase` (
    `team_id` INTEGER NOT NULL,
    `match_type` VARCHAR(8) NOT NULL,
    `gender` VARCHAR(16) NOT NULL,
    `phase` VARCHAR(16) NOT NULL,
    `innings` INTEGER NOT NULL DEFAULT 0,
    `runs` INTEGER NOT NULL DEFAULT 0,
    `legal_balls` INTEGER NOT NULL DEFAULT 0,
    `wickets` INTEGER NOT NULL DEFAULT 0,
    `fours` INTEGER NOT NULL DEFAULT 0,
    `sixes` INTEGER NOT NULL DEFAULT 0,
    `dots` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`team_id`, `match_type`, `gender`, `phase`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hist_agg_builds` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `status` VARCHAR(16) NOT NULL,
    `row_counts` JSON NULL,
    `error` VARCHAR(1000) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `hist_import_files` ADD CONSTRAINT `hist_import_files_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `hist_import_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hist_person_names` ADD CONSTRAINT `hist_person_names_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `hist_people`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hist_matches` ADD CONSTRAINT `hist_matches_import_run_id_fkey` FOREIGN KEY (`import_run_id`) REFERENCES `hist_import_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hist_matches` ADD CONSTRAINT `hist_matches_venue_id_fkey` FOREIGN KEY (`venue_id`) REFERENCES `hist_venues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hist_matches` ADD CONSTRAINT `hist_matches_team1_id_fkey` FOREIGN KEY (`team1_id`) REFERENCES `hist_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hist_matches` ADD CONSTRAINT `hist_matches_team2_id_fkey` FOREIGN KEY (`team2_id`) REFERENCES `hist_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hist_matches` ADD CONSTRAINT `hist_matches_toss_winner_id_fkey` FOREIGN KEY (`toss_winner_id`) REFERENCES `hist_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hist_matches` ADD CONSTRAINT `hist_matches_winner_id_fkey` FOREIGN KEY (`winner_id`) REFERENCES `hist_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hist_match_players` ADD CONSTRAINT `hist_match_players_match_id_fkey` FOREIGN KEY (`match_id`) REFERENCES `hist_matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hist_match_players` ADD CONSTRAINT `hist_match_players_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `hist_people`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hist_match_players` ADD CONSTRAINT `hist_match_players_team_id_fkey` FOREIGN KEY (`team_id`) REFERENCES `hist_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hist_innings` ADD CONSTRAINT `hist_innings_match_id_fkey` FOREIGN KEY (`match_id`) REFERENCES `hist_matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hist_deliveries` ADD CONSTRAINT `hist_deliveries_match_id_innings_no_fkey` FOREIGN KEY (`match_id`, `innings_no`) REFERENCES `hist_innings`(`match_id`, `innings_no`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hist_wickets` ADD CONSTRAINT `hist_wickets_match_id_innings_no_seq_fkey` FOREIGN KEY (`match_id`, `innings_no`, `seq`) REFERENCES `hist_deliveries`(`match_id`, `innings_no`, `seq`) ON DELETE CASCADE ON UPDATE CASCADE;
