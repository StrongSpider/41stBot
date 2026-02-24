'use strict';

function sanitizeInline(text) {
    return String(text || '').replace(/`/g, '\'').trim();
}

function formatEventEpLockMessage(lockState) {
    const parts = ['<:warning:1297618648810393630> `Event and EP updates are currently locked (read-only mode).`'];
    if (lockState && lockState.reason) parts.push('Reason: ' + sanitizeInline(lockState.reason));
    if (lockState && lockState.changedBy && /^[0-9]{17,20}$/.test(lockState.changedBy)) {
        parts.push('Set by: <@' + lockState.changedBy + '>');
    }
    return parts.join('\n');
}

module.exports = {
    formatEventEpLockMessage
};
