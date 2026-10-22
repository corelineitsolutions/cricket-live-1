-- Expand enum so existing rows can be remapped, then shrink to the new screen list.
ALTER TABLE `ads` MODIFY COLUMN `placement` ENUM(
  'HOME_BANNER',
  'MATCH_LIST',
  'MATCH_DETAIL',
  'SPLASH',
  'INTERSTITIAL',
  'HOME',
  'LIVE_SCREEN_1',
  'LIVE_SCREEN_2',
  'COMMENTARY',
  'SCORECARD',
  'HISTORY',
  'FANTASY',
  'OVERS',
  'TRACKER',
  'POINTS_TABLE',
  'GRAPHS',
  'INFO'
) NOT NULL;

UPDATE `ads` SET `placement` = 'HOME' WHERE `placement` = 'HOME_BANNER';
UPDATE `ads` SET `placement` = 'HOME' WHERE `placement` = 'MATCH_LIST';
UPDATE `ads` SET `placement` = 'INFO' WHERE `placement` = 'MATCH_DETAIL';
UPDATE `ads` SET `placement` = 'HOME' WHERE `placement` = 'SPLASH';
UPDATE `ads` SET `placement` = 'HOME' WHERE `placement` = 'INTERSTITIAL';

ALTER TABLE `ads` MODIFY COLUMN `placement` ENUM(
  'HOME',
  'LIVE_SCREEN_1',
  'LIVE_SCREEN_2',
  'COMMENTARY',
  'SCORECARD',
  'HISTORY',
  'FANTASY',
  'OVERS',
  'TRACKER',
  'POINTS_TABLE',
  'GRAPHS',
  'INFO'
) NOT NULL;
