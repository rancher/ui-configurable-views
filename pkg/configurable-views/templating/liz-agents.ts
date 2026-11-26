// Liz's two agents for this package - the views builder and the widget builder - added to Liz by the
// package itself, so nobody has to apply them by hand.
//
// Their files in agents/ are the source: what an admin can still apply with kubectl, imported here as
// they are. When someone who may create Liz's agent configs opens a configurable page or Settings, each
// agent is checked once each time Rancher loads, and a copy in Rancher is only ever replaced by a newer one:
//
//   none in Rancher                         -> created
//   one with a lower revision (or none)     -> replaced, keeping whether an admin turned it off
//   the same revision, or a higher one      -> left as it is
//   one built into Liz                      -> left as it is (Liz ships it)
//
// How they reach Rancher's MCP server is Liz's own agent's (`rancher`, built into her): its
// authenticationType, and its caBundleRef where Rancher's certificate is one Liz must be told to trust.
// Ours are created and replaced with them, and a copy that is otherwise current has just those two
// updated when Liz's change. Without the CA bundle a Rancher with a self-signed certificate answers
// every tool call with "certificate verify failed".
//
// Nothing happens where Liz is not installed (no AIAgentConfig type), nor for anyone who may not create
// one. Uninstalling the package leaves the agents in place: the package is unloaded at every log out as
// well, when nothing may be removed. They carry the managed-by label, for an admin who removes them.

import { ref } from 'vue';
import type { VuexStore } from '@shell/types/store/vuex';
import { clone } from '@shell/utils/object';
import type { KubeMetadata } from '@shell/types/kube/kube-api';
import viewsBuilder from '../agents/views-builder.aiagentconfig.yaml';
import widgetBuilder from '../agents/widget-builder.aiagentconfig.yaml';

type Getters = VuexStore['getters'];

/** Liz's agent configs, as Steve names the type */
export const AGENT_CONFIG = 'ai.cattle.io.aiagentconfig';
export const MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by';
export const MANAGED_BY = 'configurable-views';
export const REVISION_ANNOTATION = 'templates.rancher.io/agent-revision';

/** Liz's own agent, built into her: where her agents' connection to the MCP server is set up */
export const CORE_AGENT = { namespace: 'cattle-ai-agent-system', name: 'rancher' };

/** How an agent reaches the MCP server, taken from Liz's own agent */
export const CONNECTION_FIELDS = ['authenticationType', 'caBundleRef'] as const;

export type Connection = Partial<Record<typeof CONNECTION_FIELDS[number], unknown>>;

export interface AgentConfig {
  metadata: KubeMetadata & { namespace: string };
  spec: Record<string, unknown> & { displayName: string; enabled?: boolean; builtIn?: boolean };
  status?: { phase?: string };
}

interface AgentModel extends AgentConfig {
  canUpdate?: boolean;
  save(): Promise<unknown>;
}

export const AGENTS: AgentConfig[] = [viewsBuilder as AgentConfig, widgetBuilder as AgentConfig];

/** What happened to an agent: just created or replaced, already there, left alone, or not written */
export type AgentState = 'installed' | 'updated' | 'connected' | 'current' | 'newer' | 'builtIn' | 'notAllowed' | 'failed';

export interface AgentResult {
  name: string;
  displayName: string;
  state: AgentState;
  /** Liz's word for it, from the copy in Rancher: Ready once she has loaded it */
  phase?: string;
  error?: string;
}

/** Where things stand since Rancher loaded: not checked yet, no Liz here, no access, or each agent's result */
export interface AgentStatus {
  liz: 'unknown' | 'missing' | 'present';
  allowed: boolean;
  results: AgentResult[];
}

export const revisionOf = (agent: Pick<AgentConfig, 'metadata'> | null | undefined): number => {
  const value = Number(agent?.metadata?.annotations?.[REVISION_ANNOTATION]);

  return Number.isFinite(value) && value > 0 ? value : 0;
};

/** What to do with ours, given the copy in Rancher (none: null) */
export function decide(ours: AgentConfig, theirs: AgentConfig | null): 'create' | 'update' | 'current' | 'newer' | 'builtIn' {
  if (!theirs) {
    return 'create';
  }
  if (theirs.spec?.builtIn) {
    return 'builtIn';
  }
  const mine = revisionOf(ours);
  const stored = revisionOf(theirs);

  if (stored < mine) {
    return 'update';
  }

  return stored === mine ? 'current' : 'newer';
}

/** The connection fields Liz's own agent has: none of them where it could not be read */
export function connectionOf(core: Pick<AgentConfig, 'spec'> | null | undefined): Connection {
  const out: Connection = {};

  CONNECTION_FIELDS.forEach((field) => {
    if (core?.spec?.[field] !== undefined) {
      out[field] = clone(core.spec[field]);
    }
  });

  return out;
}

/** The fields of `connection` that a copy in Rancher has otherwise */
export function connectionChanges(theirs: Pick<AgentConfig, 'spec'>, connection: Connection): Connection {
  const out: Connection = {};

  (Object.keys(connection) as (keyof Connection)[]).forEach((field) => {
    if (JSON.stringify(theirs.spec?.[field]) !== JSON.stringify(connection[field])) {
      out[field] = connection[field];
    }
  });

  return out;
}

const isNotFound = (e: unknown): boolean => {
  const err = e as { _status?: number; status?: number; code?: string } | null;

  return err?._status === 404 || err?.status === 404 || err?.code === 'NotFound';
};

const messageOf = (e: unknown): string => {
  const err = e as { message?: string; _statusText?: string } | null;

  return err?.message || err?._statusText || String(e);
};

/** Whether Liz is installed here, and whether the person signed in may add her agents */
export function lizAccess(getters: Getters): { liz: boolean; allowed: boolean } {
  const schema = getters['management/schemaFor']?.(AGENT_CONFIG) as { collectionMethods?: string[] } | undefined;

  return {
    liz:     !!schema,
    allowed: !!schema?.collectionMethods?.some((method) => method.toUpperCase() === 'POST'),
  };
}

/** Liz's own agent, or null where it is not there or not readable */
async function findCore(store: VuexStore): Promise<AgentConfig | null> {
  try {
    return await store.dispatch('management/find', {
      type: AGENT_CONFIG, id: `${ CORE_AGENT.namespace }/${ CORE_AGENT.name }`, opt: { watch: false }
    });
  } catch (e) {
    return null;
  }
}

async function installOne(store: VuexStore, ours: AgentConfig, connection: Connection): Promise<AgentResult> {
  const { name, namespace } = ours.metadata;
  const base = { name, displayName: ours.spec.displayName };
  const spec = { ...clone(ours.spec), ...clone(connection) };
  let theirs: AgentModel | null = null;

  // Read from the store's copy when it has one: installing an extension takes a reload, which empties it
  try {
    theirs = await store.dispatch('management/find', {
      type: AGENT_CONFIG, id: `${ namespace }/${ name }`, opt: { watch: false }
    });
  } catch (e) {
    if (!isNotFound(e)) {
      return {
        ...base, state: 'failed', error: messageOf(e)
      };
    }
  }

  const action = decide(ours, theirs);

  try {
    if (action === 'create') {
      const created: AgentModel = await store.dispatch('management/create', {
        type: AGENT_CONFIG, metadata: clone(ours.metadata), spec
      });

      await created.save();

      return {
        ...base, state: 'installed', phase: created.status?.phase
      };
    }

    if (action === 'update' && theirs) {
      if (!theirs.canUpdate) {
        return {
          ...base, state: 'notAllowed', phase: theirs.status?.phase
        };
      }
      // Changed on a copy, so a write that fails leaves the store's copy as it was
      const copy: AgentModel = await store.dispatch('management/clone', { resource: theirs });

      copy.spec = { ...spec, enabled: theirs.spec?.enabled ?? ours.spec.enabled };
      copy.metadata.labels = { ...(theirs.metadata.labels || {}), ...(ours.metadata.labels || {}) };
      copy.metadata.annotations = { ...(theirs.metadata.annotations || {}), ...(ours.metadata.annotations || {}) };
      await copy.save();

      return {
        ...base, state: 'updated', phase: theirs.status?.phase
      };
    }

    // Otherwise current, or newer: only how it connects follows Liz's own agent
    const changes = theirs && (action === 'current' || action === 'newer') ? connectionChanges(theirs, connection) : {};

    if (theirs && Object.keys(changes).length) {
      if (!theirs.canUpdate) {
        return {
          ...base, state: 'notAllowed', phase: theirs.status?.phase
        };
      }
      const copy: AgentModel = await store.dispatch('management/clone', { resource: theirs });

      copy.spec = { ...copy.spec, ...clone(changes) };
      await copy.save();

      return {
        ...base, state: 'connected', phase: theirs.status?.phase
      };
    }
  } catch (e) {
    return {
      ...base, state: 'failed', error: messageOf(e)
    };
  }

  return {
    ...base, state: action as AgentState, phase: theirs?.status?.phase
  };
}

/**
 * Check every agent and add or update what is missing or older. Never rejects: a failure is in the
 * agent's result. Exported for Settings and the tests; pages call ensureLizAgents.
 */
export async function installLizAgents(store: VuexStore, agents: AgentConfig[] = AGENTS): Promise<AgentStatus> {
  const { liz, allowed } = lizAccess(store.getters);

  if (!liz || !allowed) {
    return {
      liz: liz ? 'present' : 'missing', allowed, results: []
    };
  }

  const results: AgentResult[] = [];
  const connection = connectionOf(await findCore(store));

  // One after the other: two agents, and an order that reads the same in Settings every time
  for (const agent of agents) {
    results.push(await installOne(store, agent, connection));
  }

  return {
    liz: 'present', allowed, results
  };
}

/** The check since Rancher loaded, shown in Settings */
export const lizAgentStatus = ref<AgentStatus>({
  liz: 'unknown', allowed: false, results: []
});

let checking: Promise<AgentStatus> | null = null;

/** Once each time Rancher loads, whichever page asks first. Settings can ask again with `again`. */
export function ensureLizAgents(store: VuexStore, { again = false } = {}): Promise<AgentStatus> {
  if (!checking || again) {
    checking = installLizAgents(store).then((status) => {
      lizAgentStatus.value = status;

      return status;
    });
  }

  return checking;
}
