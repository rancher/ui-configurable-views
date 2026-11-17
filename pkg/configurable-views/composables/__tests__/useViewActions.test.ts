import { ref } from 'vue';
import type { VuexStore } from '@shell/types/store/vuex';
import { useViewActions } from '@pkg/configurable-views/composables/useViewActions';
import type { PageViewsState } from '@pkg/configurable-views/composables/usePageViews';
import type { PageViews, View } from '@pkg/configurable-views/templating/types';

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
