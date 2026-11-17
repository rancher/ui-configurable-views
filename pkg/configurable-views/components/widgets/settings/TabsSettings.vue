<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import { RcButton } from '@components/RcButton';
import { newId } from '../../../templating/view-model';
import type { WidgetSpec } from '../../../templating/types';

// Only the tabs themselves are edited here - their names and order. What is IN a tab is edited on the
// view, where it is drawn.

const props = defineProps<{ widget: WidgetSpec }>();
const emit = defineEmits<{ update: [changes: Partial<WidgetSpec>] }>();

const store = useStore();
const { t } = useI18n(store);

const tabs = computed(() => props.widget.tabs || []);

function setTabs(next: typeof tabs.value): void {
  emit('update', { tabs: next });
}

function addTab(): void {
  setTabs([...tabs.value, {
    id: newId('tab'), name: t('configurableViews.widgetSettings.newTab', { index: tabs.value.length + 1 }), widgets: []
  }]);
}

function renameTab(index: number, event: Event): void {
  const name = (event.target as HTMLInputElement).value;

  setTabs(tabs.value.map((tab, i) => (i === index ? { ...tab, name } : tab)));
}

function moveTab(index: number, delta: number): void {
  const next = [...tabs.value];
  const to = index + delta;

  if (to < 0 || to >= next.length) {
    return;
  }

  const [moved] = next.splice(index, 1);

  next.splice(to, 0, moved);
  setTabs(next);
}

/** A tab goes with what is in it; the button says so before it is pressed, and Cancel still undoes it. */
function removeTab(index: number): void {
  setTabs(tabs.value.filter((_, i) => i !== index));
}

function removeTabLabel(count: number): string {
  return count ? t('configurableViews.widgetSettings.removeTabWith', { count }) : t('configurableViews.widgetSettings.removeTab');
}
</script>

<template>
  <label class="wsm__label">{{ t('configurableViews.widgetSettings.tabs') }}</label>
  <div
    v-for="(tab, i) in tabs"
    :key="tab.id"
    class="tabs-settings__row"
  >
    <input
      :value="tab.name"
      class="wsm__field"
      :aria-label="t('configurableViews.widgetSettings.tabName', { index: i + 1 })"
      @input="renameTab(i, $event)"
    >
    <RcButton
      variant="ghost"
      size="small"
      class="tabs-settings__icon"
      :title="t('configurableViews.widgetSettings.moveLeft')"
      :aria-label="t('configurableViews.widgetSettings.moveLeft')"
      :disabled="i === 0"
      @click="moveTab(i, -1)"
    >
      <i class="icon icon-chevron-left" />
    </RcButton>
    <RcButton
      variant="ghost"
      size="small"
      class="tabs-settings__icon"
      :title="t('configurableViews.widgetSettings.moveRight')"
      :aria-label="t('configurableViews.widgetSettings.moveRight')"
      :disabled="i === tabs.length - 1"
      @click="moveTab(i, 1)"
    >
      <i class="icon icon-chevron-right" />
    </RcButton>
    <RcButton
      variant="ghost"
      size="small"
      class="tabs-settings__icon tabs-settings__icon--danger"
      :title="removeTabLabel(tab.widgets.length)"
      :aria-label="removeTabLabel(tab.widgets.length)"
      :disabled="tabs.length < 2"
      @click="removeTab(i)"
    >
      <i class="icon icon-close" />
    </RcButton>
  </div>
  <RcButton
    variant="tertiary"
    size="small"
    class="tabs-settings__add"
    @click="addTab"
  >
    <i class="icon icon-plus" />
    {{ t('configurableViews.widgetSettings.addTab') }}
  </RcButton>
  <p class="wsm__hint">
    {{ t('configurableViews.widgetSettings.tabsHint') }}
  </p>
</template>

<style lang="scss" scoped>
// One row per tab: its name, then move left / right and remove.
.tabs-settings__row {
  align-items: center;
  display:     flex;
  gap:         4px;

  .wsm__field {
    flex: 1 1 auto;
  }
}

.tabs-settings__icon {
  --rc-button-padding: 0;

  color: var(--body-text);
  flex:  0 0 24px;

  i {
    font-size: 16px;
  }

  &:hover:not(:disabled) {
    color: var(--link);
  }

  &--danger:hover:not(:disabled) {
    color: var(--error);
  }

  // Faded, with none of the box the shell puts behind a disabled button
  &:disabled {
    background: transparent;
    color:      var(--body-text);
    cursor:     default;
    opacity:    0.35;
  }
}

.tabs-settings__add {
  align-self: flex-start;
}
</style>
