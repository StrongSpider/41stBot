'use strict';

// ----------------------------------------
// Database Module (Refactored)
// ----------------------------------------
// This file forwards all exports from the new modular structure in src/api/db/
// to maintain backward compatibility with existing imports.

const db = require('./db');

module.exports = {
  ...db
};