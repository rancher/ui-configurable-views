import { defineComponent, type Component } from 'vue';
import {
  keepStockPages, resetStockPages, stockPage, unmarkStockRoutes, STOCK_ROUTES
} from '@pkg/configurable-views/templating/stock-pages';

describe('stock pages', () => {
  const builtWith = defineComponent({ name: 'TheCopyThePackageWasBuiltWith' });
  const rancherHome = defineComponent({ name: 'RancherHome' });
  const rancherDashboard = defineComponent({ name: 'RancherClusterDashboard' });

  // A router holding routes as vue-router does: name, meta and the components by view name
  const routerWith = (...routes: { name: string, component: unknown, meta?: Record<string, unknown> }[]) => ({
    getRoutes: () => routes.map(({ name, component, meta = {} }) => ({
      name, meta, components: { default: component as Component }
    })),
  });

  afterEach(() => resetStockPages());

  it("keeps Rancher's own Home and cluster dashboard from its router", () => {
    keepStockPages(routerWith(
      { name: 'home', component: rancherHome },
      { name: 'c-cluster-explorer', component: rancherDashboard },
      { name: 'about', component: defineComponent({ name: 'About' }) },
    ));

    expect(stockPage('home', builtWith)).toBe(rancherHome);
    expect(stockPage('c-cluster-explorer', builtWith)).toBe(rancherDashboard);
  });

  it('loads a page the router only knows how to load, as the router would', async() => {
    const loader = jest.fn(() => Promise.resolve(rancherHome));

    keepStockPages(routerWith({ name: 'home', component: loader }));
    const page = stockPage('home', builtWith) as { __asyncLoader?: () => Promise<Component> };

    expect(page).not.toBe(builtWith);
    expect(loader).not.toHaveBeenCalled();
    await expect(page.__asyncLoader?.()).resolves.toBe(rancherHome);
  });

  it("passes over a route that is already an extension's, as after the package loads again without a reload", () => {
    keepStockPages(routerWith({
      name: 'home', component: defineComponent({ name: 'ConfigurableHome' }), meta: { _extensionRoute: true, pkg: 'configurable-views' }
    }));

    expect(stockPage('home', builtWith)).toBe(builtWith);
  });

  it('uses the copy the package was built with when there is no router, or no such route', () => {
    keepStockPages(undefined);
    expect(stockPage('home', builtWith)).toBe(builtWith);

    keepStockPages(routerWith({ name: 'about', component: rancherHome }));
    expect(stockPage('c-cluster-explorer', builtWith)).toBe(builtWith);
  });

  it("leaves only the routes that replace Rancher's pages unmarked as the package's", () => {
    const route = (name: string) => ({ route: { name, meta: { pkg: 'configurable-views', other: 'kept' } } });
    const plugin = { routes: [route('home'), route('c-cluster-explorer'), route('configurable-views-c-cluster-settings')] };

    unmarkStockRoutes(plugin);

    expect(plugin.routes.map(({ route: r }) => [r.name, r.meta])).toStrictEqual([
      ['home', { other: 'kept' }],
      ['c-cluster-explorer', { other: 'kept' }],
      ['configurable-views-c-cluster-settings', { pkg: 'configurable-views', other: 'kept' }],
    ]);
    expect(STOCK_ROUTES).toStrictEqual(['home', 'c-cluster-explorer']);
  });

  it('does nothing for a plugin that keeps no routes', () => {
    expect(() => unmarkStockRoutes({})).not.toThrow();
  });
});
