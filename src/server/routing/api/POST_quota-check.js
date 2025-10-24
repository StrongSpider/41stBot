const fileRouter = require('express').Router();

const ensureAuth = require('../util/ensureAuth.js');
const getMembers = require('../util/getMembers.js');

const { checkQuota } = require('../../../api/quota.js')

fileRouter.post('/api/quota/check', ensureAuth, async function (req, res) {
  try {
    const members = await getMembers();

    const reports = await Promise.all(
      members.map(member =>
        checkQuota(member)
          .then(r => r)
          .catch(err => ({ username: member.username, error: err.message }))
      )
    );

    res.json(reports);
  } catch (err) {
    console.error('Batch quota check error', err);
    res.status(500).json({ error: 'Batch quota check failed' });
  }
});

module.exports = fileRouter;