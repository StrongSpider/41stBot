module.exports = {
    testEnvironment: 'node',
    setupFilesAfterEnv: ['<rootDir>/src/tests/setup.js'],
    testMatch: ['<rootDir>/src/tests/**/*.test.js'],
    transform: {}, // Disable transformation for simple CommonJS testing
};
