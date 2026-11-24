import { ref } from 'vue';
import type { VuexStore } from '@shell/types/store/vuex';
import { useViewActions } from '@pkg/configurable-views/composables/useViewActions';
import type { PageViewsState } from '@pkg/configurable-views/composables/usePageViews';
import type { PageViews, View } from '@pkg/configurable-views/templating/types';

// The writes, kept to be read back; the rest of the engine as it is
jest.mock('@pkg/configurable-views/templating/template-engine', () => ({
  ...jest.requireActual('@pkg/configurable-views/templating/template-engine'),
  saveView:                  jest.fn().mockResolvedValue(undefined),
  deleteGeneratedView:       jest.fn().mockResolvedValue(undefined),
  fetchTemplatingConfigMaps: jest.fn().mockResolvedValue(undefined),
}));

const engine = jest.requireMock('@pkg/configurable-views/templating/template-engine') as { saveView: jest.Mock; deleteGeneratedView: jest.Mock };

describe('useViewActions deleteView', () => {
  const view = (id: string) => ({
    id, name: id, gap: 0, pad: 0, widgets: []
  } as unknown as View);

  function setUp(saved: PageViews) {
    let current = saved;
    const persist = jest.fn((draft: PageViews) => {
      current = draft;

      return Promise.resolve();
    });
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const pageViews = {
      editing:      ref(false),
      activeViewId: ref(saved.views[0].id),
      pinnedView:   ref(false),
      saving:       ref(false),
      error:        ref(''),
      scopes:       ref({}),
      orgIds:       ref(new Set()),
      views:        ref(saved.views),
      viewById:     (id: string) => saved.views.find((v) => v.id === id),
      userDraft:    () => JSON.parse(JSON.stringify(current)),
      persist,
    } as unknown as PageViewsState;
    const actions = useViewActions(pageViews, { page: 'home', title: '' }, { dispatch } as unknown as VuexStore, ((key: string) => key) as never, jest.fn(), ref(null), jest.fn());

    return {
      actions, persist, dispatch
    };
  }

  const offered = (dispatch: jest.Mock) => dispatch.mock.calls.find(([action]) => action === 'growl/success')?.[1];

  it('deletes at once, and offers it back through the stock growl, for longer than a growl lasts', async() => {
    const { actions, persist, dispatch } = setUp({ views: [view('a'), view('b')] });

    await actions.deleteView('a');

    expect(persist.mock.calls[0][0].views.map((v: View) => v.id)).toStrictEqual(['b']);
    expect(offered(dispatch)).toMatchObject({
      title:   'configurableViews.bar.deleted',
      timeout: 10000,
      action:  { label: 'configurableViews.bar.undo' },
    });
  });

  it('puts it back in its place when Undo is pressed, as the default if it was', async() => {
    const { actions, persist, dispatch } = setUp({ views: [view('a'), view('b')], defaultViewId: 'a' });

    await actions.deleteView('a');
    await offered(dispatch).action.run();

    const restored = persist.mock.calls[1][0];

    expect(restored.views.map((v: View) => v.id)).toStrictEqual(['a', 'b']);
    expect(restored.defaultViewId).toBe('a');
  });
});

describe('useViewActions unpublishView', () => {
  const view = (id: string, name = id) => ({
    id, name, gap: 0, pad: 0, widgets: [], org: true
  } as unknown as View);

  function setUp(global: PageViews | null, shown: View) {
    const pageViews = {
      editing:        ref(false),
      activeViewId:   ref(shown.id),
      pinnedView:     ref(false),
      saving:         ref(false),
      error:          ref(''),
      scopes:         ref({ global }),
      orgIds:         ref(new Set([shown.id])),
      views:          ref([shown]),
      viewById:       (id: string) => (id === shown.id ? shown : undefined),
      syncActiveView: jest.fn(),
    } as unknown as PageViewsState;

    return useViewActions(pageViews, { page: 'home', title: '' }, { dispatch: jest.fn() } as unknown as VuexStore, ((key: string) => key) as never, jest.fn().mockResolvedValue(true), ref(null), jest.fn());
  }

  beforeEach(() => {
    engine.saveView.mockClear();
    engine.deleteGeneratedView.mockClear();
  });

  it('takes a view Liz built away from everyone: its ConfigMap goes', async() => {
    await setUp({ views: [view('org-a')] }, view('cm:liz-view-a')).unpublishView('cm:liz-view-a');

    expect(engine.deleteGeneratedView).toHaveBeenCalledWith(expect.anything(), 'cm:liz-view-a');
    expect(engine.saveView).not.toHaveBeenCalled();
  });

  it('takes a published copy of a view Liz built away with the original, so the original does not come back', async() => {
    await setUp({ views: [view('org-a'), view('cm:liz-view-a', 'Platform v2')] }, view('cm:liz-view-a', 'Platform v2')).unpublishView('cm:liz-view-a');

    expect(engine.saveView.mock.calls[0][2].views.map((v: View) => v.id)).toStrictEqual(['org-a']);
    expect(engine.deleteGeneratedView).toHaveBeenCalledWith(expect.anything(), 'cm:liz-view-a');
  });

  it('takes the organization\'s own view away, and deletes no ConfigMap', async() => {
    await setUp({ views: [view('org-a'), view('org-b')] }, view('org-b')).unpublishView('org-b');

    expect(engine.saveView.mock.calls[0][2].views.map((v: View) => v.id)).toStrictEqual(['org-a']);
    expect(engine.deleteGeneratedView).not.toHaveBeenCalled();
  });
});
