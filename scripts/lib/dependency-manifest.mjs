import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Read the nearest installed dependency, including non-hoisted workspace dependencies. */
export function dependencyManifest(packageDirectory, name) {
  let directory = resolve(packageDirectory)
  while (true) {
    const path = join(directory, 'node_modules', name, 'package.json')
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'))
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}
