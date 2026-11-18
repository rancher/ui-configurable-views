# Releasing Configurable Views

This extension is released the same way as Rancher's other UI extensions: two reusable workflows
in `rancher/dashboard` build it, one into a Helm chart on this repository's `gh-pages` branch and
one into a catalog image on `ghcr.io`.

Nothing has been released from this repository yet, so the one-time setup below has to be done
before the first release.

## One-time setup

These need repository admin and only have to be done once.

1. **Create the `gh-pages` branch.** `build-extension-charts` checks this branch out and commits
   the built chart into it. If the branch does not exist, the publish script stops.

   ```sh
   git checkout --orphan gh-pages
   git rm -rf .
   echo "Helm repository for Configurable Views." > README.md
   git add README.md && git commit -m "Initialise gh-pages"
   git push origin gh-pages
   git checkout main
   ```

2. **Enable GitHub Pages**, serving from the `gh-pages` branch, root folder. This is what makes the
   Helm repository reachable at `https://rancher.github.io/ui-configurable-views/`, which is the URL
   users add under **Extensions → Manage Repositories** in Rancher.

3. **Check Actions permissions.** Both workflows need `contents: write` and the catalog workflow
   needs `packages: write` to push to `ghcr.io`. They request these themselves, but the repository's
   default workflow permissions must allow it (Settings → Actions → General → Workflow permissions).
   Pull requests from forks also have to be allowed to run workflows, or `build-extensions-test`
   never runs on them.

## Cutting a release

**Bump the version in both files - they have to match.**

- `pkg/configurable-views/package.json` - the extension version, used for the chart
- `package.json` (root) - used for the catalog image tag

The two release workflows check the release tag against different files: the chart against
`pkg/configurable-views/package.json` and the catalog against the root `package.json`. Both are
named `configurable-views`, so one tag, `configurable-views-<version>`, satisfies both while the
versions match. If they drift apart, no tag can, and the job whose version does not match cancels
itself rather than failing.

### Publishing the chart - merge the bump

`build-extension-charts` runs on any push to `main` that touches
`pkg/configurable-views/package.json`, so merging the version bump is the whole of publishing the
chart. Bumping the number *is* the release.

It refuses to republish: before building, it reads `index.yaml` from `gh-pages` and stops if that
version is already there. That guard matters because the trigger fires on any edit to the file - a
change to the catalog annotations alone must not republish the same version with different contents
inside it.

The chart step also creates the GitHub release `configurable-views-<version>` itself, tagged on
`gh-pages`. A release made by the workflow's own token does not start other workflows, so this path
does **not** build the catalog image, and a release for the same version cannot be cut by hand
afterwards because it already exists.

### Publishing the catalog image - run it by hand

If air-gapped installs need this version, run **Build and Release Extension Catalog** from the
Actions tab on `main` once the bump has merged. A manual run passes no tag, so it builds whatever
version `package.json` names.

### Publishing both from a release

Publishing a release tagged `configurable-views-<version>` on `main` runs both workflows. Merging
the bump already publishes the chart and creates that release, so this is only for a version whose
chart run did not get that far. Both workflows trigger on `release: [released]`, so a **draft**
release publishes nothing.

### Re-publishing something that built wrong

Both workflows can be run by hand from the Actions tab. A manual run passes no tag, so it builds
whatever version `package.json` currently names. For the chart, delete that version from `gh-pages`
first or the version check will decline to rebuild it.

## Verifying a release

1. The workflow runs are green in Actions, including **A bundle exists for this version**.
2. `index.yaml` on the `gh-pages` branch lists the new version.
3. For a catalog image, the package is visible at
   `https://github.com/orgs/rancher/packages?repo_name=ui-configurable-views`.
4. In a Rancher Prime 2.16+ install, add `https://rancher.github.io/ui-configurable-views/` under
   **Extensions → Manage Repositories**, then confirm **Configurable Views** appears in the
   Extensions list at the new version, and that after installing it the views bar opens on the
   Home page with **Shift+V**.

## Notes

- The extension is annotated `prime-only`, so it is only offered on Rancher Prime, and
  `experimental`, so the Extensions list marks it as such.
- `catalog.cattle.io/rancher-version` is `>= 2.16.0-0`. The `-0` suffix matters: without it, Helm's
  semver matching excludes every prerelease, and the extension would be hidden on Rancher RC builds.
