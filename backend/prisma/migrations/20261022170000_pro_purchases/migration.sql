-- CreateTable
CREATE TABLE `pro_purchases` (
    `id` VARCHAR(191) NOT NULL,
    `device_id` VARCHAR(128) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `email` VARCHAR(255) NULL,
    `plan_code` ENUM('SIX_MONTH', 'ONE_YEAR') NOT NULL,
    `razorpay_plan_id` VARCHAR(64) NOT NULL,
    `razorpay_order_id` VARCHAR(64) NOT NULL,
    `razorpay_payment_id` VARCHAR(64) NULL,
    `amount_paise` INTEGER NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'INR',
    `status` ENUM('CREATED', 'PAID', 'FAILED') NOT NULL DEFAULT 'CREATED',
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pro_purchases_razorpay_order_id_key`(`razorpay_order_id`),
    INDEX `pro_purchases_device_id_status_ends_at_idx`(`device_id`, `status`, `ends_at`),
    INDEX `pro_purchases_phone_idx`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
