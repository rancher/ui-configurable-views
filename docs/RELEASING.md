# Releasing Configurable Views

This extension is released the same way as every other Rancher UI extension: publishing a GitHub
release with a specific tag name triggers two reusable workflows in `rancher/dashboard`, one
building a Helm chart on this repository's `gh-pages` branch and one a catalog image on `ghcr.io`.

The one-time setup below has been done; it stays here for reference.

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

4. **Check the release and pull request settings.** Release immutability can stay on: nothing is
   attached to a release after it is published. `bump-shell` opens its pull requests with the
   workflow token, which needs **Allow GitHub Actions to create and approve pull requests**
   (Settings → Actions → General).

## Cutting a release

1. **Bump the version in both files, in a pull request, and merge it.** They have to match.

   - `pkg/configurable-views/package.json` - the extension version, used for the chart
   - `package.json` (root) - used for the catalog image tag

   Merging publishes nothing.

2. **Publish a release on `main` tagged `configurable-views-<version>`.** In **Releases → Draft a
   new release**, type the tag and choose **Create new tag on publish**, set **Target** to `main`,
   choose the previous release's tag under **Previous tag**, select **Generate release notes**, then
   **Publish release**. Or:

   ```sh
   gh release create configurable-views-0.2.0 --repo rancher/ui-configurable-views \
     --target main --generate-notes --notes-start-tag configurable-views-0.1.0-main
   ```

3. **The release starts both workflows.** `build-extension-charts` builds the chart, commits it to
   `gh-pages` and checks a bundle landed; `build-extension-catalog` pushes the catalog image to
   `ghcr.io`.

The tag must be exactly `configurable-views-<version>`. The chart workflow checks it against
`pkg/configurable-views/package.json` and the catalog workflow against the root `package.json`; both
are named `configurable-views`, so one tag satisfies both while the versions match. A tag that
matches neither stops the run.

Both workflows trigger on `release: [released]`, so a **draft** or a **pre-release** publishes
nothing.

Releases are immutable once published: the title and notes can still be edited, but the tag can't be
moved and its name can't be used again, so check the tag and the target before publishing.

### The first release in this flow

0.1.0 was published before this flow, and its release is tagged on a `gh-pages` build commit, which
shares no history with `main`. For the next release, choose **`configurable-views-0.1.0-main`** as
the previous tag - it marks the `main` commit 0.1.0 was built from - or the generated notes list
every pull request since the start.

### Re-publishing something that built wrong

The publish script skips a version whose chart is already on `gh-pages`. Delete
`assets/configurable-views/configurable-views-<version>.tgz` from `gh-pages`, then run **Build and
Release Extension Charts** by hand from that version's release tag (**Run workflow → Use workflow
from → Tags**), so it builds exactly as the release did. Run it from the tag, not from `main`: a run
from a branch builds without the tag and leaves the root `index.yaml` as it was. A manual run of
**Build and Release Extension Catalog** from the same tag rebuilds the image.

## Verifying a release

1. Both workflow runs are green in Actions, including **A bundle exists for this version**.
2. `index.yaml` at the root of `gh-pages` lists the new version, with a URL under `assets/`.
3. The catalog image is visible at
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
