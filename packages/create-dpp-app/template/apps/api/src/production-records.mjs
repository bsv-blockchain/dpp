/** Production wire policy. Lift the v3 hold through GOVERNANCE.md after 1Color is ready.
 * @param {readonly string[]} versions
 */
export function assertProductionRecordVersions(versions) {
  if (!Array.isArray(versions) || !versions.includes('2') ||
      versions.some(version => version !== '1' && version !== '2')) {
    throw new Error('Production requires PushDrop v2 with optional v1 support. Record v3 is held until 1Color is ready and its adoption is approved.')
  }
}
