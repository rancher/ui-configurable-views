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
// Nothing happens where Liz is not installed (no AIAgentConfig type), nor for anyone who may not create
// one. Uninstalling the package leaves the agents in place: the package is unloaded at every log out as
// well, when nothing may be removed. They carry the managed-by label, for an admin who removes them.

import { ref } from 'vue';
import type { VuexStore } from '@shell/types/store/vuex';
import { clone } from '@shell/utils/object';
import viewsBuilder from '../agents/views-builder.aiagentconfig.yaml';
import widgetBuilder from '../agents/widget-builder.aiagentconfig.yaml';

type Getters = VuexStore['getters'];

/** Liz's agent configs, as Steve names the type */
export const AGENT_CONFIG = 'ai.cattle.io.aiagentconfig';
export const MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by';
export const MANAGED_BY = 'configurable-views';
export const REVISION_ANNOTATION = 'templates.rancher.io/agent-revision';

export interface AgentConfig {
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec: Record<string, unknown> & { displayName: string; enabled?: boolean; builtIn?: boolean };
  status?: { phase?: string };
}

interface AgentModel extends AgentConfig {
  canUpdate?: boolean;
  save(): Promise<unknown>;
}

export const AGENTS: AgentConfig[] = [viewsBuilder as AgentConfig, widgetBuilder as AgentConfig];

/** What happened to an agent: just created or replaced, already there, left alone, or not written */
export type AgentState = 'installed' | 'updated' | 'current' | 'newer' | 'builtIn' | 'notAllowed' | 'failed';

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

async function installOne(store: VuexStore, ours: AgentConfig): Promise<AgentResult> {
  const { name, namespace } = ours.metadata;
  const base = { name, displayName: ours.spec.displayName };
  let theirs: AgentModel | null = null;

  try {
    theirs = await store.dispatch('management/find', {
      type: AGENT_CONFIG, id: `${ namespace }/${ name }`, opt: { force: true, watch: false }
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
        type: AGENT_CONFIG, metadata: clone(ours.metadata), spec: clone(ours.spec)
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

      copy.spec = { ...clone(ours.spec), enabled: theirs.spec?.enabled ?? ours.spec.enabled };
      copy.metadata.labels = { ...(theirs.metadata.labels || {}), ...(ours.metadata.labels || {}) };
      copy.metadata.annotations = { ...(theirs.metadata.annotations || {}), ...(ours.metadata.annotations || {}) };
      await copy.save();

      return {
        ...base, state: 'updated', phase: theirs.status?.phase
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

  // One after the other: two agents, and an order that reads the same in Settings every time
  for (const agent of agents) {
    results.push(await installOne(store, agent));
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

/** For the tests: forget the check */
export function resetLizAgents(): void {
  checking = null;
  lizAgentStatus.value = {
    liz: 'unknown', allowed: false, results: []
  };
}
