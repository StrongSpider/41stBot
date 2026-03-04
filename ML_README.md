# Suspicious Account Detector

Machine-learning tooling for labeling, training, and scoring suspicious Roblox accounts.

The ML system lives under `src/api/ml` and is used by the broader background-check flow.

## Before You Train

Make sure the base project install is already complete:

1. Root dependencies are installed with `npm install`
2. `config.json` exists and contains working `POSTGRES`, `ROBLOX`, and external API settings
3. `schema.sql` has been loaded so `officer_labels` and the supporting tables exist

Training can fall back to live background checks when saved snapshots are missing, so a valid Roblox cookie and working API integrations matter.

## File Layout

```text
src/api/ml/
├── index.js
├── featureExtractor.js
├── trainer.js
└── inference.js
```

Trained models are stored in:

```text
src/models/suspicious_account_model.json
```

## Training Data

The trainer uses officer labels from the `officer_labels` table.

Supported labels:

- `REAL`
- `LIKELY_REAL`
- `LIKELY_ALT`
- `ALT`

Labels are usually created through the portal/API, which also stores a training snapshot when possible. Snapshot-backed labels make retraining faster and less dependent on live Roblox lookups.

You can also insert labels manually:

```sql
INSERT INTO officer_labels (target_roblox_id, officer_discord_id, label)
VALUES (12345, 'discord_id_here', 'ALT');
```

## Train The Model

From the repo root:

```bash
node trainModel.js
```

What happens during training:

1. Officer labels are loaded from PostgreSQL
2. Duplicate labels for the same account are aggregated into a consensus score
3. Saved feature snapshots are reused when available
4. Missing snapshots fall back to a live background check
5. A neural-network model is trained and written to `src/models/suspicious_account_model.json`

If no labels are available, the system falls back to a neutral default model instead of producing a trained file.

## Use It In Code

### Initialize

```js
const ml = require('./src/api/ml');

await ml.initialize();
```

### Single prediction

```js
const ml = require('./src/api/ml');

await ml.initialize();

const result = await ml.predict(12345);
console.log(result.cumulativeScore);
console.log(result.suspicionString);
console.log(result.summary);
```

### Batch prediction

```js
const ml = require('./src/api/ml');

await ml.initialize();

const results = await ml.predictBatch([123, 456, 789]);
const flagged = results.filter((entry) => entry.rating >= 3);
console.log(flagged);
```

## Prediction Shape

`ml.predict()` returns a top-level result object like:

```js
{
  robloxId: 12345,
  username: 'example_user',
  cumulativeScore: 72,
  rating: 3,
  suspicionString: 'Likely Alternative Account',
  confidence: 85,
  probability: 0.72,
  breakdown: {
    profile: { title: 'Profile', score: 41, direction: 'neutral' },
    badges: { title: 'Badges', score: 78, direction: 'suspicious' },
    inventory: { title: 'Inventory', score: 64, direction: 'suspicious' },
    gamePasses: { title: 'Game Passes', score: 52, direction: 'neutral' },
    groups: { title: 'Groups', score: 69, direction: 'suspicious' },
    connections: { title: 'Connections', score: 37, direction: 'reassuring' }
  },
  recommendation: [
    'Review badge timing and flagged badge places.',
    'Check whether the inventory looks like a real played account.'
  ],
  summary: 'Highest concern came from badges and groups.',
  timestamp: '2026-03-04T00:00:00.000Z'
}
```

## Ratings

| Rating | Meaning |
| --- | --- |
| `0` | Legitimate Account |
| `1` | Likely Legitimate |
| `2` | Suspicious Activity Detected |
| `3` | Likely Alternative Account |
| `4` | Alternative Account |

## What The Model Looks At

The feature extractor currently scores six areas:

1. Profile age
2. Badges
3. Inventory
4. Game passes
5. Groups
6. Social connections

Each prediction returns an area breakdown plus the strongest suspicious and reassuring signals.

## Accuracy Notes

- Better officer labeling produces better results.
- Missing Roblox data lowers confidence.
- Small training sets are heavily confidence-limited.
- If no trained model exists, inference falls back to a neutral "Model Unavailable" result.

## Related Files

- `trainModel.js`
- `src/api/ml/trainer.js`
- `src/api/ml/inference.js`
- `src/server/controllers/LabelsController.js`
