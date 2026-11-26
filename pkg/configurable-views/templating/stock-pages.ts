// Rancher's own pages, the ones this package replaces in place, as the running Rancher has them.
//
// Each configurable page keeps Rancher's page as one of its views. The page imported from the shell
// is the copy this package was built with: it lags behind the Rancher it runs in, and it does not
// share that Rancher's module state - the vendor name and links of a Prime install, for one, are set
// up only in Rancher's own copy. So the components are taken from Rancher's router as the package
// starts, before the package's routes replace them, and the copy is only a fallback.

import { defineAsyncComponent, type Component } from 'vue';
import type { RouteRecordNormalized } from 'vue-router';

/** The routes of Rancher's own pages that this package replaces, by name. */
export const STOCK_ROUTES = ['home', 'c-cluster-explorer'] as const;

export type StockRoute = typeof STOCK_ROUTES[number];

/** What the package needs of Rancher's router. */
export interface RouteSource {
  getRoutes(): Pick<RouteRecordNormalized, 'name' | 'meta' | 'components'>[];
}

const kept: Partial<Record<StockRoute, Component>> = {};

/**
 * A route's component as the router holds it: the component, or a function that loads it. Told apart
 * as vue-router tells them apart.
 */
function asComponent(raw: unknown): Component | undefined {
  if (!raw) {
    return undefined;
  }
  if (typeof raw === 'object') {
    return raw as Component;
  }
  if (typeof raw !== 'function') {
    return undefined;
  }
  if ('displayName' in raw || 'props' in raw || '__vccOpts' in raw) {
    return raw as Component;
  }

  return defineAsyncComponent(raw as () => Promise<Component>);
}

/**
 * Keeps Rancher's own pages from its router. Called as the package starts, which is before the shell
 * adds the package's routes. A route that is already an extension's is passed over, so a page that
 * another extension replaced, or this package loaded again without a reload, is never taken for
 * Rancher's.
 */
export function keepStockPages(router?: RouteSource | null): void {
  const routes = router?.getRoutes?.() || [];

  STOCK_ROUTES.forEach((name) => {
    const record = routes.find((route) => route.name === name);

    if (!record || record.meta?._extensionRoute) {
      return;
    }

    const component = asComponent(record.components?.default);

    if (component) {
      kept[name] = component;
    }
  });
}

/** Rancher's own page for a route; the copy the package was built with when Rancher's was not kept. */
export function stockPage(name: StockRoute, builtWith: Component): Component {
  return kept[name] || builtWith;
}

/** What the package needs of a plugin's routes: the shell's Plugin keeps every route added to it. */
interface PluginRoutes {
  routes?: { route: { name?: unknown, meta?: Record<string, unknown> } }[];
}

/**
 * Leaves the routes that replace Rancher's own pages unmarked, as Rancher's own routes are. The shell
 * marks every route a package adds as that package's, and a table on a package's route is taken for
 * the package's own: it keeps the look it was written with, without Rancher's table views, so
 * Rancher's own lists on these pages lost theirs. The shell also runs a package's enter and leave
 * steps on its routes, which Rancher's own pages never ran.
 */
export function unmarkStockRoutes(plugin: unknown): void {
  ((plugin as PluginRoutes).routes || []).forEach(({ route }) => {
    if (route.meta && (STOCK_ROUTES as readonly unknown[]).includes(route.name)) {
      delete route.meta.pkg;
    }
  });
}
