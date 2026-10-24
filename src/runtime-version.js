'use strict';

const REQUIRED_NODE = Object.freeze({ major: 24, minor: 22, patch: 1 });
const REQUIRED_LABEL = `${REQUIRED_NODE.major}.${REQUIRED_NODE.minor}.${REQUIRED_NODE.patch}`;

function parseVersion(raw = process.versions.node) {
  const [major = 0, minor = 0, patch = 0] = String(raw).replace(/^v/, '').split('.').map(Number);
  return { major, minor, patch };
}

function isSupportedNode(raw = process.versions.node) {
  const current = parseVersion(raw);
  if (current.major !== REQUIRED_NODE.major) return false;
  if (current.minor !== REQUIRED_NODE.minor) return current.minor > REQUIRED_NODE.minor;
  return current.patch >= REQUIRED_NODE.patch;
}

function assertSupportedNode(raw = process.versions.node) {
  if (isSupportedNode(raw)) return;
  throw new Error(
    `Version Node.js non supportée (${String(raw)}). `
    + `Puissance 4 exige Node.js ${REQUIRED_LABEL} ou une version 24.x plus récente.`,
  );
}

if (require.main === module) {
  assertSupportedNode();
  console.log(`Node.js ${process.versions.node} compatible (minimum ${REQUIRED_LABEL}).`);
}

module.exports = { REQUIRED_NODE, REQUIRED_LABEL, parseVersion, isSupportedNode, assertSupportedNode };
