import { isListable, typeOptions, type TypeSchema } from '@pkg/configurable-views/templating/resource-types';

const schema = (id: string, kind: string, group = '', extra: Partial<TypeSchema> = {}): TypeSchema => ({
  id,
  canList:    true,
  attributes: { kind, group },
  ...extra
});

describe('isListable', () => {
  it('takes a kind whose list can be read', () => {
    expect(isListable(schema('pod', 'Pod'))).toBe(true);
  });

  it('leaves out what is not a kind, and what the shell says cannot be listed', () => {
    expect(isListable({ id: 'count', canList: true })).toBe(false);
    expect(isListable(schema('ext.cattle.io.kubeconfig', 'Kubeconfig', 'ext.cattle.io', { canList: false }))).toBe(false);
  });
});

describe('typeOptions', () => {
  const schemas = [
    schema('apps.deployment', 'Deployment', 'apps'),
    schema('pod', 'Pod'),
    schema('event', 'Event'),
    schema('events.k8s.io.event', 'Event', 'events.k8s.io'),
    schema('apps.daemonset', 'DaemonSet', 'apps'),
    { id: 'count', canList: true },
  ];

  it('lists each type under its API group, the core group first, each by kind', () => {
    expect(typeOptions(schemas).map((o) => (o.kind === 'group' ? `[${ o.label }]` : o.label))).toStrictEqual([
      '[core]', 'Event (core)', 'Pod', '[apps]', 'DaemonSet', 'Deployment', '[events.k8s.io]', 'Event (events.k8s.io)',
    ]);
  });

  it('makes a group heading something that cannot be picked', () => {
    expect(typeOptions(schemas)[0]).toStrictEqual({
      kind: 'group', label: 'core', value: 'group:core', disabled: true
    });
  });

  it('keeps the type a widget already shows when it is not on the list, at the top', () => {
    expect(typeOptions(schemas, 'example.com.widget')[0]).toStrictEqual({ label: 'example.com.widget', value: 'example.com.widget' });
    expect(typeOptions(schemas, 'pod')[0].kind).toBe('group');
  });
});
