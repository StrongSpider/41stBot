'use strict';

const {
    extractFeatures,
    createTrainingSnapshot,
    extractFeaturesFromSnapshot
} = require('../../api/ml/featureExtractor');
const {
    trainNeuralNetwork
} = require('../../api/ml/trainer');
const {
    calculatePrediction
} = require('../../api/ml/inference');

function buildBgCheck(overrides = {}) {
    return {
        robloxId: overrides.robloxId || 1000,
        username: overrides.username || 'test_user',
        profile: {
            id: overrides.robloxId || 1000,
            name: overrides.username || 'test_user',
            displayName: overrides.username || 'test_user',
            created: overrides.created || '2024-01-01T00:00:00.000Z'
        },
        connections: {
            friendCount: 0,
            followerCount: 0,
            followingCount: 0,
            ...(overrides.connections || {})
        },
        groups: overrides.groups || [],
        inventory: overrides.inventory || [],
        gamePasses: overrides.gamePasses || [],
        badges: overrides.badges || { data: [], suspicious: [] },
        stats: overrides.stats || {}
    };
}

describe('suspicious account model', () => {
    test('training snapshots preserve the extracted features used for learning', () => {
        const bgCheck = buildBgCheck({
            robloxId: 111,
            username: 'snapshot_case',
            connections: {
                friendCount: 3,
                followerCount: 1,
                followingCount: 2
            },
            groups: [
                { Id: 1, Name: 'Group 1', Role: 'Member', Rank: 1, IsBaseRank: true }
            ],
            inventory: [
                { assetId: 10, type: 'Hat' },
                { assetId: 11, type: 'Accessory' }
            ],
            gamePasses: [
                { gamePassId: 50, price: 25, creator: { creatorId: 9999 } }
            ],
            badges: {
                data: [
                    { badgeId: 1, placeId: 500, awardedDate: 1710000000 },
                    { badgeId: 2, placeId: 501, awardedDate: 1710000030 }
                ],
                suspicious: [
                    { placeId: 501, reason: 'Badge Runner' }
                ]
            }
        });

        const liveFeatures = extractFeatures(bgCheck);
        const snapshot = createTrainingSnapshot(bgCheck);
        const snapshotFeatures = extractFeaturesFromSnapshot(snapshot);

        expect(snapshot.schemaVersion).toBe('suspicious-account-snapshot-v1');
        expect(snapshot.backgroundCheck.robloxId).toBe(111);
        expect(snapshotFeatures.features).toEqual(liveFeatures.features);
        expect(snapshotFeatures.features.suspiciousBadgeCount).toBe(1);
        expect(snapshotFeatures.features.totalItems).toBe(2);
    });

    test('neural prediction returns a suspicious score and grouped breakdown', () => {
        const suspiciousExamples = [
            buildBgCheck({
                robloxId: 201,
                username: 'alt_one',
                created: '2026-02-20T00:00:00.000Z',
                connections: { friendCount: 0, followerCount: 0, followingCount: 1 },
                groups: [
                    { Id: 1, Name: 'Mass Join', Role: 'Member', Rank: 1, IsBaseRank: true },
                    { Id: 2, Name: 'Mass Join 2', Role: 'Member', Rank: 1, IsBaseRank: true }
                ],
                inventory: [{ assetId: 1, type: 'Hat' }],
                gamePasses: [],
                badges: {
                    data: [
                        { badgeId: 1, placeId: 1, awardedDate: 1710000000 },
                        { badgeId: 2, placeId: 2, awardedDate: 1710000030 },
                        { badgeId: 3, placeId: 3, awardedDate: 1710000060 },
                        { badgeId: 4, placeId: 4, awardedDate: 1710000090 },
                        { badgeId: 5, placeId: 5, awardedDate: 1710000120 }
                    ],
                    suspicious: [{ placeId: 5, reason: 'Badge Runner' }]
                }
            }),
            buildBgCheck({
                robloxId: 202,
                username: 'alt_two',
                created: '2026-02-10T00:00:00.000Z',
                connections: { friendCount: 1, followerCount: 0, followingCount: 0 },
                groups: [
                    { Id: 3, Name: 'Mass Join', Role: 'Member', Rank: 1, IsBaseRank: true }
                ],
                inventory: [{ assetId: 2, type: 'Hat' }],
                gamePasses: [],
                badges: {
                    data: [
                        { badgeId: 1, placeId: 10, awardedDate: 1711000000 },
                        { badgeId: 2, placeId: 11, awardedDate: 1711000020 },
                        { badgeId: 3, placeId: 12, awardedDate: 1711000040 },
                        { badgeId: 4, placeId: 13, awardedDate: 1711000060 },
                        { badgeId: 5, placeId: 14, awardedDate: 1711000080 }
                    ],
                    suspicious: [{ placeId: 14, reason: 'Badge Runner' }]
                }
            })
        ];

        const legitimateExamples = [
            buildBgCheck({
                robloxId: 301,
                username: 'real_one',
                created: '2018-01-01T00:00:00.000Z',
                connections: { friendCount: 80, followerCount: 35, followingCount: 40 },
                groups: [
                    { Id: 11, Name: 'Unit', Role: 'Officer', Rank: 100, IsBaseRank: false },
                    { Id: 12, Name: 'Community', Role: 'Member', Rank: 10, IsBaseRank: false }
                ],
                inventory: [
                    { assetId: 100, type: 'Hat' },
                    { assetId: 101, type: 'Accessory' },
                    { assetId: 102, type: 'Shirt' },
                    { assetId: 103, type: 'Pants' }
                ],
                gamePasses: [
                    { gamePassId: 1, price: 150, creator: { creatorId: 9999 } }
                ],
                badges: {
                    data: [
                        { badgeId: 10, placeId: 20, awardedDate: 1514764800 },
                        { badgeId: 11, placeId: 21, awardedDate: 1546300800 },
                        { badgeId: 12, placeId: 22, awardedDate: 1577836800 }
                    ],
                    suspicious: []
                }
            }),
            buildBgCheck({
                robloxId: 302,
                username: 'real_two',
                created: '2019-01-01T00:00:00.000Z',
                connections: { friendCount: 55, followerCount: 12, followingCount: 25 },
                groups: [
                    { Id: 13, Name: 'Unit', Role: 'NCO', Rank: 75, IsBaseRank: false }
                ],
                inventory: [
                    { assetId: 110, type: 'Hat' },
                    { assetId: 111, type: 'Hair' },
                    { assetId: 112, type: 'Accessory' }
                ],
                gamePasses: [
                    { gamePassId: 2, price: 80, creator: { creatorId: 9999 } }
                ],
                badges: {
                    data: [
                        { badgeId: 13, placeId: 23, awardedDate: 1546300800 },
                        { badgeId: 14, placeId: 24, awardedDate: 1609459200 }
                    ],
                    suspicious: []
                }
            })
        ];

        const examples = [
            ...suspiciousExamples.map(bgCheck => ({
                targetScore: 0.95,
                voteCount: 2,
                features: extractFeatures(bgCheck)
            })),
            ...legitimateExamples.map(bgCheck => ({
                targetScore: 0.05,
                voteCount: 2,
                features: extractFeatures(bgCheck)
            }))
        ];

        const trained = trainNeuralNetwork(examples, {
            iterations: 1200,
            hiddenSize: 8,
            learningRate: 0.05,
            seed: 42
        });

        const model = {
            type: 'neural_network',
            isDefault: false,
            trainingExamples: examples.length,
            normalization: trained.normalization,
            network: trained.network,
            featureInsights: {}
        };

        const candidate = extractFeatures(buildBgCheck({
            robloxId: 999,
            username: 'candidate_alt',
            created: '2026-02-25T00:00:00.000Z',
            connections: { friendCount: 0, followerCount: 0, followingCount: 1 },
            groups: [
                { Id: 90, Name: 'Fresh Join', Role: 'Member', Rank: 1, IsBaseRank: true }
            ],
            inventory: [{ assetId: 1, type: 'Hat' }],
            gamePasses: [],
            badges: {
                data: [
                    { badgeId: 1, placeId: 90, awardedDate: 1712000000 },
                    { badgeId: 2, placeId: 91, awardedDate: 1712000020 },
                    { badgeId: 3, placeId: 92, awardedDate: 1712000040 },
                    { badgeId: 4, placeId: 93, awardedDate: 1712000060 },
                    { badgeId: 5, placeId: 94, awardedDate: 1712000080 }
                ],
                suspicious: [{ placeId: 94, reason: 'Badge Runner' }]
            }
        }));

        const prediction = calculatePrediction(candidate, model);

        expect(prediction.cumulativeScore).toBeGreaterThan(60);
        expect(prediction.breakdown.badges.score).toBeGreaterThan(50);
        expect(prediction.breakdown.connections.score).toBeGreaterThan(50);
        expect(prediction.breakdown.badges.suspiciousSignals.length).toBeGreaterThan(0);
        expect(prediction.recommendation.length).toBeGreaterThan(0);
    });
});
