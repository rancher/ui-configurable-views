import fs from 'fs';
import path from 'path';
import jsyaml from 'js-yaml';
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
  approveDraft:              jest.fn().mockResolvedValue('cm:liz-view-new'),
  discardDraft:              jest.fn().mockResolvedValue(undefined),
}));

const engine = jest.requireMock('@pkg/configurable-views/templating/template-engine') as {
  saveView: jest.Mock; deleteGeneratedView: jest.Mock; approveDraft: jest.Mock; discardDraft: jest.Mock; DraftError: new (reason: string) => Error;
};

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

describe('useViewActions and what Liz proposed', () => {
  const proposal = {
    id: 'draft:liz-view-new', name: 'New', gap: 0, pad: 0, widgets: [], draft: {}
  } as unknown as View;
  const change = {
    ...proposal, id: 'draft:liz-view-platform-change', name: 'Platform', draft: { replaces: 'liz-view-platform', replacesName: 'Platform' }
  } as unknown as View;

  function setUp(view: View, answer = true) {
    const confirm = jest.fn().mockResolvedValue(answer);
    const setActiveView = jest.fn();
    const syncActiveView = jest.fn();
    const pageViews = {
      editing:      ref(false),
      activeViewId: ref<string | null>(view.id),
      pinnedView:   ref(true),
      saving:       ref(false),
      error:        ref(''),
      scopes:       ref({}),
      orgIds:       ref(new Set()),
      views:        ref([]),
      viewById:     (id: string) => (id === view.id ? view : undefined),
      setActiveView,
      syncActiveView,
    } as unknown as PageViewsState;
    const actions = useViewActions(pageViews, { page: 'home', title: 'Home' }, {} as VuexStore, strictT as never, confirm, ref(null), jest.fn());

    return {
      actions, confirm, setActiveView, syncActiveView, pageViews
    };
  }

  // The package's own English strings, read as Rancher reads them: a value a string names and is not
  // given is an error, as it is in the browser - where it stops the dialog from opening at all.
  const EN = jsyaml.load(fs.readFileSync(path.resolve(__dirname, '../../l10n/en-us.yaml'), 'utf8')) as Record<string, unknown>;

  function strictT(key: string, values: Record<string, unknown> = {}): string {
    const text = key.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], EN);

    if (typeof text !== 'string') {
      throw new Error(`no string ${ key }`);
    }
    const missing = [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).filter((name) => !(name in values));

    if (missing.length) {
      throw new Error(`${ key } needs ${ missing.join(', ') }`);
    }

    return key;
  }

  beforeEach(() => {
    engine.approveDraft.mockClear();
    engine.discardDraft.mockClear();
  });

  it('asks before publishing a new view, as publishing does, then opens it', async() => {
    const { actions, confirm, setActiveView } = setUp(proposal);

    await actions.approveDraftView(proposal.id);

    expect(confirm.mock.calls[0][0].title).toBe('configurableViews.drafts.approve.title');
    expect(engine.approveDraft).toHaveBeenCalledWith(expect.anything(), 'draft:liz-view-new');
    expect(setActiveView).toHaveBeenCalledWith('cm:liz-view-new');
  });

  it('asks about a change as the replacement of the view it changes', async() => {
    const { actions, confirm } = setUp(change);

    await actions.approveDraftView(change.id);

    expect(confirm.mock.calls[0][0].title).toBe('configurableViews.drafts.approveChange.title');
    expect(engine.approveDraft).toHaveBeenCalledWith(expect.anything(), 'draft:liz-view-platform-change');
  });

  it('publishes nothing when the answer is no', async() => {
    const { actions } = setUp(proposal, false);

    await actions.approveDraftView(proposal.id);

    expect(engine.approveDraft).not.toHaveBeenCalled();
  });

  it('says why, when the view a change replaces went away', async() => {
    engine.approveDraft.mockRejectedValueOnce(new engine.DraftError('targetGone'));
    const { actions, pageViews } = setUp(change);

    await actions.approveDraftView(change.id);

    expect(pageViews.error.value).toBe('configurableViews.drafts.error.targetGone');
    expect(pageViews.saving.value).toBe(false);
  });

  it('discards after asking, then opens the view the page opens on', async() => {
    const {
      actions, confirm, syncActiveView, pageViews
    } = setUp(proposal);

    await actions.discardDraftView(proposal.id);

    expect(confirm.mock.calls[0][0]).toMatchObject({ title: 'configurableViews.drafts.discard.title', danger: true });
    expect(engine.discardDraft).toHaveBeenCalledWith(expect.anything(), 'draft:liz-view-new');
    expect(pageViews.activeViewId.value).toBeNull();
    expect(syncActiveView).toHaveBeenCalled();
  });
});
