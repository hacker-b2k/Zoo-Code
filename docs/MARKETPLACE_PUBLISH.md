# Marketplace Publish Setup

This fork publishes the VS Code extension as:

- **Publisher:** `ZooCodeOrganization`
- **Extension name:** `zoo-code`
- **Item:** `ZooCodeOrganization.zoo-code`

## Why the pre-release deploy failed

Failed run (example): [Publish Pre-release Extension #1](https://github.com/hacker-b2k/Zoo-Code/actions/runs/29723609703)

Evidence from that run:

1. Checkout / install / build / package / VSIX validation: **success**
2. Publish step: **failure**
3. Exact Azure Marketplace error:

```text
The Personal Access Token verification has failed.
Additional information: TF400813: The user 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
is not authorized to access this resource.
```

That dummy GUID almost always means:

- `VSCE_PAT` secret is missing, empty, expired, or
- the PAT is valid for a different publisher / Azure org and cannot publish as `ZooCodeOrganization`.

## Secrets required

### Environment: `marketplace-prerelease` (pre-release)

| Secret            | Required | Purpose                                         |
| ----------------- | -------- | ----------------------------------------------- |
| `VSCE_PAT`        | **Yes**  | Azure DevOps PAT with **Marketplace → Publish** |
| `POSTHOG_API_KEY` | Optional | Telemetry key baked into package                |

### Environment: `marketplace-production` (stable)

| Secret            | Required         | Purpose                |
| ----------------- | ---------------- | ---------------------- |
| `VSCE_PAT`        | **Yes**          | Same as above          |
| `OVSX_PAT`        | Yes for Open VSX | Open VSX publish token |
| `POSTHOG_API_KEY` | Optional         | Telemetry key          |

## Create a correct VSCE_PAT

1. Sign in to Azure DevOps as the account that owns / can publish for **ZooCodeOrganization**.
2. User settings → Personal access tokens → New token.
3. Organization: the Azure org linked to the VS Marketplace publisher.
4. Scopes: **Marketplace → Manage** (or at least **Publish**).
5. Create token and copy it once.

## Install the secret on this GitHub repo

GitHub → `hacker-b2k/Zoo-Code` → **Settings** → **Environments** → **marketplace-prerelease**

Add secret:

```text
Name:  VSCE_PAT
Value: <the Azure DevOps PAT>
```

Also add the same secret under **marketplace-production** if you publish stable releases.

Repository-level secret with the same name also works if the environment is configured to inherit it, but environment secret is preferred.

## Publish pre-release (after secret is set)

Pre-release is **manual** so ordinary `main` baseline syncs do not create failed deployments.

1. Ensure `main` has the code you want to publish.
2. GitHub → **Actions** → **Publish Pre-release Extension**
3. **Run workflow** → branch **main**
4. Confirm green deployment under **Deployments → marketplace-prerelease**

## Verify locally (optional)

```bash
# package only (no publish)
pnpm --filter @roo-code/build build
pnpm --filter @roo-code/vscode-webview build
pnpm --filter ./src exec vsce package --pre-release --no-dependencies --out ../bin

# publish only if you have a real PAT in your shell
export VSCE_PAT=...   # never commit this
npx @vscode/vsce publish --pre-release --packagePath bin/zoo-code-<version>.vsix
```

## Important

- A GitHub token is **not** a `VSCE_PAT`.
- The PAT must be allowed to publish as **`ZooCodeOrganization`**.
- If you do not control that publisher, either get access or change publisher identity via a deliberate product decision (not done by this fix).
