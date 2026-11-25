// Deploying the site's folder to Cloudflare (flows/site.md). Development only, beside site-dev.ts.
//
// A deploy is always of one commit, never of the folder as it lies: the commit is written out with
// `git archive`, so what goes up is exactly what git holds for it (nothing uncommitted, nothing
// git doesn't track), and Cloudflare is told the commit it came from. That is what makes a deploy
// something you can name, find again, and put back. The person's own `wrangler` sign-in does the
// uploading; nothing here holds a token.
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const run = promisify(execFile)
const SETTINGS = ".ohm/deploy.json", HISTORY = ".ohm/deploys.jsonl"
const LONG = { maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 }

/** The person's wrangler: one they name, the one beside the vault, or whatever `npx` finds. */
function wrangler(): [string, string[]] {
  const named = process.env.OHM_WRANGLER
  const beside = fileURLToPath(new URL("../vault/node_modules/.bin/wrangler", import.meta.url))
  if (named) return [named, []]
  return existsSync(beside) ? [beside, []] : ["npx", ["--yes", "wrangler"]]
}
const cloudflare = async (...args: string[]) => {
  const [command, first] = wrangler()
  return (await run(command, [...first, ...args], { ...LONG, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", WRANGLER_SEND_METRICS: "false" } })).stdout
}
const git = async (dir: string, ...args: string[]) => (await run("git", ["-C", dir, ...args], LONG)).stdout.trim()
const projectName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 58)

export type Deployed = { at: string; commit: string; subject: string; branch: string; project: string; url: string; production: boolean }

async function historyOf(dir: string): Promise<Deployed[]> {
  try { return (await readFile(join(dir, HISTORY), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line) as Deployed).reverse().slice(0, 12) } catch { return [] }
}

/** Where a deploy would go and what it would carry, without changing anything. */
export async function deployStatus(dir: string) {
  let settings: { project?: string; productionBranch?: string } = {}
  try { settings = JSON.parse(await readFile(join(dir, SETTINGS), "utf8")) } catch { /* not deployed from here yet */ }
  let domain = ""
  try { domain = (await readFile(join(dir, "CNAME"), "utf8")).trim() } catch { /* a site without its own domain */ }
  const [branch, commit, subject, changedText] = await Promise.all([
    git(dir, "rev-parse", "--abbrev-ref", "HEAD"), git(dir, "rev-parse", "HEAD"), git(dir, "log", "-1", "--format=%s"), git(dir, "status", "--porcelain", "--untracked-files=no"),
  ])
  // Who wrangler is signed in as, and the Pages projects that account has.
  let account = "", signedIn = false, projects: string[] = [], problem = ""
  try {
    const who = await cloudflare("whoami")
    signedIn = /logged in/i.test(who)
    account = /│\s*([^│]+?)\s*│\s*[0-9a-f]{32}\s*│/.exec(who)?.[1] ?? ""
    if (signedIn) projects = [...(await cloudflare("pages", "project", "list")).matchAll(/^│\s*([a-z0-9-]+)\s*│/gm)].map(m => m[1])
  } catch (e) { problem = ((e as { stderr?: string }).stderr || (e as Error).message).trim().split("\n").at(-1) ?? "" }
  const project = settings.project || projectName(domain || dir.split("/").at(-1) || "site")
  const productionBranch = settings.productionBranch || "main"
  return {
    signedIn, account, problem, projects, project, exists: projects.includes(project), productionBranch,
    branch, commit, subject, changed: changedText ? changedText.split("\n").length : 0, production: branch === productionBranch,
    domain, history: await historyOf(dir),
  }
}

/**
 * Deploy one commit to a Cloudflare Pages project: this branch's head, or an earlier commit to put
 * it back. The project is made the first time. Returns where it is now served.
 */
export async function deploy(dir: string, input: { project: string; commit?: string }): Promise<Deployed> {
  const project = projectName(input.project)
  if (!project) throw new Error("Give the Cloudflare project a name")
  const status = await deployStatus(dir)
  if (!status.signedIn) throw new Error("Sign in to Cloudflare first: run `npx wrangler login` in a terminal")
  const commit = await git(dir, "rev-parse", "--verify", `${input.commit || "HEAD"}^{commit}`)
  if (!input.commit && status.changed) throw new Error("Commit your changes first: a deploy is of a commit, so what is uncommitted would be left behind")
  const subject = await git(dir, "log", "-1", "--format=%s", commit)
  // Putting an earlier commit back is a deploy to production, whatever branch is checked out.
  const branch = input.commit ? status.productionBranch : status.branch

  const out = await mkdtemp(join(tmpdir(), "ohm-deploy-"))
  try {
    await run("sh", ["-c", 'git -C "$SITE" archive "$COMMIT" | tar -x -C "$OUT"'], { ...LONG, env: { ...process.env, SITE: dir, COMMIT: commit, OUT: out } })
    if (!status.projects.includes(project)) await cloudflare("pages", "project", "create", project, "--production-branch", status.productionBranch)
    const said = await cloudflare("pages", "deploy", out, "--project-name", project, "--branch", branch, "--commit-hash", commit, "--commit-message", subject.slice(0, 180), "--commit-dirty=false")
    const url = [...said.matchAll(/https:\/\/[a-z0-9.-]+\.pages\.dev/g)].at(-1)?.[0]
    if (!url) throw new Error(said.trim().split("\n").at(-1) || "Cloudflare didn't say where it deployed")
    const deployed: Deployed = { at: new Date().toISOString(), commit, subject, branch, project, url, production: branch === status.productionBranch }
    await mkdir(join(dir, ".ohm"), { recursive: true })
    await writeFile(join(dir, SETTINGS), `${JSON.stringify({ project, productionBranch: status.productionBranch }, null, 2)}\n`)
    await appendFile(join(dir, HISTORY), `${JSON.stringify(deployed)}\n`)
    return deployed
  } catch (e) {
    throw new Error(((e as { stderr?: string }).stderr || (e as Error).message).trim().split("\n").filter(Boolean).at(-1))
  } finally {
    await rm(out, { recursive: true, force: true })
  }
}
