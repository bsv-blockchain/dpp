/** Visit link destinations while preserving the labels, optional titles and reference syntax. */
export function rewriteMarkdownTargets(text, rewrite) {
  return text
    .replace(/(\]\()([^)\s]+)(?=(?:\s+"[^"]*")?\))/g, (_match, prefix, target) => prefix + rewrite(target))
    .replace(/^( {0,3}\[[^\]]+\]:[ \t]+)(?:<([^>]+)>|([^\s]+))/gm, (_match, prefix, angleTarget, target) =>
      prefix + (angleTarget === undefined ? rewrite(target) : `<${rewrite(angleTarget)}>`))
}

/** Relative and external destinations in the inline links and link definitions used in this repository. */
export function markdownTargets(text) {
  const targets = []
  rewriteMarkdownTargets(text, target => {
    targets.push(target)
    return target
  })
  return targets
}

export const markdownHeadings = (text) => [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim().toLowerCase().replace(/[`*_]/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-'))
