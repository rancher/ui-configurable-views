import type { VuexStore } from '@shell/types/store/vuex';
import {
  definePrefs, savePref, PREF_BAR_VISIBLE, PREF_ENABLED, PREF_VIEWS
} from '@pkg/configurable-views/templating/user-prefs';

function storeWith(saved: Record<string, string> = {}, failure?: object) {
  const commit = jest.fn();
  const dispatch = jest.fn().mockResolvedValue(failure);
  const getters = {
    'management/all': (type: string) => (type === 'userpreference' ? [{ data: saved }] : []),
    'prefs/get':      () => 'as it was',
    'i18n/t':         (key: string) => key,
  };

  return {
    store: {
      commit, dispatch, getters
    } as unknown as VuexStore,
    commit,
    dispatch,
  };
}

describe('definePrefs', () => {
  it('defines each preference, as a user preference holding JSON', () => {
    const { store, commit } = storeWith();

    definePrefs(store);

    expect(commit.mock.calls.map(([, { name, definition }]) => [name, definition.def])).toStrictEqual([
      [PREF_ENABLED, true],
      [PREF_BAR_VISIBLE, false],
      [PREF_VIEWS, {}],
    ]);
    expect(commit.mock.calls[0]).toStrictEqual(['prefs/setDefinition', {
      name:       PREF_ENABLED,
      definition: {
        def: true, parseJSON: true, asUserPreference: true
      },
    }]);
  });

  it("takes what is saved from the shell's own read, which missed these", () => {
    const { store, commit } = storeWith({ [PREF_ENABLED]: 'false', [PREF_VIEWS]: '{"home":{"views":[]}}' });

    definePrefs(store);

    expect(commit).toHaveBeenCalledWith('prefs/load', { key: PREF_ENABLED, value: false });
    expect(commit).toHaveBeenCalledWith('prefs/load', { key: PREF_VIEWS, value: { home: { views: [] } } });
    expect(commit.mock.calls.filter(([mutation]) => mutation === 'prefs/load')).toHaveLength(2);
  });

  it('leaves a saved value it cannot read at its default', () => {
    const { store, commit } = storeWith({ [PREF_VIEWS]: '{not json' });

    definePrefs(store);

    expect(commit.mock.calls.filter(([mutation]) => mutation === 'prefs/load')).toHaveLength(0);
  });

  it('does it once for a store', () => {
    const { store, commit } = storeWith();

    definePrefs(store);
    definePrefs(store);

    expect(commit).toHaveBeenCalledTimes(3);
  });
});

describe('savePref', () => {
  it('saves through the shell, which keeps its writes in order', async() => {
    const { store, dispatch, commit } = storeWith();

    await savePref(store, PREF_ENABLED, false);

    expect(dispatch).toHaveBeenCalledWith('prefs/set', { key: PREF_ENABLED, value: false });
    expect(commit).not.toHaveBeenCalled();
  });

  it('puts the value back and fails, when the shell says the write failed', async() => {
    const { store, commit } = storeWith({}, { type: 'error', status: 403 });

    await expect(savePref(store, PREF_ENABLED, false)).rejects.toThrow('configurableViews.errors.savePreference');

    expect(commit).toHaveBeenCalledWith('prefs/load', { key: PREF_ENABLED, value: 'as it was' });
  });
});
