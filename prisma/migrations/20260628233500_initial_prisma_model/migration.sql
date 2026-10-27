-- CreateTable
CREATE TABLE `event_types` (
    `type` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `roblox_ids` (
    `discordid` VARCHAR(191) NOT NULL,
    `robloxid` BIGINT NOT NULL,

    UNIQUE INDEX `roblox_ids_robloxid_key`(`robloxid`),
    PRIMARY KEY (`discordid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `inactivity` (
    `discordid` VARCHAR(191) NOT NULL,
    `date` BIGINT NOT NULL,
    `reason` TEXT NOT NULL,

    PRIMARY KEY (`discordid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `weekly_events` (
    `eventid` CHAR(36) NOT NULL,
    `attendees` JSON NOT NULL,
    `host` BIGINT NOT NULL,
    `supervisor` BIGINT NOT NULL,
    `timestamp` DATETIME(6) NOT NULL,
    `type` VARCHAR(191) NULL,
    `message` VARCHAR(512) NULL,

    UNIQUE INDEX `weekly_events_message_key`(`message`),
    INDEX `weekly_events_host_idx`(`host`),
    INDEX `weekly_events_supervisor_idx`(`supervisor`),
    INDEX `weekly_events_timestamp_idx`(`timestamp`),
    INDEX `weekly_events_type_idx`(`type`),
    PRIMARY KEY (`eventid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `all_time_events` (
    `eventid` CHAR(36) NOT NULL,
    `attendees` JSON NOT NULL,
    `host` BIGINT NOT NULL,
    `supervisor` BIGINT NOT NULL,
    `timestamp` DATETIME(6) NOT NULL,
    `type` VARCHAR(191) NULL,
    `message` VARCHAR(512) NULL,

    UNIQUE INDEX `all_time_events_message_key`(`message`),
    INDEX `all_time_events_host_idx`(`host`),
    INDEX `all_time_events_supervisor_idx`(`supervisor`),
    INDEX `all_time_events_timestamp_idx`(`timestamp`),
    INDEX `all_time_events_type_idx`(`type`),
    PRIMARY KEY (`eventid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `weekly_events_index` (
    `robloxid` BIGINT NOT NULL,
    `events` JSON NOT NULL,

    PRIMARY KEY (`robloxid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `all_time_events_index` (
    `robloxid` BIGINT NOT NULL,
    `events` JSON NOT NULL,

    PRIMARY KEY (`robloxid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `event_points` (
    `robloxid` BIGINT NOT NULL,
    `eventpoints` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`robloxid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `all_time_event_points` (
    `robloxid` BIGINT NOT NULL,
    `eventpoints` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`robloxid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `role_quotas` (
    `roleid` VARCHAR(191) NOT NULL,
    `quotaep` INTEGER NOT NULL DEFAULT 0,
    `eventcaps` JSON NOT NULL,
    `overwrites` TEXT NULL DEFAULT (''),
    `exclusive` TEXT NULL DEFAULT (''),
    `purges` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`roleid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `roblox_user_cache` (
    `robloxid` BIGINT NOT NULL,
    `username` TEXT NOT NULL,
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `roblox_user_cache_updated_at_idx`(`updated_at`),
    PRIMARY KEY (`robloxid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `bot_state` (
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `minor_officer_logs_weekly` (
    `discordid` VARCHAR(191) NOT NULL,
    `review_count` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    PRIMARY KEY (`discordid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `minor_officer_logs_all_time` (
    `discordid` VARCHAR(191) NOT NULL,
    `review_count` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    PRIMARY KEY (`discordid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `user_badges` (
    `robloxid` BIGINT NOT NULL,
    `data` JSON NOT NULL,

    PRIMARY KEY (`robloxid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `user_assets` (
    `robloxid` BIGINT NOT NULL,
    `data` JSON NOT NULL,

    PRIMARY KEY (`robloxid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `officer_labels` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `officer_discord_id` VARCHAR(191) NOT NULL,
    `target_roblox_id` BIGINT NOT NULL,

    INDEX `officer_labels_target_roblox_id_idx`(`target_roblox_id`),
    UNIQUE INDEX `officer_labels_officer_discord_id_target_roblox_id_key`(`officer_discord_id`, `target_roblox_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- AddForeignKey
ALTER TABLE `weekly_events` ADD CONSTRAINT `weekly_events_host_fkey` FOREIGN KEY (`host`) REFERENCES `roblox_ids`(`robloxid`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_events` ADD CONSTRAINT `weekly_events_supervisor_fkey` FOREIGN KEY (`supervisor`) REFERENCES `roblox_ids`(`robloxid`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `all_time_events` ADD CONSTRAINT `all_time_events_host_fkey` FOREIGN KEY (`host`) REFERENCES `roblox_ids`(`robloxid`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `all_time_events` ADD CONSTRAINT `all_time_events_supervisor_fkey` FOREIGN KEY (`supervisor`) REFERENCES `roblox_ids`(`robloxid`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_events_index` ADD CONSTRAINT `weekly_events_index_robloxid_fkey` FOREIGN KEY (`robloxid`) REFERENCES `roblox_ids`(`robloxid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `all_time_events_index` ADD CONSTRAINT `all_time_events_index_robloxid_fkey` FOREIGN KEY (`robloxid`) REFERENCES `roblox_ids`(`robloxid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_points` ADD CONSTRAINT `event_points_robloxid_fkey` FOREIGN KEY (`robloxid`) REFERENCES `roblox_ids`(`robloxid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `all_time_event_points` ADD CONSTRAINT `all_time_event_points_robloxid_fkey` FOREIGN KEY (`robloxid`) REFERENCES `roblox_ids`(`robloxid`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserve event type validation from the original database.
ALTER TABLE `event_types`
    ADD CONSTRAINT `event_types_type_check_len` CHECK (CHAR_LENGTH(`type`) BETWEEN 1 AND 64),
    ADD CONSTRAINT `event_types_type_check_allowlist` CHECK (REGEXP_LIKE(`type`, '^[A-Za-z0-9._ -]+$', 'c'));

-- Username lookups are case insensitive, as on PostgreSQL with Prisma mode.
ALTER TABLE `roblox_user_cache` MODIFY `username` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
