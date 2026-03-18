import fs from "node:fs"
import path from "node:path"
import process from "node:process"

type ArtifactType =
  | "next-frontend-output"
  | "lambda-package-asset"
  | "container-context-asset"
  | "vendored-python-environment"
  | "non-shipping-metadata"

type MatchRecord = {
  artifactName: string
  artifactPath: string
  artifactType: ArtifactType
  deployable: boolean
  evidencePath: string
  marker: string
  sizeBytes: number
  sourceHint: string
}

type ArtifactSummary = {
  artifactName: string
  artifactPath: string
  artifactType: ArtifactType
  deployable: boolean
  matches: MatchRecord[]
}

type FrontendSummary = {
  outputPath: string
  analyzerReports: string[]
  totalJsBytes: number
  react18Matches: MatchRecord[]
  react19Matches: MatchRecord[]
}

type AssetsManifest = {
  files?: Record<
    string,
    {
      displayName?: string
      source?: {
        path?: string
        packaging?: string
      }
    }
  >
  dockerImages?: Record<
    string,
    {
      displayName?: string
      source?: {
        directory?: string
        dockerFile?: string
      }
    }
  >
}

const projectRoot = process.cwd()
const nextOutputDir = path.join(projectRoot, ".next")
const cdkOutDir = path.join(projectRoot, "cdk.out")
const frontendEvidenceGlobs = [".next/static", ".next/server"]
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".mjs",
  ".txt",
])
const markerPatterns = [
  { name: "react@18", regex: /react@18(?:\.\d+\.\d+)?/i },
  { name: "react-dom@18", regex: /react-dom@18(?:\.\d+\.\d+)?/i },
  { name: "react@19", regex: /react(?:-dom)?@19(?:\.\d+\.\d+)?/i },
  { name: "@aws-amplify/backend-cli", regex: /@aws-amplify\/backend-cli/i },
  { name: "codegen-ui-react", regex: /codegen-ui-react/i },
  { name: "form-generator", regex: /form-generator/i },
]

function walkFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return []
  }

  const files: string[] = []
  const stack = [rootDir]

  while (stack.length > 0) {
    const current = stack.pop()

    if (!current) {
      continue
    }

    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(absolutePath)
      } else if (entry.isFile()) {
        files.push(absolutePath)
      }
    }
  }

  return files
}

function isTextCandidate(filePath: string, sizeBytes: number): boolean {
  return textExtensions.has(path.extname(filePath)) && sizeBytes <= 3 * 1024 * 1024
}

function getSourceHint(filePath: string): string {
  const normalized = filePath.replaceAll(path.sep, "/")

  if (normalized.includes("/site-packages/dash/")) {
    return "Python Dash"
  }

  if (normalized.includes("/site-packages/jupyter") || normalized.includes("/labextension/")) {
    return "Jupyter extension"
  }

  if (normalized.includes("/site-packages/plotly/")) {
    return "Plotly"
  }

  if (normalized.includes("/node_modules/@aws-amplify/backend-cli/")) {
    return "@aws-amplify/backend-cli"
  }

  if (normalized.includes("codegen-ui-react")) {
    return "@aws-amplify/codegen-ui-react"
  }

  if (normalized.includes("form-generator")) {
    return "@aws-amplify/form-generator"
  }

  if (normalized.includes("/.next/")) {
    return "Next build output"
  }

  return "unknown"
}

function findMarkerMatches(filePath: string): { marker: string; sizeBytes: number; sourceHint: string }[] {
  const stats = fs.statSync(filePath)
  const sizeBytes = stats.size
  const haystacks = [filePath.replaceAll(path.sep, "/")]

  if (isTextCandidate(filePath, sizeBytes)) {
    try {
      haystacks.push(fs.readFileSync(filePath, "utf8"))
    } catch {
      // Ignore files that cannot be read as utf8.
    }
  }

  const hits = new Map<string, { marker: string; sizeBytes: number; sourceHint: string }>()
  for (const haystack of haystacks) {
    for (const markerPattern of markerPatterns) {
      if (markerPattern.regex.test(haystack)) {
        hits.set(markerPattern.name, {
          marker: markerPattern.name,
          sizeBytes,
          sourceHint: getSourceHint(filePath),
        })
      }
    }
  }

  return Array.from(hits.values())
}

function classifyArtifactType(artifactPath: string, deployable: boolean): ArtifactType {
  const normalized = artifactPath.replaceAll(path.sep, "/")

  if (!deployable) {
    return "non-shipping-metadata"
  }

  if (normalized.includes("/site-packages/") || normalized.includes("/venv/") || normalized.includes("/.venv/")) {
    return "vendored-python-environment"
  }

  if (normalized.includes("/asset.")) {
    return "container-context-asset"
  }

  return "lambda-package-asset"
}

function analyzeFrontend(): FrontendSummary {
  const outputFiles = frontendEvidenceGlobs.flatMap((relativeDir) =>
    walkFiles(path.join(projectRoot, relativeDir))
  )

  const react18Matches: MatchRecord[] = []
  const react19Matches: MatchRecord[] = []
  let totalJsBytes = 0

  for (const filePath of outputFiles) {
    const stats = fs.statSync(filePath)
    if (filePath.endsWith(".js")) {
      totalJsBytes += stats.size
    }

    const matches = findMarkerMatches(filePath)
    for (const match of matches) {
      const record: MatchRecord = {
        artifactName: "Next production output",
        artifactPath: path.relative(projectRoot, filePath),
        artifactType: "next-frontend-output",
        deployable: true,
        evidencePath: path.relative(projectRoot, filePath),
        marker: match.marker,
        sizeBytes: match.sizeBytes,
        sourceHint: match.sourceHint,
      }

      if (match.marker.startsWith("react@18") || match.marker.startsWith("react-dom@18")) {
        react18Matches.push(record)
      }

      if (match.marker === "react@19") {
        react19Matches.push(record)
      }
    }
  }

  const analyzerReports = walkFiles(nextOutputDir)
    .filter((filePath) => filePath.endsWith(".html"))
    .filter((filePath) => filePath.toLowerCase().includes("analy"))
    .map((filePath) => path.relative(projectRoot, filePath))

  return {
    outputPath: path.relative(projectRoot, nextOutputDir),
    analyzerReports,
    totalJsBytes,
    react18Matches,
    react19Matches,
  }
}

function analyzeManifest(manifestPath: string): ArtifactSummary[] {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as AssetsManifest
  const summaries: ArtifactSummary[] = []
  const manifestDir = path.dirname(manifestPath)

  for (const fileAsset of Object.values(manifest.files ?? {})) {
    const sourcePath = fileAsset.source?.path
    if (!sourcePath) {
      continue
    }

    const absolutePath = path.resolve(manifestDir, sourcePath)
    const matches = fs.existsSync(absolutePath)
      ? findMarkerMatches(absolutePath).map((match) => ({
          artifactName: fileAsset.displayName ?? path.basename(sourcePath),
          artifactPath: path.relative(projectRoot, absolutePath),
          artifactType: classifyArtifactType(absolutePath, false),
          deployable: false,
          evidencePath: path.relative(projectRoot, absolutePath),
          marker: match.marker,
          sizeBytes: match.sizeBytes,
          sourceHint: match.sourceHint,
        }))
      : []

    summaries.push({
      artifactName: fileAsset.displayName ?? path.basename(sourcePath),
      artifactPath: path.relative(projectRoot, absolutePath),
      artifactType: classifyArtifactType(absolutePath, false),
      deployable: false,
      matches,
    })
  }

  for (const dockerAsset of Object.values(manifest.dockerImages ?? {})) {
    const sourceDirectory = dockerAsset.source?.directory
    if (!sourceDirectory) {
      continue
    }

    const absoluteDirectory = path.resolve(manifestDir, sourceDirectory)
    const matches: MatchRecord[] = []
    for (const filePath of walkFiles(absoluteDirectory)) {
      for (const match of findMarkerMatches(filePath)) {
        matches.push({
          artifactName: dockerAsset.displayName ?? path.basename(sourceDirectory),
          artifactPath: path.relative(projectRoot, absoluteDirectory),
          artifactType: classifyArtifactType(filePath, true),
          deployable: true,
          evidencePath: path.relative(projectRoot, filePath),
          marker: match.marker,
          sizeBytes: match.sizeBytes,
          sourceHint: match.sourceHint,
        })
      }
    }

    summaries.push({
      artifactName: dockerAsset.displayName ?? path.basename(sourceDirectory),
      artifactPath: path.relative(projectRoot, absoluteDirectory),
      artifactType: "container-context-asset",
      deployable: true,
      matches,
    })
  }

  return summaries
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
  }

  if (sizeBytes >= 1024) {
    return `${(sizeBytes / 1024).toFixed(2)} KB`
  }

  return `${sizeBytes} B`
}

function printFrontendSummary(frontend: FrontendSummary): boolean {
  const shippedImpact = frontend.react18Matches.length > 0

  console.log("Frontend summary")
  console.log(`- Output: ${frontend.outputPath}`)
  console.log(`- Analyzer reports: ${frontend.analyzerReports.length > 0 ? frontend.analyzerReports.join(", ") : "none found"}`)
  console.log(`- Total shipped JS: ${formatBytes(frontend.totalJsBytes)}`)
  console.log(`- React 18 matches in shipped output: ${shippedImpact ? "yes" : "no"}`)

  if (frontend.react18Matches.length > 0) {
    for (const match of frontend.react18Matches.slice(0, 10)) {
      console.log(`  - ${match.marker} in ${match.evidencePath} (${formatBytes(match.sizeBytes)})`)
    }
  }

  console.log("")
  return shippedImpact
}

function printBackendSummary(artifacts: ArtifactSummary[]): boolean {
  const deployableMatches = artifacts.flatMap((artifact) =>
    artifact.matches.filter((match) => match.deployable)
  )
  const react18DeployableMatches = deployableMatches.filter(
    (match) => match.marker === "react@18" || match.marker === "react-dom@18"
  )

  console.log("Backend summary")
  console.log(`- Manifests inspected: ${artifacts.length > 0 ? new Set(artifacts.map((artifact) => artifact.artifactPath.split("/")[0])).size : 0}`)
  console.log(`- Deployable artifacts with React 18 evidence: ${react18DeployableMatches.length > 0 ? "yes" : "no"}`)

  if (react18DeployableMatches.length > 0) {
    const topMatches = [...react18DeployableMatches]
      .sort((left, right) => right.sizeBytes - left.sizeBytes)
      .slice(0, 10)

    for (const match of topMatches) {
      console.log(
        `  - ${match.marker} in ${match.evidencePath} (${formatBytes(match.sizeBytes)}; source: ${match.sourceHint})`
      )
    }
  }

  const grouped = new Map<string, number>()
  for (const match of deployableMatches) {
    if (match.marker !== "react@18" && match.marker !== "react-dom@18") {
      continue
    }

    const key = match.sourceHint
    grouped.set(key, (grouped.get(key) ?? 0) + match.sizeBytes)
  }

  if (grouped.size > 0) {
    console.log("- React 18 size by likely source:")
    for (const [sourceHint, sizeBytes] of Array.from(grouped.entries()).sort(
      (left, right) => right[1] - left[1]
    )) {
      console.log(`  - ${sourceHint}: ${formatBytes(sizeBytes)}`)
    }
  }

  console.log("")
  return react18DeployableMatches.length > 0
}

function main(): void {
  const frontend = analyzeFrontend()
  const manifestPaths = walkFiles(cdkOutDir).filter((filePath) => filePath.endsWith(".assets.json"))
  const artifacts = manifestPaths.flatMap((manifestPath) => analyzeManifest(manifestPath))

  const frontendImpact = printFrontendSummary(frontend)
  const backendImpact = printBackendSummary(artifacts)

  console.log("Artifact details")
  for (const artifact of artifacts) {
    console.log(
      `- ${artifact.artifactName} | ${artifact.artifactType} | deployable=${artifact.deployable ? "yes" : "no"} | path=${artifact.artifactPath}`
    )

    const relevantMatches = artifact.matches
      .filter((match) => match.marker === "react@18" || match.marker === "react-dom@18")
      .sort((left, right) => right.sizeBytes - left.sizeBytes)

    if (relevantMatches.length === 0) {
      console.log("  - no React 18 evidence")
      continue
    }

    for (const match of relevantMatches.slice(0, 10)) {
      console.log(
        `  - ${match.marker} | ${match.evidencePath} | ${formatBytes(match.sizeBytes)} | ${match.sourceHint}`
      )
    }
  }

  console.log("")
  console.log("Conclusion")
  console.log(`- Frontend shipped impact: ${frontendImpact ? "yes" : "no"}`)
  console.log(`- Backend shipped impact: ${backendImpact ? "yes" : "no"}`)
}

main()
