-- Remove retired caches and officer labels. Source PostgreSQL data is untouched.
DROP TABLE IF EXISTS `officer_labels`;
DROP TABLE IF EXISTS `user_assets`;
DROP TABLE IF EXISTS `user_badges`;
