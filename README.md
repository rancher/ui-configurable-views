# ui-configurable-views

This repository contains **Configurable Views**, a Rancher UI Extension that lets people arrange
the Rancher Home page and each cluster's dashboard from widgets, keep several views of each page,
and switch between them. Their own views are saved to their account, and administrators can also
publish views.

## Repository structure

```
ui-configurable-views/
├── pkg/configurable-views/         # the extension package - this is what gets built
│   ├── index.ts                    # registers the pages, the header actions and the product
│   ├── package.json                # extension version + catalog annotations
│   ├── icon.svg                    # icon shown in the Extensions catalog
│   ├── README.md                   # description shown in the Extensions catalog
│   ├── pages/                      # Home, the cluster dashboard, Settings and the saved views
│   ├── components/                 # the views bar, the grid, the widgets and their settings
│   ├── composables/                # reading and saving views, paging, cluster stores
│   ├── templating/                 # the view model, layouts, widget catalog and data
│   └── l10n/en-us.yaml             # the extension's strings
├── scripts/bump-shell.mjs          # keeps @rancher/shell current, see bump-shell.yml
├── docs/RELEASING.md               # how a version is published
└── .github/workflows/              # build checks and releases
```

## Developing

Requires Node 24 (see `.nvmrc`) and Yarn 1.

```sh
yarn install
yarn build-pkg configurable-views   # build the extension into dist-pkg/
```

To work on it against a running Rancher, point the dev server at it:

```sh
API=https://<rancher> yarn dev
```

or serve the built package and load it as a UI extension:

```sh
yarn serve-pkgs
```

## Installing

Once released, install **Configurable Views** from **Extensions** in the Rancher UI. The extension
is marked `prime-only` and `experimental`, and requires Rancher 2.16 or newer.

## Automated workflows

- **build-extensions-test** (every pull request) checks the extension still builds.
- **build-extension-charts** (a version bump on `main`, a release, or by hand) publishes the Helm
  chart to the `gh-pages` branch, then checks a bundle actually landed.
- **build-extension-catalog** (a release, or by hand) publishes the extension catalog image to
  `ghcr.io`.
- **bump-shell** (daily) opens a pull request when a newer `@rancher/shell` is out, with
  `yarn.lock` and the `resolutions` taken from rancher/dashboard's at that shell release.
- **fossa** (every push to `main`) runs the FOSSA license scan.

## Releasing

See [docs/RELEASING.md](docs/RELEASING.md). In short: bump the version in **both** `package.json`
and `pkg/configurable-views/package.json`, and merging that bump publishes the Helm chart.

The release workflows call reusable workflows from `rancher/dashboard` pinned by SHA rather than
tracked at `@master`, since they run with write access to this repository's branches and packages.

License
=======
Copyright (c) 2014-2026 [SUSE](https://www.suse.com)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

[http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
