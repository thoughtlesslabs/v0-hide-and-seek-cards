import { rmSync } from "node:fs"
import { resolve } from "node:path"

const nativeExcludedPaths = [resolve("dist/downloads")]

for (const excludedPath of nativeExcludedPaths) {
  rmSync(excludedPath, { force: true, recursive: true })
}

console.log("Prepared native web assets without public download artifacts.")
