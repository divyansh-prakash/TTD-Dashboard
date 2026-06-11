const router = require('express').Router();
const ctrl   = require('../controllers/failure-queue');

router.get('/by-platform',          ctrl.getByPlatform);
router.get('/by-platform/detail',   ctrl.getByPlatformDetail);
router.get('/by-platform/download', ctrl.download);
router.get('/by-platform/summary',  ctrl.getPlatformSummary);
router.get('/by-platform/hits',       ctrl.getContentHits);
router.get('/comparison',             ctrl.getPeriodComparison);
router.get('/pubmatic-appid-breakdown',       ctrl.getPubmaticAppidBreakdown);
// router.get('/pubmatic-contentid-breakdown', ctrl.getPubmaticContentIdBreakdown); // disabled — see pubmaticContentCache.repo.js
router.get('/pubmatic-content-gap',           ctrl.getPubmaticContentGap);
router.get('/pubmatic-content-coverage',      ctrl.getPubmaticContentCoverage);
router.get('/pubmatic-matchby-breakdown',     ctrl.getPubmaticMatchbyBreakdown);
router.get('/pubmatic-summary',               ctrl.getPubmaticSummary);
router.get('/segment-rankings',         ctrl.getSegmentRankings);
router.get('/segment-detail',           ctrl.getSegmentDetail);
router.get('/platform-segment-counts',  ctrl.getPlatformSegmentCounts);
router.get('/platform-segment-detail',  ctrl.getPlatformSegmentDetail);
router.get('/filters/options',      ctrl.getFilterOptions);
router.get('/trend',                ctrl.getTrend);

module.exports = router;
