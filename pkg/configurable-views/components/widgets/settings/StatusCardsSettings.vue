<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import type { StateColor } from '@shell/utils/style';
import { normalizeStatusCards, STATE_COLORS, type StatusCardsConfig } from '../../../templating/status-cards';
import type { WidgetSpec } from '../../../templating/types';

// What a status widget counts, how it cuts it into cards and rows, and how it colours them.

const props = defineProps<{ widget: WidgetSpec }>();
const emit = defineEmits<{ update: [changes: Partial<WidgetSpec>] }>();

const store = useStore();
const { t } = useI18n(store);

const status = computed<StatusCardsConfig>(() => normalizeStatusCards(props.widget.status));

/** One of the cards' settings, to `v-model`: a change hands back all of them with it. */
const setting = <K extends keyof StatusCardsConfig>(key: K) => computed({
  get: () => status.value[key],
  set: (value: StatusCardsConfig[K]) => emit('update', { status: { ...status.value, [key]: value } }),
});

const namespace = setting('namespace');
const cards = setting('cards');
const rows = setting('rows');
const only = setting('only');
const sort = setting('sort');
const top = setting('top');
const maxCards = setting('maxCards');
const colors = setting('colors');
const resources = setting('resources');
const customColors = setting('customColors');

// Typed as one line of types, comma-separated; none means every type.
const resourcesText = computed({
  get: () => resources.value.join(', '),
  set: (value: string) => {
    resources.value = `${ value }`.split(',').map((r) => r.trim()).filter(Boolean);
  },
});

// One "status=color" per line; a line whose colour is not one of the state colours is left out.
const customColorsText = computed({
  get: () => Object.entries(customColors.value).map(([state, color]) => `${ state }=${ color }`).join('\n'),
  set: (value: string) => {
    const out: Record<string, StateColor> = {};

    for (const line of `${ value }`.split('\n')) {
      const [state, color] = line.split('=').map((part) => part?.trim().toLowerCase());

      if (state && STATE_COLORS.includes(color as StateColor)) {
        out[state] = color as StateColor;
      }
    }
    customColors.value = out;
  },
});

const STATUS_CARDS = ['none', 'type', 'namespace'];
const STATUS_ROWS = ['state', 'type', 'namespace'];
const STATUS_ONLY = ['all', 'error', 'warning'];
const STATUS_SORT = ['count', 'name'];
const STATUS_COLORS = ['state', 'none', 'custom'];
</script>

<template>
  <label class="wsm__label">{{ t('configurableViews.widgetSettings.status.resources') }}</label>
  <input
    v-model.lazy="resourcesText"
    class="wsm__field"
    :placeholder="t('configurableViews.widgetSettings.status.resourcesPlaceholder')"
    data-testid="configurable-views-status-resources"
  >
  <p class="wsm__hint">
    {{ t('configurableViews.widgetSettings.status.resourcesHint') }}
  </p>

  <label class="wsm__label">{{ t('configurableViews.widgetSettings.status.namespace') }}</label>
  <input
    v-model.trim="namespace"
    class="wsm__field"
    :placeholder="t('configurableViews.widgetSettings.status.namespacePlaceholder')"
  >

  <div class="status-settings__pair">
    <div>
      <label class="wsm__label">{{ t('configurableViews.widgetSettings.status.cards') }}</label>
      <select
        v-model="cards"
        class="wsm__field"
        data-testid="configurable-views-status-cards"
      >
        <option
          v-for="opt in STATUS_CARDS"
          :key="opt"
          :value="opt"
        >
          {{ t(`configurableViews.widgetSettings.status.cardsBy.${ opt }`) }}
        </option>
      </select>
    </div>
    <div>
      <label class="wsm__label">{{ t('configurableViews.widgetSettings.status.rows') }}</label>
      <select
        v-model="rows"
        class="wsm__field"
        data-testid="configurable-views-status-rows"
      >
        <option
          v-for="opt in STATUS_ROWS"
          :key="opt"
          :value="opt"
        >
          {{ t(`configurableViews.widgetSettings.status.rowsBy.${ opt }`) }}
        </option>
      </select>
    </div>
    <div>
      <label class="wsm__label">{{ t('configurableViews.widgetSettings.status.only') }}</label>
      <select
        v-model="only"
        class="wsm__field"
      >
        <option
          v-for="opt in STATUS_ONLY"
          :key="opt"
          :value="opt"
        >
          {{ t(`configurableViews.widgetSettings.status.onlyBy.${ opt }`) }}
        </option>
      </select>
    </div>
    <div>
      <label class="wsm__label">{{ t('configurableViews.widgetSettings.status.sort') }}</label>
      <select
        v-model="sort"
        class="wsm__field"
      >
        <option
          v-for="opt in STATUS_SORT"
          :key="opt"
          :value="opt"
        >
          {{ t(`configurableViews.widgetSettings.status.sortBy.${ opt }`) }}
        </option>
      </select>
    </div>
    <div>
      <label class="wsm__label">{{ t('configurableViews.widgetSettings.status.top') }}</label>
      <input
        v-model.number="top"
        type="number"
        min="0"
        class="wsm__field"
      >
    </div>
    <div>
      <label class="wsm__label">{{ t('configurableViews.widgetSettings.status.maxCards') }}</label>
      <input
        v-model.number="maxCards"
        type="number"
        min="0"
        class="wsm__field"
      >
    </div>
  </div>
  <p class="wsm__hint">
    {{ t('configurableViews.widgetSettings.status.topHint') }}
  </p>

  <label class="wsm__label">{{ t('configurableViews.widgetSettings.status.colors') }}</label>
  <select
    v-model="colors"
    class="wsm__field"
    data-testid="configurable-views-status-colors"
  >
    <option
      v-for="opt in STATUS_COLORS"
      :key="opt"
      :value="opt"
    >
      {{ t(`configurableViews.widgetSettings.status.colorsBy.${ opt }`) }}
    </option>
  </select>
  <template v-if="colors === 'custom'">
    <label class="wsm__label">{{ t('configurableViews.widgetSettings.status.customColors') }}</label>
    <textarea
      v-model.lazy="customColorsText"
      class="wsm__field wsm__field--area"
      rows="4"
      placeholder="running=success&#10;imagepullbackoff=warning&#10;crashloopbackoff=error"
    />
    <p class="wsm__hint">
      {{ t('configurableViews.widgetSettings.status.customColorsHint') }}
    </p>
  </template>
</template>

<style lang="scss" scoped>
// Two settings side by side, where each is a short choice.
.status-settings__pair {
  display:               grid;
  gap:                   0 12px;
  grid-template-columns: 1fr 1fr;
}
</style>
