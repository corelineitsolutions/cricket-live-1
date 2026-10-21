-- Opt-in AI training question log (enable with AI_LOG_QUESTIONS=true).
CREATE TABLE `ai_training_questions` (
  `id` VARCHAR(191) NOT NULL,
  `question` VARCHAR(500) NOT NULL,
  `language` VARCHAR(8) NOT NULL,
  `match_id` VARCHAR(16) NULL,
  `outcome` VARCHAR(32) NOT NULL,
  `tools_used` JSON NOT NULL,
  `answer_preview` VARCHAR(280) NULL,
  `needs_review` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ai_training_questions_created_at_idx`(`created_at`),
  INDEX `ai_training_questions_needs_review_created_at_idx`(`needs_review`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
