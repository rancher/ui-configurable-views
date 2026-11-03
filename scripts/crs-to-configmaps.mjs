#!/usr/bin/env node
/* eslint-disable no-console */
// One-shot: convert the CustomView/HomeTemplate example CRs into labeled ConfigMaps (the new
// storage). Overwrites the example files in place.
//
//   node scripts/crs-to-configmaps.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'pkg/ai-templating/examples');

const MARKER = 'templates.rancher.io/ai-templating';
const TYPE = 'templates.rancher.io/type';

function toConfigMap(doc) {
  const meta = doc.metadata || {};
  const spec = doc.spec || {};

  if (doc.kind === 'CustomView') {
    const data = { kind: spec.kind || 'code' };

    if (spec.source) {
      data['view.vue'] = spec.source;
    }
    if (spec.meta) {
      data.meta = JSON.stringify(spec.meta);
    }
    if (spec.nav) {
      data.nav = JSON.stringify(spec.nav);
    }
    if (spec.template) {
      data.template = JSON.stringify(spec.template);
    }

    return {
      apiVersion: 'v1',
      kind:       'ConfigMap',
      metadata:   { name: meta.name, namespace: meta.namespace || 'default', labels: { [MARKER]: 'true', [TYPE]: 'custom-view' } },
      data,
    };
  }

  if (doc.kind === 'HomeTemplate') {
    return {
      apiVersion: 'v1',
      kind:       'ConfigMap',
      metadata:   { name: meta.name, namespace: meta.namespace || 'default', labels: { [MARKER]: 'true', [TYPE]: 'home-template' } },
      data:       { displayName: spec.displayName || meta.name, 'view.vue': spec.source || '' },
    };
  }

  return null; // drop CRDs / TemplatingConfig / anything else
}

for (const file of ['persona-examples.yaml', 'creative-examples.yaml']) {
  const p = path.join(dir, file);

  if (!fs.existsSync(p)) {
    continue;
  }

  const docs = yaml.loadAll(fs.readFileSync(p, 'utf8')).filter(Boolean);
  const cms = docs.map(toConfigMap).filter(Boolean);
  const header = `# ${ file.replace('.yaml', '') } — labeled ConfigMaps (AI Templating storage).\n#   kubectl apply -f ${ file }\n`;
  const body = cms.map((cm) => yaml.dump(cm, { lineWidth: -1, noRefs: true })).join('---\n');

  fs.writeFileSync(p, `${ header }---\n${ body }`);
  console.log(`converted ${ file }: ${ cms.length } ConfigMaps`);
}
