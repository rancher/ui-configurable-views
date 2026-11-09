import type { VuexStore } from '@shell/types/store/vuex';
import {
  columnsLinkingTo, expectedAgents, fetchAlerts, fetchClusterCounts, fetchClusterPage, fetchClusterRows, fetchClusterSchemas, fetchMetricsBoards, fetchMonitoring,
  fetchStateSummaries, hasMonitoringApps, objectRoute, summarizeCounts
} from '@pkg/configurable-views/templating/widget-data';

// A store whose management/request answers by the PATH asked for (query aside): a value, or an
// Error to reject with. Anything else is a 404.
function storeAnswering(answers: Record<string, unknown>) {
  const dispatch = jest.fn((_action: string, { url }: { url: string }) => {
    const key = Object.keys(answers).find((k) => url.split('?')[0].endsWith(k));
    const answer = key ? answers[key] : new Error(`404 ${ url }`);

    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });

  return { store: { dispatch } as unknown as VuexStore, dispatch };
}

describe('reading a type from one cluster', () => {
  // A store whose findPage answers with these rows, out of this many, as of a revision.
  function storeWithPage(rows: object[], count = rows.length) {
    const dispatch = jest.fn().mockResolvedValue({ data: rows, pagination: { result: { count, revision: '42' } } });

    return { store: { dispatch } as unknown as VuexStore, dispatch };
  }

  it('asks the named cluster for one page, as of a revision, and says which revision it read', async() => {
    const { store, dispatch } = storeWithPage([{ id: 'a' }], 30);
    const page = await fetchClusterPage(store, {
      resource: 'pod', cluster: 'c/1', page: 2, pageSize: 5, revision: '41'
    });

    expect(dispatch).toHaveBeenCalledWith('management/findPage', {
      type: 'pod',
      opt:  {
        url:        '/k8s/clusters/c%2F1/v1/pod',
        transient:  true,
        watch:      false,
        pagination: {
          page: 2, pageSize: 5, sort: [], filters: []
        },
        revision: '41',
      },
    });
    expect(page).toStrictEqual({
      rows: [{ id: 'a' }], count: 30, truncated: false, revision: '42'
    });
  });

  it('reads every row up to the cap, filtered, and says when the cluster had more', async() => {
    const { store, dispatch } = storeWithPage([{ id: 'a' }, { id: 'b' }], 3);
    const filters = [{ fields: [] }] as unknown as Parameters<typeof fetchClusterRows>[1]['filters'];

    await expect(fetchClusterRows(store, {
      resource: 'secret', cluster: 'c-1', filters, cap: 2
    })).resolves.toStrictEqual({
      rows: [{ id: 'a' }, { id: 'b' }], truncated: true, revision: '42'
    });

    expect(dispatch.mock.calls[0][1].opt.pagination).toStrictEqual({
      page: 1, pageSize: 2, sort: [], filters
    });
  });

  // A store whose management/request answers with this, and whose management/create wraps what it is given.
  function storeWithSchemas(answer: unknown) {
    const dispatch = jest.fn((action: string, arg: object) => Promise.resolve(action === 'management/create' ? { ...arg, canList: true } : answer));

    return { store: { dispatch } as unknown as VuexStore, dispatch };
  }

  it('reads a cluster\'s own schemas from that cluster, as models', async() => {
    const { store, dispatch } = storeWithSchemas({ data: [{ id: 'pod' }] });

    await expect(fetchClusterSchemas(store, 'c-1')).resolves.toStrictEqual([{ id: 'pod', canList: true }]);
    expect(dispatch).toHaveBeenCalledWith('management/request', { url: '/k8s/clusters/c-1/v1/schemas' });
  });
});

describe('cluster counts', () => {
  it('splits a type into useful, warning and error by state', () => {
    const counts = { pod: { summary: { count: 10, states: { error: 2, active: 3 } } } };

    expect(summarizeCounts(counts, 'pod')).toStrictEqual({
      total: 10, useful: 8, warningCount: 0, errorCount: 2
    });
    expect(summarizeCounts(counts, 'missing')).toStrictEqual({
      total: 0, useful: 0, warningCount: 0, errorCount: 0
    });
  });

  it('expects no Rancher agent on the local cluster', () => {
    expect(expectedAgents('local')).toStrictEqual(['fleet']);
    expect(expectedAgents('c-m-1')).toStrictEqual(['cattle', 'fleet']);
  });
});

describe('counts shared between widgets', () => {
  function storeFor(user: string, counts: object) {
    const dispatch = jest.fn().mockResolvedValue({ data: [{ counts }] });

    return { store: { dispatch, getters: { 'auth/user': { id: user } } } as unknown as VuexStore, dispatch };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks once for widgets that want them at the same moment', async() => {
    const { store, dispatch } = storeFor('u-once', { pod: {} });

    await Promise.all([fetchClusterCounts(store, 'c-1'), fetchClusterCounts(store, 'c-1')]);

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('does not hand one person what was read for another', async() => {
    const first = storeFor('u-first', { pod: {} });
    const second = storeFor('u-second', {});

    await fetchClusterCounts(first.store, 'c-2');

    await expect(fetchClusterCounts(second.store, 'c-2')).resolves.toStrictEqual({});
    expect(second.dispatch).toHaveBeenCalledTimes(1);
  });

  it('asks again once the answer is a few seconds old', async() => {
    jest.useFakeTimers({ now: 1000 });

    const { store, dispatch } = storeFor('u-later', {});

    await fetchClusterCounts(store, 'c-3');
    jest.setSystemTime(1000 + 5000);
    await fetchClusterCounts(store, 'c-3');

    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('asks again after a request that failed', async() => {
    const { store, dispatch } = storeFor('u-failed', {});

    dispatch.mockRejectedValueOnce(new Error('503'));

    await expect(fetchClusterCounts(store, 'c-4')).rejects.toThrow('503');
    await expect(fetchClusterCounts(store, 'c-4')).resolves.toStrictEqual({});
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});

describe('hasMonitoringApps', () => {
  const answering = (user: string, answer: unknown) => ({
    dispatch: answer instanceof Error ? jest.fn().mockRejectedValue(answer) : jest.fn().mockResolvedValue({ data: [{ counts: answer }] }),
    getters:  { 'auth/user': { id: user } },
  }) as unknown as VuexStore;

  it('is any app in the monitoring namespace, as the dashboard asks it', async() => {
    await expect(hasMonitoringApps(answering('u-apps', { 'catalog.cattle.io.app': { namespaces: { 'cattle-monitoring-system': { count: 1 } } } }), 'c-1')).resolves.toBe(true);
    await expect(hasMonitoringApps(answering('u-other', { 'catalog.cattle.io.app': { namespaces: { 'cattle-system': { count: 1 } } } }), 'c-1')).resolves.toBe(false);
  });

  it('is no when the counts cannot be read', async() => {
    await expect(hasMonitoringApps(answering('u-gone', new Error('500')), 'c-gone')).resolves.toBe(false);
  });
});

describe('fetchMetricsBoards', () => {
  const GRAFANA = '/services/http:rancher-monitoring-grafana:80/proxy/api/dashboards/uid/';
  const HAS_MONITORING = {
    'schemas/monitoring.coreos.com.podmonitor':                      { id: 'monitoring.coreos.com.podmonitor' },
    'endpoints/cattle-monitoring-system/rancher-monitoring-grafana': { subsets: [{}] },
  };
  const DASHBOARD = { dashboard: {} };

  it('names the tabs whose two dashboards are both there', async() => {
    const { store } = storeAnswering({
      ...HAS_MONITORING,
      [`${ GRAFANA }rancher-cluster-nodes-1`]: DASHBOARD,
      [`${ GRAFANA }rancher-cluster-1`]:       DASHBOARD,
      // Only the one of the two
      [`${ GRAFANA }rancher-etcd-1`]:          DASHBOARD,
    });

    await expect(fetchMetricsBoards(store, 'c-1')).resolves.toStrictEqual(['cluster']);
  });

  it('asks for nothing more of a cluster without pod monitors', async() => {
    const { store, dispatch } = storeAnswering({
      'endpoints/cattle-monitoring-system/rancher-monitoring-grafana': { subsets: [{}] },
      [`${ GRAFANA }rancher-cluster-nodes-1`]:                         DASHBOARD,
      [`${ GRAFANA }rancher-cluster-1`]:                               DASHBOARD,
    });

    await expect(fetchMetricsBoards(store, 'c-1')).resolves.toStrictEqual([]);
    expect(dispatch.mock.calls.some(([, { url }]) => url.includes(GRAFANA))).toBe(false);
  });

  it('shows no tabs when the Grafana service has nowhere to go', async() => {
    const { store } = storeAnswering({
      ...HAS_MONITORING,
      'endpoints/cattle-monitoring-system/rancher-monitoring-grafana': { subsets: [] },
      [`${ GRAFANA }rancher-cluster-nodes-1`]:                         DASHBOARD,
      [`${ GRAFANA }rancher-cluster-1`]:                               DASHBOARD,
    });

    await expect(fetchMetricsBoards(store, 'c-1')).resolves.toStrictEqual([]);
  });

  it('asks the local cluster through Rancher itself, as the dashboard does', async() => {
    const { store, dispatch } = storeAnswering(HAS_MONITORING);

    await fetchMetricsBoards(store, 'local');

    expect(dispatch.mock.calls.map(([, { url }]) => url).filter((url) => url.includes(GRAFANA))[0]).toMatch(/^\/api\/v1\/namespaces/);
  });
});

describe('columnsLinkingTo', () => {
  const POD = {
    id:             'ns-1/web',
    type:           'pod',
    metadata:       { namespace: 'ns-1', name: 'web' },
    spec:           { nodeName: 'node-1' },
    namespace:      'ns-1',
    detailLocation: {
      name:   'c-cluster-product-resource-namespace-id',
      params: {
        product: 'home', cluster: 'c-open', resource: 'pod', namespace: 'ns-1', id: 'web'
      },
    },
  };
  const NAME = {
    name: 'name', value: 'nameDisplay', formatter: 'LinkDetail'
  };
  const NAMESPACE = {
    name: 'namespace', value: 'namespace', formatter: 'LinkName', formatterOpts: { type: 'namespace' }
  };
  const NODE = {
    name: 'node', value: 'spec.nodeName', formatter: 'LinkNamePopover', formatterOpts: { type: 'node' }
  };

  const linkOf = (header: { formatterOpts?: { getCustomDetailLink?: (row: object) => unknown } }, row: object) => header.formatterOpts?.getCustomDetailLink?.(row);

  it('sends a row\'s name to the cluster the row is in, in the explorer', () => {
    const [name] = columnsLinkingTo([NAME], 'c-1', false);

    expect(name.formatter).toBe('LinkDetail');
    expect(linkOf(name, POD)).toStrictEqual({
      name:   'c-cluster-product-resource-namespace-id',
      params: {
        product: 'explorer', cluster: 'c-1', resource: 'pod', namespace: 'ns-1', id: 'web'
      },
    });
  });

  it('finds the namespace of a type only that cluster has, whose model could not tell it has one', () => {
    const [name] = columnsLinkingTo([NAME], 'c-1', false);
    const row = {
      metadata:       { namespace: 'ns-1', name: 'thing' },
      detailLocation: {
        name:   'c-cluster-product-resource-id',
        params: {
          product: 'home', cluster: 'c-open', resource: 'example.com.thing', id: 'thing'
        },
      },
    };

    expect(linkOf(name, row)).toStrictEqual({
      name:   'c-cluster-product-resource-namespace-id',
      params: {
        product: 'explorer', cluster: 'c-1', resource: 'example.com.thing', namespace: 'ns-1', id: 'thing'
      },
    });
  });

  it('follows what a column refers to', () => {
    const [claim] = columnsLinkingTo([{
      name: 'claim', value: 'claim.name', formatter: 'LinkDetail', formatterOpts: { reference: 'claim.detailLocation' }
    }], 'c-1', false);

    expect(linkOf(claim, { claim: POD })).toMatchObject({ params: { cluster: 'c-1', product: 'explorer' } });
    expect(linkOf(claim, {})).toBeNull();
  });

  it('sends a management cluster to the provisioning cluster it names, with nothing else loaded', () => {
    const [name] = columnsLinkingTo([{
      name: 'name', value: 'nameDisplay', formatter: 'ClusterLink'
    }], 'local', false);

    expect(linkOf(name, { provClusterId: 'fleet-default/c-fmv4t' })).toStrictEqual({
      name:   'c-cluster-product-resource-namespace-id',
      params: {
        cluster: 'local', product: 'explorer', resource: 'provisioning.cattle.io.cluster', id: 'c-fmv4t', namespace: 'fleet-default'
      },
    });
    expect(linkOf(name, {})).toBeNull();
  });

  it('leaves the product of a page that has a place of its own', () => {
    const [name] = columnsLinkingTo([NAME], 'local', false);
    const row = {
      detailLocation: {
        name:   'c-cluster-auth-roles-resource-id',
        params: {
          product: 'home', cluster: '_', id: 'admin'
        }
      }
    };

    expect(linkOf(name, row)).toStrictEqual({
      name:   'c-cluster-auth-roles-resource-id',
      params: {
        product: 'home', cluster: 'local', id: 'admin'
      }
    });
  });

  it('gives a namespace and a node a link of their own, away from their cluster\'s page', () => {
    const [namespace, node] = columnsLinkingTo([NAMESPACE, NODE], 'c-1', false);

    expect([namespace.formatter, node.formatter]).toStrictEqual(['LinkDetail', 'LinkDetail']);
    expect(linkOf(namespace, POD)).toStrictEqual({
      name:   'c-cluster-product-resource-id',
      params: {
        cluster: 'c-1', product: 'explorer', resource: 'namespace', id: 'ns-1'
      },
    });
    expect(linkOf(node, POD)).toStrictEqual({
      name:   'c-cluster-product-resource-id',
      params: {
        cluster: 'c-1', product: 'explorer', resource: 'node', id: 'node-1'
      },
    });
    expect(linkOf(node, { spec: {} })).toBeNull();
  });

  it('reads a column whose value is a function as its cell does', () => {
    const [namespace] = columnsLinkingTo([{ ...NAMESPACE, value: (row: { namespace: string }) => row.namespace }], 'c-1', false);

    expect(linkOf(namespace, POD)).toMatchObject({ params: { resource: 'namespace', id: 'ns-1' } });
  });

  it('keeps the stock formatters on the cluster\'s own page, where they are right', () => {
    const [namespace, node] = columnsLinkingTo([NAMESPACE, NODE], 'c-1', true);

    expect(namespace).toStrictEqual(NAMESPACE);
    expect(node).toStrictEqual(NODE);
  });

  it('leaves any other column alone', () => {
    const state = {
      name: 'state', value: 'stateDisplay', formatter: 'BadgeStateFormatter'
    };

    expect(columnsLinkingTo([state], 'c-1', false)).toStrictEqual([state]);
  });
});

describe('objectRoute', () => {
  it('links into the named cluster, not the open one', () => {
    expect(objectRoute('c-m-1', {
      kind: 'Pod', apiVersion: 'v1', name: 'web', namespace: 'default'
    })).toStrictEqual({
      name:   'c-cluster-product-resource-namespace-id',
      params: {
        cluster: 'c-m-1', product: 'explorer', resource: 'pod', id: 'web', namespace: 'default'
      },
    });
  });

  it('names a grouped type by its group, and a cluster-scoped one without a namespace', () => {
    expect(objectRoute('c-m-1', {
      kind: 'Deployment', apiVersion: 'apps/v1', name: 'web', namespace: 'default'
    })).toStrictEqual(expect.objectContaining({ params: expect.objectContaining({ resource: 'apps.deployment' }) }));
    expect(objectRoute('c-m-1', { kind: 'Node', name: 'n1' })).toStrictEqual(expect.objectContaining({ name: 'c-cluster-product-resource-id' }));
  });

  it('has nowhere to go without a cluster, a kind or a name', () => {
    expect(objectRoute('', { kind: 'Pod', name: 'web' })).toBeNull();
    expect(objectRoute('c-m-1', { name: 'web' })).toBeNull();
  });
});

describe('reading a named cluster', () => {
  it("asks each type's state summary of that cluster, keeping a failed type apart", async() => {
    const summary = [{ property: 'metadata.state.name', counts: { running: { total: 2, namespace: { default: 2 } } } }];
    const { store, dispatch } = storeAnswering({ '/k8s/clusters/c-m-1/v1/pod': { summary } });

    const result = await fetchStateSummaries(store, 'c-m-1', ['pod', 'apps.deployment']);

    expect(result[0]).toStrictEqual({
      type: 'pod', summary, error: null
    });
    expect(result[1].summary).toBeNull();
    expect(result[1].error).toMatch(/404/);
    expect(dispatch.mock.calls[0][1].url).toBe('/k8s/clusters/c-m-1/v1/pod?summary=metadata.state.name&summaryonly&summarynamespaced');
  });

  it("finds a cluster's monitoring and its version, or says it has none", async() => {
    const app = { metadata: { name: 'rancher-monitoring' }, spec: { chart: { metadata: { version: '110.0.2' } } } };

    expect(await fetchMonitoring(storeAnswering({ 'cattle-monitoring-system/rancher-monitoring': app }).store, 'c-m-1')).toStrictEqual({ installed: true, version: '110.0.2' });
    expect(await fetchMonitoring(storeAnswering({}).store, 'c-m-1')).toStrictEqual({ installed: false, version: '' });
  });

  it("reads a cluster's alerts from Alertmanager, falling back to its older API", async() => {
    const alert = { labels: { alertname: 'Watchdog' } };

    expect(await fetchAlerts(storeAnswering({ '/api/v2/alerts': [alert] }).store, 'c-m-1')).toStrictEqual([alert]);
    expect(await fetchAlerts(storeAnswering({ '/api/v1/alerts': { data: [alert] } }).store, 'c-m-1')).toStrictEqual([alert]);
  });
});
