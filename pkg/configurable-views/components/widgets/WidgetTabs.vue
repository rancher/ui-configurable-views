<script setup lang="ts">
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import { computed, onBeforeUnmount, ref } from 'vue';
import Tabbed from '@shell/components/Tabbed/index.vue';
import Tab from '@shell/components/Tabbed/Tab.vue';
import WidgetGrid from '../WidgetGrid.vue';
import { DEFAULT_GAP } from '../../templating/view-model';
import { useViewEditor } from '../../composables/viewEditor';
import { useWidgetPresence } from '../../composables/useWidgetPresence';
import type { WidgetSpec, WidgetTab } from '../../templating/types';

// TABS — a widget that holds widgets.
//
// Each tab is a grid of its own: the same flat, wrapping list a view has, twelve columns across the
// tab's width, with the view's gap. While the view is being edited those grids are edited in place -
// drop into a tab, drag out of one, select and size what is in it - so there is no second editor to
// learn. Tabs are named, added and ordered in the widget's settings.
//
// The strip is the shell's Tabbed, as the cluster dashboard's Events tabs are, without the URL hash.

// Dragging something over a tab's name opens that tab after this long, so a widget can be dropped
// into a tab that is not the one showing.
const OPEN_ON_HOVER_MS = 450;

const props = withDefaults(defineProps<{
  widget: WidgetSpec;
  /** This widget's id on the grid: a drop into one of its tabs is addressed by it. */
  nodeId?: string;
  gap?: number;
}>(), { nodeId: '', gap: DEFAULT_GAP });

const store = useStore();
const { t } = useI18n(store);
const viewEditor = useViewEditor();

const tabbed = ref<{ select(name: string): void } | null>(null);

const { tabPresent } = useWidgetPresence();

// Outside the editor a tab with nothing to show here is left out, as the dashboard leaves out its
// Alerts tab on a cluster without monitoring. While editing, every tab is there to be filled.
const tabs = computed<WidgetTab[]>(() => (props.widget.tabs || []).filter((tab) => viewEditor.editing || tabPresent(tab.widgets.map((w) => w.widget))));
const chosenId = ref('');

let hoverTab = '';
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

function cancelHover(): void {
  hoverTab = '';

  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

/**
 * Over a tab's name, while something is being dragged. Tabbed has no such thing, so the strip's own
 * markup says which tab it is: each one is a `tab` link in an item that has its name.
 */
function onDragOver(ev: DragEvent): void {
  const link = (ev.target as Element | null)?.closest?.('a[role="tab"]');
  const name = (link?.parentElement as HTMLElement | null)?.dataset.testid || '';
  const id = tabs.value.some((tab) => tab.id === name) ? name : '';

  if (id === hoverTab) {
    return;
  }

  cancelHover();
  hoverTab = id;

  if (viewEditor.editing && id && id !== chosenId.value) {
    hoverTimer = setTimeout(() => tabbed.value?.select(id), OPEN_ON_HOVER_MS);
  }
}

onBeforeUnmount(cancelHover);
</script>

<template>
  <div class="wtabs">
    <h3
      v-if="widget.title"
      class="wtabs__title"
    >
      {{ widget.title }}
    </h3>

    <Tabbed
      ref="tabbed"
      class="wtabs__tabbed"
      :use-hash="false"
      :show-extension-tabs="false"
      :flat="true"
      @changed="chosenId = $event.selectedName"
      @dragover="onDragOver"
      @dragleave="cancelHover"
      @drop="cancelHover"
    >
      <!-- First on the strip is the heaviest. No count of a table's rows: `badge` says how many widgets. -->
      <Tab
        v-for="(tab, i) in tabs"
        :key="tab.id"
        :name="tab.id"
        :label="tab.name"
        :weight="tabs.length - i"
        :count="false"
        :badge="viewEditor.editing ? tab.widgets.length : 0"
      >
        <template #default="{ active }">
          <div
            v-if="active"
            class="wtabs__panel"
          >
            <WidgetGrid
              :widgets="tab.widgets"
              :editing="viewEditor.editing"
              :selected-id="viewEditor.selectedId"
              :gap="gap"
              :place="{ parentId: nodeId, tabId: tab.id }"
            />
            <p
              v-if="!viewEditor.editing && !tab.widgets.length"
              class="wtabs__empty"
            >
              {{ t('configurableViews.widget.tabs.empty') }}
            </p>
          </div>
        </template>
      </Tab>
    </Tabbed>
  </div>
</template>

<style lang="scss" scoped>
.wtabs {
  display:        flex;
  flex-direction: column;
  height:         100%;
  min-width:      0;

  &__title {
    font-size:   18px;
    font-weight: 600;
    line-height: 22px;
    margin:      0 0 12px;
  }

  // A widget of a set height keeps the strip, and the panel takes the rest. The shell's tabs are as wide
  // as what is in them; a widget is as wide as its column.
  & &__tabbed {
    display:        flex;
    flex:           1 1 auto;
    flex-direction: column;
    min-height:     0;
    min-width:      0;

    :deep(.tab-container) {
      flex:       1 1 auto;
      min-height: 0;
    }
  }

  // The widget's own padding is the panel's, so the Spacing presets mean here what they mean on a card.
  &__panel {
    padding: var(--wcard-solo-pad, 16px);
  }

  &__empty {
    color:     var(--muted);
    font-size: 14px;
    margin:    0;
  }
}
</style>
