-- CreateIndex (additive only: the admin device list sorts and filters by last_seen_at)
CREATE INDEX `fcm_devices_last_seen_at_idx` ON `fcm_devices`(`last_seen_at`);
