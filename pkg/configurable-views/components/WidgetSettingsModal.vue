<script setup lang="ts">
import {
  computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type CSSProperties
} from 'vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import { RcButton } from '@components/RcButton';
import { fetchClusterOptions } from '../templating/widget-data';
import { blockLabelKey } from '../templating/widget-catalog';
import { WIDGETS } from './widgets/registry';
import type { SettingsAnchor } from '../composables/viewEditor';
import type { WidgetSpec } from '../templating/types';

// "What this widget shows" — the settings behind a widget's ⚙.
//
// IN PLACE, deliberately: it opens beside the widget it belongs to, over a page that stays lit,
// because the thing you are describing is right there and you want to keep seeing it. A centred
// modal over a dimmed page would hide exactly what you are configuring.
//
// It edits a COPY and only hands it back on Done, so Cancel really does leave the widget alone. This
// holds what every widget shares: the title, and where it reads from, if it reads from anywhere. What
// else a kind needs is its own (see WIDGETS), drawn under those.

const DIALOG_WIDTH = 400;
const MARGIN = 12;

const props = withDefaults(defineProps<{
  widget: WidgetSpec;
  /** Where on screen the widget sits, so the settings can open next to it. */
  anchor?: SettingsAnchor | null;
}>(), { anchor: null });

type SettingsEmits = {
  done: [widget: WidgetSpec];
  cancel: [];
  remove: [];
};

const emit = defineEmits<SettingsEmits>();

const store = useStore();
const { t } = useI18n(store);

const root = ref<HTMLElement | null>(null);
const dialog = ref<HTMLElement | null>(null);
// Measured after mount: the dialog can only be placed well if we know how tall it really is.
const dialogHeight = ref(0);
const draft = reactive<WidgetSpec>(JSON.parse(JSON.stringify(props.widget)));
const definition = computed(() => WIDGETS[draft.kind]);

/**
 * Sit against the widget's left edge, and ALWAYS fully on screen.
 *
 * The anchor is where the widget is, and for a widget near the bottom of a long page that is a point
 * with no room under it. So the dialog is placed against the anchor and then pushed back up by
 * however much of it would fall off the bottom — clamped last against the view bar, which holds
 * Cancel and Save and has to stay reachable while this is open.
 */
const position = computed<CSSProperties>(() => {
  const a = props.anchor;
  const bar = document.querySelector('.vbar');
  const floor = bar ? Math.round(bar.getBoundingClientRect().bottom) + 8 : MARGIN;
  const ceiling = Math.max(floor, window.innerHeight - (dialogHeight.value || 420) - MARGIN);

  if (!a) {
    return {
      left: '50%', top: `${ floor }px`, transform: 'translateX(-50%)'
    };
  }

  return {
    left: `${ Math.max(MARGIN, Math.min(a.left, window.innerWidth - DIALOG_WIDTH - MARGIN)) }px`,
    top:  `${ Math.max(floor, Math.min(a.top, ceiling)) }px`,
  };
});

// "Clusters: what this table shows" — the widget's own title, then what kind of thing it is. A
// plural block name ("Links") does not fit that sentence, so it falls back to the generic noun
// rather than reading "what this links shows".
const heading = computed(() => {
  const key = blockLabelKey(draft.kind);
  const name = key ? t(key) : draft.kind;

  return definition.value?.pluralName ? t('configurableViews.widgetSettings.headingPlural', { title: draft.title || name }) : t('configurableViews.widgetSettings.heading', { title: draft.title || name, what: name.toLowerCase() });
});

/**
 * Where a widget reads from - one field.
 *
 * A table reads Rancher's own API (its clusters, users and Fleet, and the local cluster's resources),
 * or one cluster's: picking a cluster is what makes it a table of that cluster. A cluster widget is
 * about one cluster, so it has no Rancher to pick.
 *
 * ONE cluster, not several: each is a separate API with its own paging, so a widget spanning two of
 * them could not be paged at all. One cluster is what makes a table a real table.
 */
const needsClusters = computed(() => !!definition.value?.source);
const offersRancher = computed(() => definition.value?.source === 'rancherOrCluster');

const clusters = ref<{ id: string; label: string }[]>([]);

/** The Cluster field's value for "Rancher" - never a cluster's id, which has no colon. */
const RANCHER = ':rancher';

const where = computed({
  get: () => (offersRancher.value && !draft.fromCluster ? RANCHER : draft.cluster),
  set: (value: string) => {
    if (offersRancher.value) {
      draft.fromCluster = value !== RANCHER;
    }
    draft.cluster = value === RANCHER ? '' : value;
  },
});

/**
 * Read the clusters the picker offers, the moment it is shown, and not on every Home load: a picker of
 * clusters needs all of them, but only while somebody is choosing one.
 */
watch(needsClusters, async(needed) => {
  if (needed) {
    clusters.value = await fetchClusterOptions(store).catch(() => []);
  }
}, { immediate: true });

/** Escape closes it, like every other dialog in the product. */
function onKey(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') {
    emit('cancel');
  }
}

/** Place it knowing its real height (see `position`), and keep it on screen if the window moves. */
function measure(): void {
  dialogHeight.value = dialog.value?.getBoundingClientRect().height || 0;
}

/** With no scrim there is nothing to click "through" to, so a click anywhere outside closes it. */
function onOutside(ev: MouseEvent): void {
  const target = ev.target as HTMLElement | null;

  // The Resource picker draws its list on the page's body, outside this dialog
  if (target?.closest?.('.vs__dropdown-menu')) {
    return;
  }

  if (!root.value?.contains(target)) {
    emit('cancel');
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
  nextTick(measure);
  window.addEventListener('resize', measure);
  // Deferred past this tick so the very click that opened it does not immediately close it.
  setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', measure);
  document.removeEventListener('mousedown', onOutside);
});
</script>

<template>
  <div
    ref="root"
    class="wsm"
    :style="position"
    role="dialog"
    :aria-label="t('configurableViews.widgetSettings.label')"
  >
    <div
      ref="dialog"
      class="wsm__dialog"
    >
      <header class="wsm__head">
        <h3 class="wsm__title">
          <i class="icon icon-gear" />
          {{ heading }}
        </h3>
        <RcButton
          variant="ghost"
          size="small"
          class="wsm__close"
          :title="t('generic.close')"
          :aria-label="t('generic.close')"
          @click="$emit('cancel')"
        >
          <i class="icon icon-close" />
        </RcButton>
      </header>

      <div class="wsm__body">
        <label class="wsm__label">{{ t('configurableViews.widgetSettings.title') }}</label>
        <input
          v-model="draft.title"
          class="wsm__field"
        >
        <p
          v-if="definition?.settingsHintKey"
          class="wsm__hint"
        >
          {{ t(definition.settingsHintKey) }}
        </p>

        <template v-if="needsClusters">
          <label class="wsm__label">{{ t('configurableViews.widgetSettings.cluster') }}</label>
          <select
            v-model="where"
            class="wsm__field"
            data-testid="configurable-views-widget-cluster"
          >
            <option
              v-if="offersRancher"
              :value="RANCHER"
            >
              {{ t('configurableViews.widgetSettings.rancher') }}
            </option>
            <option value="">
              {{ t('configurableViews.widgetSettings.pageCluster') }}
            </option>
            <option
              v-for="cluster in clusters"
              :key="cluster.id"
              :value="cluster.id"
            >
              {{ cluster.label }}
            </option>
          </select>
          <p class="wsm__hint">
            {{ t(offersRancher ? 'configurableViews.widgetSettings.tableClusterHint' : 'configurableViews.widgetSettings.clusterHint') }}
          </p>
        </template>

        <component
          :is="definition.settings"
          v-if="definition?.settings"
          :widget="draft"
          @update="Object.assign(draft, $event)"
        />

        <footer class="wsm__foot">
          <RcButton
            variant="secondary"
            @click="$emit('remove')"
          >
            {{ t('configurableViews.widgetSettings.remove') }}
          </RcButton>
          <RcButton
            variant="primary"
            @click="$emit('done', draft)"
          >
            {{ t('generic.done') }}
          </RcButton>
        </footer>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
// 400px wide, sitting over the page rather than behind a scrim. Sizes are the design's: a 42px
// header, a 14/16/16 body whose fields are 8px apart, controls 24px tall, and a 32px footer row.
.wsm {
  position: fixed;
  // Over the grid and the drawer, still under the app header's stacking context (see the note at
  // the foot of this file).
  z-index:  12;

  &__dialog {
    background:     var(--body-bg);
    border:         1px solid var(--border);
    border-radius:  4px;
    box-shadow:     0 8px 32px rgba(0, 0, 0, 0.25);
    display:        flex;
    flex-direction: column;
    max-height:     min(86vh, 720px);
    width:          400px;
  }

  &__head {
    align-items:     center;
    border-bottom:   1px solid var(--border);
    box-sizing:      border-box;
    display:         flex;
    gap:             8px;
    height:          42px;
    padding:         12px 12px 12px 16px;
  }

  &__title {
    align-items: center;
    display:     flex;
    flex:        1 1 auto;
    font-size:   14px;
    font-weight: 700;
    gap:         8px;
    // Pinned, or the default line box makes the 42px header grow to 48.
    line-height: 17px;
    margin:      0;
    min-width:   0;
    overflow:    hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    i {
      flex:      0 0 auto;
      font-size: 16px;
    }
  }

  &__close {
    --rc-button-padding: 0;

    color: var(--body-text);

    i {
      font-size: 16px;
    }

    &:hover {
      color: var(--link);
    }
  }

  &__body {
    display:        flex;
    flex-direction: column;
    gap:            8px;
    overflow-y:     auto;
    padding:        14px 16px 16px;

    // Same reason as the drawer: a column flex container squashes fixed-height controls before it
    // agrees to overflow, so nothing in here shrinks.
    > * {
      flex: 0 0 auto;
    }
  }

  &__foot {
    border-top:      1px solid var(--border);
    display:         flex;
    gap:             12px;
    justify-content: flex-end;
    margin-top:      6px;
    padding-top:     12px;
  }
}

// The shell's app header is a stacking context at z-index 14, and the user menu, the notification
// tray and every other header dropdown live INSIDE it. So anything on the page at 14 or above does
// not merely sit beside them — it covers the whole header, menus and all. Page chrome stays below
// that ceiling; it only ever needs to beat the page, never the app.
</style>

<style lang="scss">
// What each kind's own settings share (see components/widgets/settings), which is why it is not scoped.
.wsm {
  // A field's label sits 6px above its control; the 8px between FIELDS comes from the body's gap.
  &__label {
    color:         var(--muted);
    display:       block;
    font-size:     12px;
    font-weight:   700;
    line-height:   14px;
    margin-bottom: 6px;
  }

  &__field {
    background:    var(--body-bg);
    border:        1px solid var(--border);
    border-radius: var(--border-radius);
    box-sizing:    border-box;
    color:         var(--body-text);
    font-family:   inherit;
    font-size:     14px;
    height:        24px;
    padding:       0 8px;
    width:         100%;

    &--area {
      height:  auto;
      padding: 6px 8px;
      resize:  vertical;
    }
  }

  &__hint {
    color:       var(--muted);
    font-size:   12px;
    line-height: 14px;
    margin:      6px 0 0;
  }

  &__radio {
    align-items: center;
    display:     flex;
    font-size:   14px;
    gap:         8px;
    line-height: 17px;
  }
}
</style>
