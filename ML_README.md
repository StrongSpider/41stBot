# Suspicious Account Detector - ML System

An AI system that detects suspicious accounts using background check data and officer-labeled training data.

## Overview

The system analyzes Roblox account background check data across 6 key areas to determine suspicion levels:

### Analyzed Areas

1. **Badge Anomalies** - Detects unusual badge patterns
   - Extremely high badge counts (badge farming)
   - Badges from flagged suspicious places
   - Missing badges on mature accounts

2. **Inventory Anomalies** - Identifies suspicious items
   - Excessive inventory counts (item duping)
   - Unusual development item ratios
   - Very high inventory values

3. **Game Pass Anomalies** - Flags game pass patterns
   - High game pass spending (RBC farming indicators)
   - Excessive game pass creation
   - Suspicious pricing patterns

4. **Group Anomalies** - Detects group-related issues
   - Very high group membership counts
   - Predominantly base rank groups
   - Signs of spam/alt activity

5. **xTracker Evidence** - External violation reports
   - Reports from xTracker database
   - Multiple independent violations
   - Recent suspicious activity

6. **Connection Anomalies** - Linked account patterns
   - Multiple linked Discord/Roblox connections
   - Potential account hijacking indicators

## Architecture

### Components

```
src/api/ml/
├── index.js              # Main entry point
├── featureExtractor.js   # Background check feature analysis
├── trainer.js            # Model training from officer labels
└── inference.js          # Prediction on new accounts
```

### Data Flow

1. **Background Check Data** → Feature Extractor
2. **Officer Labels** + **Features** → Trainer
3. **Trained Model** + **New Features** → Inference
4. **Prediction** with area scores & rating

## Training

### Step 1: Collect Training Data

Officers label accounts in the database via the `officer_labels` table:

```sql
INSERT INTO officer_labels (target_roblox_id, officer_discord_id, label)
VALUES (12345, 'discord_id_here', 'ALT');
```

Supported labels:
- `REAL` - Verified legitimate account
- `LIKELY_REAL` - Probable legitimate account
- `LIKELY_ALT` - Probable alt account
- `ALT` - Confirmed alt account

### Step 2: Train Model

```bash
node trainModel.js
```

This will:
1. Fetch all officer labels from database
2. Extract background check features for each account
3. Calculate feature weights based on label distributions
4. Save trained model to `models/suspicious_account_model.json`

### Step 3: Make Predictions

```javascript
const ml = require('./src/api/ml');

// Initialize
await ml.initialize();

// Predict suspicion for single account
const result = await ml.predict(12345);
console.log(result.prediction);

// Batch predictions
const batch = await ml.predictBatch([123, 456, 789]);
console.log(batch);
```

## Prediction Output

```javascript
{
  robloxId: 12345,
  username: 'example_user',
  prediction: {
    cumulativeScore: 72,        // 0-100 suspicion score
    rating: 3,                  // 0-4: 0=LEGIT, 4=ALT
    suspicionString: 'LIKELY_ALT',
    confidence: 85,             // 0-100 prediction confidence
    areaScores: {
      badgeAnomalies: {
        rawScore: 50,
        weightedScore: 55,
        flagged: true,
        details: { /* ... */ }
      },
      // ... other areas
    },
    recommendation: [
      'ACTION: Recommend immediate manual review',
      'ACTION: Consider adding to verification list'
    ]
  },
  timestamp: '2026-02-04T...'
}
```

## Ratings Explained

| Rating | String | Meaning |
|--------|--------|---------|
| 0 | LEGITIMATE | Account appears genuine, low suspicion |
| 1 | LIKELY_LEGITIMATE | Mostly normal, some minor concerns |
| 2 | SUSPICIOUS | Notable anomalies warrant investigation |
| 3 | LIKELY_ALT | Strong indicators of alt account |
| 4 | ALT | Confirmed or near-certain alt account |

## Suspicion Scoring

`Cumulative Score = 0-100`

- **0-20**: Legitimate account
- **20-40**: Likely legitimate with minor concerns
- **40-60**: Suspicious, needs review
- **60-80**: Likely alt account
- **80-100**: Confirmed alt account

## Usage Examples

### Single Account Check

```javascript
const ml = require('./src/api/ml');

const result = await ml.predict('player_username_or_id');
console.log(`Rating: ${result.prediction.suspicionString}`);
console.log(`Score: ${result.prediction.cumulativeScore}/100`);
console.log(`Recommendations:`, result.prediction.recommendation);
```

### Batch Account Screening

```javascript
const userIds = [123, 456, 789, 1011];
const results = await ml.predictBatch(userIds);

// Filter for high-suspicion accounts
const suspicious = results.filter(r => r.prediction.rating >= 3);
console.log(`Found ${suspicious.length} likely alt accounts`);
```

### Integration with Discord Bot

```javascript
// In a Discord command
const ml = require('.../ml');

const robloxId = getUserRobloxId(discordUser);
const prediction = await ml.predict(robloxId);

if (prediction.prediction.rating >= 3) {
    await flagAlert(prediction);
}
```

## Model Performance

### Factors Affecting Accuracy

✅ **Improves with:**
- More training data (officer labels)
- Diverse label distribution
- Recent xTracker data availability
- Accurate background check data

❌ **Limited by:**
- New/unverified accounts
- Accounts with private data
- Limited external reports (xTracker)
- Edge cases not in training data

### Confidence Score

The confidence (0-100) indicates how much you should trust the prediction:

- **80-100**: High confidence prediction
- **60-79**: Moderate confidence
- **40-59**: Low confidence (manual review recommended)
- **0-39**: Very low confidence (rely on manual analysis)

## API Integration

### As Middleware

```javascript
const ml = require('./src/api/ml');

app.post('/api/verify/:robloxId', async (req, res) => {
    const result = await ml.predict(req.params.robloxId);
    
    if (result.prediction.rating >= 3) {
        return res.status(403).json({ error: 'Account appears suspicious' });
    }
    
    // Continue with verification...
});
```

### Periodic Screening

```javascript
// Scan all recent joiners daily
async function screenNewMembers() {
    const newUsers = await getLastNDayJoiners(7);
    const predictions = await ml.predictBatch(newUsers.map(u => u.robloxId));
    
    const flagged = predictions.filter(p => p.prediction.rating >= 2);
    await notifyOfficers(flagged);
}
```

## Configuration

### Model Location

Default: `/src/models/suspicious_account_model.json`

Change in `trainer.js`:
```javascript
const MODEL_FILE = path.join(__dirname, 'custom_path', 'model.json');
```

### Feature Weights

The model learns weights automatically from training data. Default weights (when no training data) are in `trainer.js::getDefaultModel()`.

## Troubleshooting

### No training data available

The system will use default model with reasonable heuristics. Train with real data as soon as possible.

### Low confidence predictions

- Ensure sufficient training examples (50+)
- Check that background check data is complete
- Verify xTracker API key is configured

### Background check timeouts

- Increase `REQUEST_TIMEOUT_MS` in `backgroundCheck.js`
- Check network connectivity
- Verify Roblox API availability

## Future Improvements

- [ ] Deep learning model (PyTorch/TensorFlow)
- [ ] Real-time model updates
- [ ] Anomaly detection for new patterns
- [ ] Ensemble methods with multiple models
- [ ] Cross-validation and hyperparameter tuning
- [ ] API for external integration
- [ ] Web dashboard for predictions
