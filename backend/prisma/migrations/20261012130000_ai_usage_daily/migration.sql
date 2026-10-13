-- CreateTable
CREATE TABLE `ai_usage_daily` (
    `day` DATE NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `model` VARCHAR(64) NOT NULL,
    `requests` INTEGER NOT NULL DEFAULT 0,
    `answered` INTEGER NOT NULL DEFAULT 0,
    `refused_disabled` INTEGER NOT NULL DEFAULT 0,
    `refused_quota` INTEGER NOT NULL DEFAULT 0,
    `refused_budget` INTEGER NOT NULL DEFAULT 0,
    `refused_busy` INTEGER NOT NULL DEFAULT 0,
    `errors` INTEGER NOT NULL DEFAULT 0,
    `timeouts` INTEGER NOT NULL DEFAULT 0,
    `prompt_tokens` INTEGER NOT NULL DEFAULT 0,
    `completion_tokens` INTEGER NOT NULL DEFAULT 0,
    `tool_calls` INTEGER NOT NULL DEFAULT 0,
    `language_en` INTEGER NOT NULL DEFAULT 0,
    `language_hi` INTEGER NOT NULL DEFAULT 0,
    `latency_ms_total` INTEGER NOT NULL DEFAULT 0,
    `estimated_cost` DECIMAL(12, 4) NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`day`, `provider`, `model`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
