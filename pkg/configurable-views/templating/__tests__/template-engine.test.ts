import type { VuexStore } from '@shell/types/store/vuex';
import {
  appliedViewScopes, approveDraft, canApproveWidgets, discardDraft, DraftError, generatedViews, generatedWidgets, getPageConfig, isTemplatingEnabled, saveView,
  setWidgetApproval, toggleTemplating, viewsOffInUrl, widgetApprovals
} from '@pkg/configurable-views/templating/template-engine';
import { PREF_ENABLED, PREF_VIEWS } from '@pkg/configurable-views/templating/user-prefs';
import type { PageViews } from '@pkg/configurable-views/templating/types';

const MARKER = 'templates.rancher.io/ai-templating';

interface FakeConfigMap {
  metadata: { name: string; namespace: string; labels: Record<string, string> };
  data: Record<string, string>;
  save: jest.Mock;
}

function configMap(name: string, data: Record<string, unknown>, type = 'config'): FakeConfigMap {
  return {
    metadata: {
      name, namespace: 'default', labels: { [MARKER]: 'true', 'templates.rancher.io/type': type }
    },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])),
    save: jest.fn().mockResolvedValue(undefined),
  };
}

// A store holding the given ConfigMaps, the way the management store hands them back, and this person's
// preferences, the way the shell hands them back: a copy each time.
function storeWith(maps: FakeConfigMap[] = [], prefs: Record<string, unknown> = {}) {
  const created: FakeConfigMap[] = [];
  const getters = {
    'management/byId': (_type: string, id: string) => maps.find((m) => `${ m.metadata.namespace }/${ m.metadata.name }` === id),
    'management/all':  (type: string) => (type === 'userpreference' ? [] : maps),
    'prefs/get':       (key: string) => JSON.parse(JSON.stringify(prefs[key] ?? (key === PREF_VIEWS ? {} : null))),
  };
  const dispatch = jest.fn((action: string, spec: FakeConfigMap & { key: string; value: unknown }) => {
    if (action === 'prefs/set') {
      prefs[spec.key] = spec.value;

      return Promise.resolve();
    }

    const made = { ...spec, save: jest.fn().mockResolvedValue(undefined) };

    created.push(made);

    return Promise.resolve(made);
  });

  return {
    store: {
      getters, dispatch, commit: jest.fn()
    } as unknown as VuexStore,
    created,
    dispatch,
    prefs,
  };
}

const set = (...names: string[]): PageViews => ({
  views: names.map((name) => ({
    id: name, name, kind: 'stock' as const
  }))
});

describe('appliedViewScopes', () => {
  const published = configMap('templating-home', { home: { global: set('Org') } });

  it("shows a person their own views over the organization's", () => {
    const { store } = storeWith([published], { [PREF_VIEWS]: { home: set('Mine') } });

    expect(appliedViewScopes(store.getters).resolved?.views.map((v) => v.name)).toStrictEqual(['Mine']);
    expect(appliedViewScopes(storeWith([published]).store.getters).resolved?.views.map((v) => v.name)).toStrictEqual(['Org']);
  });

  it("falls back to the organization's when a person's scope is switched off", () => {
    const { store } = storeWith([published], { [PREF_VIEWS]: { home: { ...set('Mine'), disabled: true } } });
    const scopes = appliedViewScopes(store.getters);

    expect(scopes.resolved?.views.map((v) => v.name)).toStrictEqual(['Org']);
    expect(scopes.user?.disabled).toBe(true);
    expect(scopes.hasUser).toBe(true);
  });

  it('keeps each page apart', () => {
    const { store } = storeWith([configMap('templating-home', { home: { global: set('Home') }, clusterDashboard: { global: set('Dashboard') } })], { [PREF_VIEWS]: { home: set('Mine') } });

    expect(appliedViewScopes(store.getters, 'clusterDashboard').resolved?.views.map((v) => v.name)).toStrictEqual(['Dashboard']);
  });

  it('reads views stored under their earlier name', () => {
    const { store } = storeWith([configMap('templating-home', { home: { global: { panels: [{ id: 'p', name: 'Old' }], defaultPanelId: 'p' } } })]);
    const { global } = appliedViewScopes(store.getters);

    expect(global?.views.map((v) => v.name)).toStrictEqual(['Old']);
    expect(global?.defaultViewId).toBe('p');
  });

  it('has nothing to show when nothing is stored, or it cannot be read', () => {
    expect(appliedViewScopes(storeWith().store.getters).resolved).toBeNull();
    expect(appliedViewScopes(storeWith([configMap('templating-home', { home: '{not json' })]).store.getters).resolved).toBeNull();
  });
});

describe('getPageConfig', () => {
  it('reads what is published for one page', () => {
    const { store } = storeWith([configMap('templating-home', { home: { global: set('Org') } })]);

    expect(getPageConfig(store.getters, 'home')).toStrictEqual({ global: set('Org') });
    expect(getPageConfig(store.getters, 'clusterDashboard')).toStrictEqual({});
  });
});

describe('the on/off switch', () => {
  it('is on until this person turns it off', () => {
    expect(isTemplatingEnabled(storeWith().store.getters)).toBe(true);
    expect(isTemplatingEnabled(storeWith([], { [PREF_ENABLED]: true }).store.getters)).toBe(true);
    expect(isTemplatingEnabled(storeWith([], { [PREF_ENABLED]: false }).store.getters)).toBe(false);
  });

  it('is off in the URL with ?confviews=false, and only then', () => {
    expect(viewsOffInUrl({ confviews: 'false' })).toBe(true);
    expect(viewsOffInUrl({ confviews: ['false', 'true'] })).toBe(true);
    expect(viewsOffInUrl({ confviews: 'true' })).toBe(false);
    expect(viewsOffInUrl({ confviews: '' })).toBe(false);
    expect(viewsOffInUrl({})).toBe(false);
    expect(viewsOffInUrl(undefined)).toBe(false);
  });

  it("flips and saves this person's switch, with its preference defined first", async() => {
    const { store, dispatch } = storeWith();

    expect(await toggleTemplating(store)).toBe(false);
    expect(dispatch).toHaveBeenCalledWith('prefs/set', { key: PREF_ENABLED, value: false });
    expect(store.commit).toHaveBeenCalledWith('prefs/setDefinition', expect.objectContaining({ name: PREF_ENABLED }));
  });
});

describe('saveView', () => {
  it("writes a person's views to their preferences, leaving other pages as they were", async() => {
    const { store, prefs } = storeWith([], { [PREF_VIEWS]: { clusterDashboard: set('Dash') } });

    await saveView(store, 'user', set('Mine'), 'home');

    expect(prefs[PREF_VIEWS]).toStrictEqual({ clusterDashboard: set('Dash'), home: set('Mine') });
  });

  it('keeps what it writes apart from the draft it was given', async() => {
    const { store, prefs } = storeWith();
    const draft = set('Mine');

    await saveView(store, 'user', draft);
    draft.views[0].name = 'Changed since';

    expect((prefs[PREF_VIEWS] as Record<string, PageViews>).home.views[0].name).toBe('Mine');
  });

  it('clears a scope when given nothing', async() => {
    const cm = configMap('templating-home', { home: { global: set('Org') } });
    const { store, prefs } = storeWith([cm], { [PREF_VIEWS]: { home: set('Mine') } });

    await saveView(store, 'user', null);
    await saveView(store, 'global', null);

    expect(prefs[PREF_VIEWS]).toStrictEqual({});
    expect(JSON.parse(cm.data.home)).toStrictEqual({});
  });

  it('publishes to the ConfigMap, leaving other pages as they were, and touches no preference', async() => {
    const cm = configMap('templating-home', { home: { global: set('Old') }, clusterDashboard: { global: set('Dash') } });
    const { store, dispatch } = storeWith([cm]);

    await saveView(store, 'global', set('Org'), 'home');

    expect(JSON.parse(cm.data.home)).toStrictEqual({ global: set('Org') });
    expect(JSON.parse(cm.data.clusterDashboard)).toStrictEqual({ global: set('Dash') });
    expect(cm.save).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('creates the ConfigMap the first time, labelled so it is found again', async() => {
    const { store, created } = storeWith();

    await saveView(store, 'global', set('Org'), 'clusterDashboard');

    expect(created).toHaveLength(1);
    expect(created[0].metadata).toStrictEqual(expect.objectContaining({ name: 'templating-home', namespace: 'default' }));
    expect(created[0].metadata.labels[MARKER]).toBe('true');
    expect(JSON.parse(created[0].data.clusterDashboard)).toStrictEqual({ global: set('Org') });
    expect(created[0].save).toHaveBeenCalledTimes(1);
  });
});

describe('views built by Liz', () => {
  const lizView = (name: string, page: string, view: unknown) => configMap(name, { page, view }, 'view');

  it('reads each view from a ConfigMap of its own, for its page, as a stored view is read', () => {
    const { store } = storeWith([
      lizView('liz-pods', 'home', {
        name:    'Pods',
        widgets: [{
          type: 'widget', widget: { kind: 'statusCards' }, colSpan: 6
        }]
      }),
      lizView('liz-cd', 'clusterDashboard', { name: 'Cluster', widgets: [] }),
      configMap('templating-home', { home: { global: { views: [] } } }),
    ]);
    const views = generatedViews(store.getters, 'home');

    expect(views.map((v) => [v.id, v.name])).toStrictEqual([['cm:liz-pods', 'Pods']]);
    expect((views[0] as { widgets: { colSpan: number }[] }).widgets[0].colSpan).toBe(6);
    expect(generatedViews(store.getters, 'clusterDashboard').map((v) => v.id)).toStrictEqual(['cm:liz-cd']);
  });

  it('gives their widgets the same ids every time they are read, so the page does not draw them again', () => {
    const { store } = storeWith([lizView('liz-x', 'home', {
      name:    'X',
      widgets: [
        { type: 'widget', widget: { kind: 'statusCards' } },
        { type: 'widget', widget: { kind: 'tabs', tabs: [{ name: 'A', widgets: [{ type: 'widget', widget: { kind: 'banner' } }] }] } },
      ],
    })]);
    const ids = () => {
      const [view] = generatedViews(store.getters, 'home') as { widgets: { id: string, widget: { tabs?: { id: string, widgets: { id: string }[] }[] } }[] }[];

      return [view.widgets.map((w) => w.id), view.widgets[1].widget.tabs?.[0].id, view.widgets[1].widget.tabs?.[0].widgets[0].id];
    };

    expect(ids()).toStrictEqual([['cm:liz-x-w0', 'cm:liz-x-w1'], 'cm:liz-x-w1-t0', 'cm:liz-x-w1-t0-w0']);
    expect(ids()).toStrictEqual(ids());
  });

  it('keeps them apart from the organization\'s own views, so writing those never copies them', () => {
    const { store } = storeWith([
      lizView('liz-pods', 'home', { name: 'Pods', widgets: [] }),
      configMap('templating-home', {
        home: {
          global: {
            views: [{
              id: 'org-1', name: 'Org', widgets: []
            }]
          }
        }
      }),
    ]);
    const scopes = appliedViewScopes(store.getters, 'home');

    expect(scopes.global?.views.map((v) => v.id)).toStrictEqual(['org-1']);
    expect(scopes.generated.map((v) => v.id)).toStrictEqual(['cm:liz-pods']);
  });

  it('keeps one whose view is not JSON it can read, empty, so it can still be taken away', () => {
    const { store } = storeWith([{ ...lizView('liz-bad', 'home', {}), data: { page: 'home', view: '{not json' } }]);

    expect(generatedViews(store.getters, 'home').map((v) => v.id)).toStrictEqual(['cm:liz-bad']);
  });
});

describe('views Liz proposed', () => {
  type Model = FakeConfigMap & { canUpdate?: boolean };

  // The ConfigMaps as the management store holds them: models that can be removed and say whether the
  // person signed in may change them. `clone` hands back a copy to change and save, as the store does.
  function draftStore(maps: Model[]) {
    const removed: string[] = [];
    const saved: FakeConfigMap[] = [];
    const models = maps.map((m) => ({
      ...m,
      remove: jest.fn(() => {
        removed.push(m.metadata.name);

        return Promise.resolve();
      }),
    }));
    const getters = {
      'management/byId': (_type: string, id: string) => models.find((m) => `${ m.metadata.namespace }/${ m.metadata.name }` === id),
      'management/all':  () => models,
      'prefs/get':       () => null,
    };
    const dispatch = jest.fn((action: string, spec: { resource: FakeConfigMap }) => {
      if (action !== 'management/clone') {
        return Promise.reject(new Error(action));
      }
      const copy = JSON.parse(JSON.stringify(spec.resource));

      copy.save = jest.fn(() => {
        saved.push(JSON.parse(JSON.stringify(copy)));

        return Promise.resolve();
      });

      return Promise.resolve(copy);
    });

    return {
      store: { getters, dispatch } as unknown as VuexStore, removed, saved
    };
  }

  const proposal = (name: string, view: unknown, extra: Record<string, string> = {}): Model => configMap(name, {
    page: 'home', view, ...extra
  }, 'view-draft');
  const published = (name: string, view: unknown): Model => configMap(name, { page: 'home', view }, 'view');
  const platform = published('liz-view-platform', { name: 'Platform', widgets: [] });
  const change = proposal('liz-view-platform-change', { name: 'Platform', widgets: [{ type: 'widget', widget: { kind: 'statusCards' } }] }, { replaces: 'liz-view-platform' });

  it('shows a proposal only to who may change it, apart from the published views', () => {
    const { store } = draftStore([
      proposal('liz-view-new', { name: 'New', widgets: [] }),
      { ...proposal('liz-view-hidden', { name: 'Hidden', widgets: [] }), canUpdate: false },
      platform,
      change,
    ]);
    const scopes = appliedViewScopes(store.getters, 'home');

    expect(scopes.drafts.map((v) => [v.id, v.draft])).toStrictEqual([
      ['draft:liz-view-new', {}],
      ['draft:liz-view-platform-change', { replaces: 'liz-view-platform', replacesName: 'Platform' }],
    ]);
    expect(scopes.generated.map((v) => v.id)).toStrictEqual(['cm:liz-view-platform']);
    expect(appliedViewScopes(store.getters, 'clusterDashboard').drafts).toStrictEqual([]);
  });

  it('says when the view a change replaces is not there any more', () => {
    const { store } = draftStore([change]);

    expect(appliedViewScopes(store.getters, 'home').drafts[0].draft).toStrictEqual({ replaces: 'liz-view-platform', replacesName: '' });
  });

  it('publishes a new view where it is, and opens it by the id a published view of Liz\'s has', async() => {
    const { store, saved, removed } = draftStore([proposal('liz-view-new', { name: 'New', widgets: [] })]);

    expect(await approveDraft(store, 'draft:liz-view-new')).toBe('cm:liz-view-new');
    expect(saved.map((cm) => [cm.metadata.name, cm.metadata.labels['templates.rancher.io/type']])).toStrictEqual([['liz-view-new', 'view']]);
    expect(removed).toStrictEqual([]);
  });

  it('writes a change into the view it replaces, then removes the proposal', async() => {
    const { store, saved, removed } = draftStore([platform, change]);

    expect(await approveDraft(store, 'draft:liz-view-platform-change')).toBe('cm:liz-view-platform');
    expect(saved.map((cm) => [cm.metadata.name, cm.metadata.labels['templates.rancher.io/type'], cm.data.view])).toStrictEqual([
      ['liz-view-platform', 'view', change.data.view],
    ]);
    expect(removed).toStrictEqual(['liz-view-platform-change']);
  });

  it('refuses a proposal that is gone, and a change to a view that is gone, writing nothing', async() => {
    const gone = draftStore([]);
    const targetGone = draftStore([change]);

    await expect(approveDraft(gone.store, 'draft:liz-view-new')).rejects.toStrictEqual(new DraftError('gone'));
    await expect(approveDraft(targetGone.store, 'draft:liz-view-platform-change')).rejects.toStrictEqual(new DraftError('targetGone'));
    expect([...gone.saved, ...targetGone.saved, ...targetGone.removed]).toStrictEqual([]);
  });

  it('throws a proposal away, and never a published view by mistake', async() => {
    const { store, removed } = draftStore([platform, change]);

    await discardDraft(store, 'draft:liz-view-platform-change');
    await discardDraft(store, 'draft:liz-view-platform');

    expect(removed).toStrictEqual(['liz-view-platform-change']);
  });
});

describe('widgets Liz wrote', () => {
  const widget = (name: string, data: Record<string, string>) => configMap(name, data, 'widget');

  it('reads each from a ConfigMap of its own', () => {
    const { store } = storeWith([widget('liz-widget-b', {
      displayName: 'B', description: 'two', component: '<template />'
    }), widget('liz-widget-a', { component: '<p />' })]);

    // By name as people read it; a widget with no displayName is called by its ConfigMap's name
    expect(generatedWidgets(store.getters).map((w) => [w.name, w.displayName, w.description, w.source])).toStrictEqual([
      ['liz-widget-b', 'B', 'two', '<template />'],
      ['liz-widget-a', 'liz-widget-a', '', '<p />'],
    ]);
  });

  it('says when each was created, and when it last changed: the latest write Kubernetes recorded', () => {
    const changed = widget('liz-widget-a', { component: '<p />' });
    const untouched = widget('liz-widget-b', { component: '<p />' });

    Object.assign(changed.metadata, {
      creationTimestamp: '2026-11-01T10:00:00Z',
      managedFields:     [{ manager: 'mcp', time: '2026-11-01T10:00:00Z' }, { manager: 'kubectl', time: '2026-11-20T08:30:00Z' }],
    });
    Object.assign(untouched.metadata, { creationTimestamp: '2026-11-02T10:00:00Z' });
    const { store } = storeWith([changed, untouched]);

    expect(generatedWidgets(store.getters).map((w) => [w.name, w.created, w.updated])).toStrictEqual([
      ['liz-widget-a', '2026-11-01T10:00:00Z', '2026-11-20T08:30:00Z'],
      ['liz-widget-b', '2026-11-02T10:00:00Z', '2026-11-02T10:00:00Z'],
    ]);
  });

  describe('approvals', () => {
    const SETTING = 'management.cattle.io.setting';

    // The approvals setting as the store holds it: a model with a value, whose save may fail
    function setting(value: unknown, { canUpdate = true, saves = true } = {}) {
      return {
        type:  SETTING,
        value: typeof value === 'string' ? value : JSON.stringify(value),
        canUpdate,
        save:  jest.fn(() => (saves ? Promise.resolve() : Promise.reject(new Error('forbidden')))),
      };
    }

    // A store whose management/byId has the approvals setting (or none), and whose clone and create
    // hand back models of their own, kept to be read back
    function storeWithSetting(approvals: ReturnType<typeof setting> | undefined, saves = true) {
      const { store, created } = storeWith([configMap('templating-config', { approvedWidgets: { 'liz-widget-old': 'h-old' } })]);
      const getters = store.getters as Record<string, unknown>;
      const byId = getters['management/byId'] as (type: string, id: string) => unknown;
      const made: ReturnType<typeof setting>[] = [];

      getters['management/byId'] = (type: string, id: string) => (type === SETTING ? (id === 'ui-configurable-views-widget-approvals' ? approvals : undefined) : byId(type, id));
      getters['auth/user'] = { id: 'u-abc', username: 'admin' };
      (store as unknown as { dispatch: jest.Mock }).dispatch = jest.fn((action: string, arg: { resource?: { value?: string }; value?: string }) => {
        const copy = setting(action === 'management/clone' ? arg.resource?.value || '{}' : arg.value || '{}', { saves });

        made.push(copy);

        return Promise.resolve(action === 'management/create' ? { ...copy, ...arg } : copy);
      });

      return {
        store, made, created
      };
    }

    it('are read from the approvals setting, and only those with the hash of the code', () => {
      const { store } = storeWithSetting(setting({
        'liz-widget-a': {
          hash: 'h1', by: 'admin', at: '2026-11-24T10:00:00Z'
        },
        'liz-widget-bad': { by: 'admin' },
        'liz-widget-str': 'h2',
      }));

      expect(widgetApprovals(store.getters)).toStrictEqual({
        'liz-widget-a': {
          hash: 'h1', by: 'admin', at: '2026-11-24T10:00:00Z'
        }
      });
    });

    it('no longer count when kept in templating-config, where a project member can write them', () => {
      const { store } = storeWithSetting(undefined);

      expect(widgetApprovals(store.getters)).toStrictEqual({});
    });

    it('record the hash approved, who approved it and when - written on a copy, so the stored approvals change only once saved', async() => {
      jest.useFakeTimers({ now: new Date('2026-11-24T10:00:00Z') });
      const stored = setting({});
      const { store, made } = storeWithSetting(stored);

      await setWidgetApproval(store, 'liz-widget-a', 'h1');
      jest.useRealTimers();

      expect(JSON.parse(made[0].value)).toStrictEqual({
        'liz-widget-a': {
          hash: 'h1', by: 'admin', at: '2026-11-24T10:00:00.000Z'
        }
      });
      expect(made[0].save).toHaveBeenCalledTimes(1);
      expect(stored.value).toBe('{}');
    });

    it('leave what is stored as it was when the save fails', async() => {
      const stored = setting({
        'liz-widget-a': {
          hash: 'h1', by: 'admin', at: ''
        }
      });
      const { store } = storeWithSetting(stored, false);

      await expect(setWidgetApproval(store, 'liz-widget-a', null)).rejects.toThrow('forbidden');
      expect(widgetApprovals(store.getters)['liz-widget-a']?.hash).toBe('h1');
    });

    it('create the setting with the first approval', async() => {
      const { store, made } = storeWithSetting(undefined);

      await setWidgetApproval(store, 'liz-widget-a', 'h1');

      expect(store.dispatch).toHaveBeenCalledWith('management/create', expect.objectContaining({ type: SETTING, metadata: { name: 'ui-configurable-views-widget-approvals' } }));
      expect(made[0].save).toHaveBeenCalledTimes(1);
    });

    describe('who can approve', () => {
      it('is whoever can change the approvals setting, once there is one', () => {
        expect(canApproveWidgets(storeWithSetting(setting({}, { canUpdate: false })).store.getters)).toBe(false);
        expect(canApproveWidgets(storeWithSetting(setting({}, { canUpdate: true })).store.getters)).toBe(true);
      });

      it('is whoever can create settings, before there is one - not whoever can write ConfigMaps', () => {
        const { store } = storeWithSetting(undefined);
        const getters = store.getters as Record<string, unknown>;

        getters['management/schemaFor'] = (type: string) => (type === SETTING ? { collectionMethods: ['GET', 'post'] } : { collectionMethods: ['GET'] });
        expect(canApproveWidgets(store.getters)).toBe(true);
        getters['management/schemaFor'] = (type: string) => (type === SETTING ? { collectionMethods: ['GET'] } : { collectionMethods: ['GET', 'POST'] });
        expect(canApproveWidgets(store.getters)).toBe(false);
      });
    });
  });
});

