import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import jsyaml from 'js-yaml';
import {
  AGENT_CONFIG, MANAGED_BY, MANAGED_BY_LABEL, REVISION_ANNOTATION, connectionOf, decide, installLizAgents, revisionOf, type AgentConfig
} from '@pkg/configurable-views/templating/liz-agents';

// Jest has no loader for the agent files, so the package's imports of them get these; the files
// themselves are read further down, as YAML.
jest.mock('@pkg/configurable-views/agents/views-builder.aiagentconfig.yaml', () => ({
  __esModule: true,
  default:    {
    metadata: {
      name: 'views-builder', namespace: 'cattle-ai-agent-system', labels: { 'app.kubernetes.io/managed-by': 'configurable-views' }, annotations: { 'templates.rancher.io/agent-revision': '2' }
    },
    spec: {
      displayName: 'Views Builder', enabled: true, systemPrompt: 'new'
    },
  },
}));
jest.mock('@pkg/configurable-views/agents/widget-builder.aiagentconfig.yaml', () => ({
  __esModule: true,
  default:    {
    metadata: {
      name: 'widget-builder', namespace: 'cattle-ai-agent-system', labels: { 'app.kubernetes.io/managed-by': 'configurable-views' }, annotations: { 'templates.rancher.io/agent-revision': '1' }
    },
    spec: {
      displayName: 'Widget Builder', enabled: true, systemPrompt: 'widgets'
    },
  },
}));

const agent = (name: string, revision?: number, spec: Record<string, unknown> = {}): AgentConfig => ({
  metadata: {
    name, namespace: 'cattle-ai-agent-system', annotations: revision === undefined ? {} : { [REVISION_ANNOTATION]: String(revision) }
  },
  spec: {
    displayName: name, enabled: true, ...spec
  },
});

interface Stored extends AgentConfig {
  canUpdate?: boolean;
  save: jest.Mock;
}

/**
 * A management store with Liz's type (or not), the given agent configs, and what was saved. `find` answers
 * as Steve does: a 404 for none.
 */
function storeWith(stored: Record<string, Partial<Stored>> = {}, {
  liz = true, post = true, findError = null as unknown, saveError = null as unknown
} = {}) {
  const saved: AgentConfig[] = [];
  const save = (model: AgentConfig) => jest.fn(() => {
    if (saveError) {
      return Promise.reject(saveError);
    }
    saved.push(JSON.parse(JSON.stringify(model)));

    return Promise.resolve(model);
  });
  const getters = { 'management/schemaFor': (type: string) => (liz && type === AGENT_CONFIG ? { collectionMethods: post ? ['GET', 'POST'] : ['GET'] } : undefined) };
  const dispatch = jest.fn((action: string, spec: Record<string, unknown>) => {
    if (action === 'management/find') {
      if (findError) {
        return Promise.reject(findError);
      }
      const found = stored[String(spec.id).split('/')[1]];

      return found ? Promise.resolve({ canUpdate: true, ...found }) : Promise.reject(Object.assign(new Error('Not Found'), { _status: 404, code: 'NotFound' }));
    }
    if (action === 'management/create') {
      const model = { metadata: spec.metadata, spec: spec.spec } as AgentConfig & { save?: jest.Mock };

      model.save = save(model);

      return Promise.resolve(model);
    }
    if (action === 'management/clone') {
      const model = JSON.parse(JSON.stringify(spec.resource)) as AgentConfig & { save?: jest.Mock };

      model.save = save(model);

      return Promise.resolve(model);
    }

    return Promise.reject(new Error(`unexpected ${ action }`));
  });

  return {
    store: { getters, dispatch } as never, dispatch, saved
  };
}

describe('liz-agents', () => {
  describe('decide', () => {
    it.each([
      ['none in Rancher', null, 'create'],
      ['one with no revision, applied by hand', agent('a'), 'update'],
      ['an older one', agent('a', 1), 'update'],
      ['the same one', agent('a', 2), 'current'],
      ['a newer one', agent('a', 3), 'newer'],
      ['one built into Liz', agent('a', 0, { builtIn: true }), 'builtIn'],
      ['one built into Liz, even an older one', agent('a', 1, { builtIn: true }), 'builtIn'],
    ])('%s: %s', (_, theirs, expected) => {
      expect(decide(agent('a', 2), theirs as AgentConfig | null)).toBe(expected);
    });

    it('reads a revision that is not a positive number as none', () => {
      expect(revisionOf({
        metadata: {
          name: 'a', namespace: 'n', annotations: { [REVISION_ANNOTATION]: 'x' }
        }
      })).toBe(0);
      expect(revisionOf({
        metadata: {
          name: 'a', namespace: 'n', annotations: { [REVISION_ANNOTATION]: '-4' }
        }
      })).toBe(0);
    });
  });

  describe('installLizAgents', () => {
    it('does nothing where Liz is not installed', async() => {
      const { store, dispatch } = storeWith({}, { liz: false });

      expect(await installLizAgents(store)).toStrictEqual({
        liz: 'missing', allowed: false, results: []
      });
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('does nothing for someone who may not add agent configs', async() => {
      const { store, dispatch } = storeWith({}, { post: false });

      expect(await installLizAgents(store)).toStrictEqual({
        liz: 'present', allowed: false, results: []
      });
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('adds the agents that are not there, with the label and revision of the file', async() => {
      const { store, saved } = storeWith();
      const status = await installLizAgents(store);

      expect(status.results.map((r) => [r.name, r.state])).toStrictEqual([['views-builder', 'installed'], ['widget-builder', 'installed']]);
      expect(saved[0].metadata.labels).toStrictEqual({ [MANAGED_BY_LABEL]: MANAGED_BY });
      expect(saved[0].metadata.annotations).toStrictEqual({ [REVISION_ANNOTATION]: '2' });
      expect(saved[0].spec).toStrictEqual({
        displayName: 'Views Builder', enabled: true, systemPrompt: 'new'
      });
    });

    it('replaces an older copy, keeping whether an admin turned it off and what else it carries', async() => {
      const { store, saved } = storeWith({
        'views-builder': {
          metadata: {
            name: 'views-builder', namespace: 'cattle-ai-agent-system', labels: { team: 'x' }, annotations: { [REVISION_ANNOTATION]: '1', note: 'kept' }
          },
          spec: {
            displayName: 'Old', enabled: false, systemPrompt: 'old'
          },
          status: { phase: 'Ready' },
        },
        'widget-builder': agent('widget-builder', 1),
      });
      const status = await installLizAgents(store);

      expect(status.results.map((r) => [r.name, r.state, r.phase])).toStrictEqual([['views-builder', 'updated', 'Ready'], ['widget-builder', 'current', undefined]]);
      expect(saved).toHaveLength(1);
      expect(saved[0].spec).toStrictEqual({
        displayName: 'Views Builder', enabled: false, systemPrompt: 'new'
      });
      expect(saved[0].metadata.labels).toStrictEqual({ team: 'x', [MANAGED_BY_LABEL]: MANAGED_BY });
      expect(saved[0].metadata.annotations).toStrictEqual({ [REVISION_ANNOTATION]: '2', note: 'kept' });
    });

    it('leaves a newer copy and one built into Liz as they are', async() => {
      const { store, saved } = storeWith({ 'views-builder': agent('views-builder', 5), 'widget-builder': agent('widget-builder', 0, { builtIn: true }) });
      const status = await installLizAgents(store);

      expect(status.results.map((r) => r.state)).toStrictEqual(['newer', 'builtIn']);
      expect(saved).toHaveLength(0);
    });

    it('says so for an older copy it may not change, and changes nothing', async() => {
      const { store, saved } = storeWith({ 'views-builder': { ...agent('views-builder', 1), canUpdate: false }, 'widget-builder': agent('widget-builder', 1) });
      const status = await installLizAgents(store);

      expect(status.results[0].state).toBe('notAllowed');
      expect(saved).toHaveLength(0);
    });

    it('reports a read or a write that failed, and never rejects', async() => {
      const read = await installLizAgents(storeWith({}, { findError: { _status: 500, message: 'boom' } }).store);
      const write = await installLizAgents(storeWith({}, { saveError: { message: 'denied' } }).store);

      expect(read.results.map((r) => [r.state, r.error])).toStrictEqual([['failed', 'boom'], ['failed', 'boom']]);
      expect(write.results.map((r) => [r.state, r.error])).toStrictEqual([['failed', 'denied'], ['failed', 'denied']]);
    });
  });

  describe('ensureLizAgents', () => {
    it('checks once each time Rancher loads, and again when asked, keeping the result for Settings', async() => {
      // The module as Rancher loads it: nothing checked yet
      jest.resetModules();
      const { ensureLizAgents, lizAgentStatus } = await import('@pkg/configurable-views/templating/liz-agents');
      const { store, dispatch } = storeWith();
      // Each read of an agent, and whether it went past the store's copy
      const reads = () => dispatch.mock.calls.filter(([action]) => action === 'management/find').map(([, spec]) => {
        const { id, opt } = spec as { id: string, opt: { force?: boolean } };

        return [id.split('/')[1], !!opt.force];
      });

      expect(lizAgentStatus.value.liz).toBe('unknown');

      await Promise.all([ensureLizAgents(store), ensureLizAgents(store)]);

      expect(reads()).toStrictEqual([['rancher', false], ['views-builder', false], ['widget-builder', false]]);
      expect(lizAgentStatus.value.results.map((r) => r.state)).toStrictEqual(['installed', 'installed']);

      // Check again, on Settings: everything read afresh, as something may have changed since
      dispatch.mockClear();
      await ensureLizAgents(store, { again: true });
      expect(reads()).toStrictEqual([['rancher', true], ['views-builder', true], ['widget-builder', true]]);
    });
  });

  describe("the connection, from Liz's own agent", () => {
    const CA = { key: 'tls.crt', name: 'cattle-mcp-ca' };
    const core = (spec: Record<string, unknown>) => ({ ...agent('rancher', 0, { builtIn: true, ...spec }) });

    it('reads only the connection fields it has', () => {
      expect(connectionOf(core({
        authenticationType: 'RANCHER', caBundleRef: CA, systemPrompt: 'hers'
      }))).toStrictEqual({ authenticationType: 'RANCHER', caBundleRef: CA });
      expect(connectionOf(core({ authenticationType: 'RANCHER' }))).toStrictEqual({ authenticationType: 'RANCHER' });
      expect(connectionOf(null)).toBeNull();
    });

    it('adds and replaces the agents with it', async() => {
      const { store, saved } = storeWith({ rancher: core({ authenticationType: 'RANCHER', caBundleRef: CA }), 'widget-builder': agent('widget-builder', 0) });
      const status = await installLizAgents(store);

      expect(status.results.map((r) => r.state)).toStrictEqual(['installed', 'updated']);
      expect(saved.map((a) => [a.metadata.name, a.spec.authenticationType, a.spec.caBundleRef])).toStrictEqual([
        ['views-builder', 'RANCHER', CA],
        ['widget-builder', 'RANCHER', CA],
      ]);
    });

    it('updates only the connection of a copy that is otherwise current, or newer', async() => {
      const { store, saved } = storeWith({
        rancher:          core({ authenticationType: 'RANCHER', caBundleRef: CA }),
        'views-builder':  agent('views-builder', 2, { authenticationType: 'RANCHER', systemPrompt: 'as it is' }),
        'widget-builder': agent('widget-builder', 9, { authenticationType: 'RANCHER', systemPrompt: 'newer' }),
      });
      const status = await installLizAgents(store);

      expect(status.results.map((r) => r.state)).toStrictEqual(['connected', 'connected']);
      expect(saved.map((a) => a.spec)).toStrictEqual([
        {
          displayName: 'views-builder', enabled: true, authenticationType: 'RANCHER', systemPrompt: 'as it is', caBundleRef: CA
        },
        {
          displayName: 'widget-builder', enabled: true, authenticationType: 'RANCHER', systemPrompt: 'newer', caBundleRef: CA
        },
      ]);
    });

    it("changes nothing where Liz's own agent has no CA bundle, or cannot be read", async() => {
      const withoutCa = storeWith({
        rancher: core({ authenticationType: 'RANCHER' }), 'views-builder': agent('views-builder', 2, { authenticationType: 'RANCHER' }), 'widget-builder': agent('widget-builder', 1)
      });
      const unreadable = storeWith({ 'views-builder': agent('views-builder', 2), 'widget-builder': agent('widget-builder', 1) });

      expect((await installLizAgents(withoutCa.store)).results.map((r) => r.state)).toStrictEqual(['current', 'connected']);
      expect(withoutCa.saved.map((a) => [a.metadata.name, a.spec.authenticationType, a.spec.caBundleRef])).toStrictEqual([['widget-builder', 'RANCHER', undefined]]);
      expect((await installLizAgents(unreadable.store)).results.map((r) => r.state)).toStrictEqual(['current', 'current']);
      expect(unreadable.saved).toHaveLength(0);
    });

    it("takes off a CA bundle Liz's own agent no longer has", async() => {
      const { store, saved } = storeWith({
        rancher:         core({ authenticationType: 'RANCHER' }),
        'views-builder': agent('views-builder', 2, {
          authenticationType: 'RANCHER', caBundleRef: CA, systemPrompt: 'as it is'
        }),
        'widget-builder': agent('widget-builder', 1, { authenticationType: 'RANCHER' }),
      });

      expect((await installLizAgents(store)).results.map((r) => r.state)).toStrictEqual(['connected', 'current']);
      expect(saved[0].spec).toStrictEqual({
        displayName: 'views-builder', enabled: true, authenticationType: 'RANCHER', systemPrompt: 'as it is'
      });
    });

    it('does not change the connection of a copy it may not change', async() => {
      const { store, saved } = storeWith({
        rancher: core({ authenticationType: 'RANCHER', caBundleRef: CA }), 'views-builder': { ...agent('views-builder', 2), canUpdate: false }, 'widget-builder': agent('widget-builder', 1, { caBundleRef: CA, authenticationType: 'RANCHER' })
      });

      expect((await installLizAgents(store)).results.map((r) => r.state)).toStrictEqual(['notAllowed', 'current']);
      expect(saved).toHaveLength(0);
    });
  });

  // The files themselves: what an admin applies by hand, and what the package installs
  describe('the agent files', () => {
    const dir = path.resolve(__dirname, '../../agents');
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.aiagentconfig.yaml')).sort();
    const docs = files.map((name) => jsyaml.load(fs.readFileSync(path.join(dir, name), 'utf8')) as AgentConfig & { apiVersion: string; kind: string });

    // A change to an agent's spec needs a higher revision, or a copy already in Rancher is never
    // replaced. Change the spec, raise the revision in the file, then record both here.
    const RECORDED: Record<string, { revision: number; sha256: string }> = {
      'views-builder':  { revision: 3, sha256: 'aee23893ed1a9641cc27294751a3071046cc522f54eddfe955cc27fc5e49bceb' },
      'widget-builder': { revision: 2, sha256: '2a971be84ccc0ca70bf233abd5650b42fb69a5ea580003d38ade8a6eb22c27d8' },
    };

    it('are the two agents, each in Liz\'s namespace, marked as this package\'s', () => {
      expect(docs.map((d) => [d.apiVersion, d.kind, d.metadata.name, d.metadata.namespace, d.metadata.labels?.[MANAGED_BY_LABEL]])).toStrictEqual([
        ['ai.cattle.io/v1alpha1', 'AIAgentConfig', 'views-builder', 'cattle-ai-agent-system', MANAGED_BY],
        ['ai.cattle.io/v1alpha1', 'AIAgentConfig', 'widget-builder', 'cattle-ai-agent-system', MANAGED_BY],
      ]);
    });

    it('ask before they save anything', () => {
      docs.forEach((d) => expect(d.spec.humanValidationTools).toStrictEqual(['createKubernetesResource', 'patchKubernetesResource']));
    });

    it('carry the revision their spec was recorded with', () => {
      const now = Object.fromEntries(docs.map((d) => [d.metadata.name, {
        revision: revisionOf(d),
        sha256:   crypto.createHash('sha256').update(JSON.stringify(d.spec)).digest('hex'),
      }]));

      expect(now).toStrictEqual(RECORDED);
    });
  });
});
