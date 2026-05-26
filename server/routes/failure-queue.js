const router = require('express').Router();
const ctrl   = require('../controllers/failure-queue');

router.get('/by-platform',        ctrl.getByPlatform);
router.get('/by-platform/detail', ctrl.getByPlatformDetail);
router.get('/by-platform/download', ctrl.download);
router.get('/filters/options',    ctrl.getFilterOptions);
router.get('/trend',              ctrl.getTrend);

module.exports = router;
