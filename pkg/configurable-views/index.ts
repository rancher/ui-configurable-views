import type { VuexStore } from '@shell/types/store/vuex';
import { importTypes } from '@rancher/auto-import';
import { ActionLocation, IPlugin, type Action } from '@shell/core/types';
import type { ShellApi } from '@shell/apis';
import { NotificationLevel } from '@shell/types/notifications';
import { toggleTemplating } from './templating/template-engine';
import { product, pages } from './product';
import Home from './pages/Home.vue';
import ClusterDashboard from './pages/ClusterDashboard.vue';
import { toggleViewBar, viewBarLocked, viewBarVisible } from './composables/useViewBarVisibility';
import { forgetClusterStores } from './composables/useClusterStore';
import { pagedStores } from './templating/table-paging';

/** What a header action runs with as `this`: the header, with the store and the shell API on it. */
interface HeaderContext {
  $store: VuexStore;
  $shell: ShellApi;
}

// The on/off switch's shortcut, Cmd/Ctrl + Shift + . - a header action with no button, on every page.
// The shell binds a shortcut by the character the browser reports, which differs by platform: on a Mac
// Cmd is held, and the key comes through unshifted ('.'); elsewhere Shift applies, and Shift + . is
// '>' on US and UK keyboards.
const toggleViews: Action = {
  labelKey: 'configurableViews.toggle.title',
  hidden:   true,
  shortcut: { windows: ['ctrl', 'shift', '>'], mac: ['meta', 'shift', '.'] },
  invoke(this: HeaderContext) {
    const store = this.$store;
    const t = store.getters['i18n/t'];

    toggleTemplating(store).then((now) => {
      this.$shell.notification.send(NotificationLevel.Success, t('configurableViews.toggle.title'), now ? t('configurableViews.toggle.turnedOn') : t('configurableViews.toggle.turnedOff'));
    }).catch(() => {
      this.$shell.notification.send(NotificationLevel.Error, t('configurableViews.toggle.failed'));
    });
  },
};

/** Init the package */
export default function(plugin: IPlugin): void {
  importTypes(plugin);

  plugin.metadata = require('./package.json');

  plugin.addProduct(product, pages);

  // A widget's table is paged wherever the type's own list is (see table-paging).
  plugin.enableServerSidePagination(pagedStores);

  // The stores it reads other clusters through (see useClusterStore) are closed at a log out. Built into
  // Rancher, the package is told of one; installed, it is unloaded at one first, as when it is uninstalled.
  plugin.addNavHooks({ onLogout: forgetClusterStores });
  plugin.addUninstallHook((_: IPlugin, { store }: { store: VuexStore }) => forgetClusterStores(store));

  // The two pages this package makes configurable, each replacing the stock one in place.
  //
  // The Home, under the home layout. A cluster's dashboard, as the child of the layout it already
  // lives in ('default') - same name, same path, so the stock route is replaced and every link to a
  // cluster's dashboard lands here. Registered at init, so they are in place before the first page
  // resolves. Neither page leaves Rancher's own behind: each can show it, as one of its views.
  plugin.setHomePage(Home);
  plugin.addRoute('default', {
    name:      'c-cluster-explorer',
    path:      '/c/:cluster/explorer',
    component: ClusterDashboard,
  });

  // The view bar is hidden until asked for: a header button on each configurable page shows and
  // hides it, and Shift + V does the same - V for views, Shift and a letter as the shell's own page
  // shortcuts are. The shell ignores the shortcut while the focus is in a text field, where it types.
  const toggleBar: Action = {
    labelKey:           'configurableViews.bar.toggle',
    tooltipKey:         'configurableViews.bar.toggle',
    disabledTooltipKey: 'configurableViews.bar.toggleLocked',
    icon:               'icon-list-flat',
    shortcut:           { windows: ['shift', 'v'], mac: ['shift', 'v'] },
    ariaExpanded:       () => viewBarVisible.value,
    // While a view is being edited the bar holds the way out of the editor, so the button is
    // disabled, and its tooltip says why. Read reactively by the header, and again at every click
    enabled:            () => !viewBarLocked.value,
    invoke(this: HeaderContext) {
      toggleViewBar(this.$store);
    },
  };

  plugin.addAction(ActionLocation.HEADER, {}, toggleViews);
  plugin.addAction(ActionLocation.HEADER, { product: ['home'] }, toggleBar);
  plugin.addAction(ActionLocation.HEADER, { product: ['explorer'], path: [{ urlPath: '/explorer', endsWith: true }] }, toggleBar);
}
