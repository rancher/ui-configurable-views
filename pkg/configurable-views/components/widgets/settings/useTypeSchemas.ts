import { ref, watch } from 'vue';
import { useStore } from 'vuex';
import { SCHEMA } from '@shell/config/types';
import { fetchClusterSchemas } from '../../../templating/widget-data';
import type { TypeSchema } from '../../../templating/resource-types';

/**
 * The schemas behind a widget's Resource picker: those of the cluster it reads (`cluster`), or
 * Rancher's own when it names none.
 *
 * A widget following the page on the Home has no cluster yet, so it is offered the local cluster's
 * types - the Kubernetes ones are the same everywhere. A type only another cluster has can be typed.
 * A cluster that cannot be read falls back to the same.
 */
export function useTypeSchemas(cluster: () => string) {
  const store = useStore();
  const typeSchemas = ref<TypeSchema[]>([]);
  const loadingTypes = ref(false);
  let asked = 0;

  watch(cluster, async(id) => {
    const mine = ++asked;
    const local = () => store.getters['management/all'](SCHEMA) as TypeSchema[];

    if (!id) {
      typeSchemas.value = local();
      loadingTypes.value = false;

      return;
    }

    loadingTypes.value = true;

    try {
      const schemas = await fetchClusterSchemas(store, id);

      if (mine === asked) {
        typeSchemas.value = schemas;
      }
    } catch {
      if (mine === asked) {
        typeSchemas.value = local();
      }
    } finally {
      if (mine === asked) {
        loadingTypes.value = false;
      }
    }
  }, { immediate: true });

  return { typeSchemas, loadingTypes };
}
