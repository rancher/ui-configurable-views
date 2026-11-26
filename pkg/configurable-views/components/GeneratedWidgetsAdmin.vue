<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import { useShell } from '@shell/apis';
import { NotificationLevel } from '@shell/types/notifications';
import { BadgeState } from '@components/BadgeState';
import { Banner } from '@components/Banner';
import DateFormatter from '@shell/components/formatter/Date.vue';
import {
  generatedWidgets, widgetApprovals, setWidgetApproval, deleteGeneratedWidget, fetchTemplatingConfigMaps, fetchWidgetApprovals, fetchWidgetChanges,
  canApproveWidgets
} from '../templating/template-engine';
import { reviewWidget } from '../templating/widget-review';
import { useConfirm } from '../composables/useConfirm';
import { useWidgetHashes } from '../composables/useWidgetHashes';

// The other widgets - added as code, by Liz or by an admin - and the gate in front of them: an admin
// reads each one's code and approves it. Approving records the hash of the code as it was read, so a
// widget runs only as long as its code is what was read - a change sends it back here. Revoking stops it
// everywhere at once.
//
// Only for those who can approve (see canApproveWidgets): anyone else would be shown buttons that fail.

const store = useStore();
const { t } = useI18n(store);
const shell = useShell();
const confirm = useConfirm();

const canApprove = computed(() => canApproveWidgets(store.getters));

// The widgets, and the approvals as they are now: Settings opens without the widgets otherwise (the
// switch above it is a preference), and the shell read the approvals only when Rancher opened.
onMounted(() => Promise.all([fetchTemplatingConfigMaps(store), fetchWidgetApprovals(store)]));

const widgets = computed(() => generatedWidgets(store.getters));

// When each one last changed, read again whenever one of them does - by name, see fetchWidgetChanges.
// Only for those who see the list. A read overtaken by a newer one lands nothing.
const changed = ref<Record<string, string>>({});
let reading = 0;

watch(() => (canApprove.value ? widgets.value.map((w) => `${ w.name }@${ w.version }`).join(',') : ''), async(versions) => {
  const mine = ++reading;
  const read = versions ? await fetchWidgetChanges(store, widgets.value.map((w) => w.name)) : {};

  if (mine === reading) {
    changed.value = read;
  }
}, { immediate: true });

// What a reviewer should know before approving: the Rancher components each one draws with, and
// what it built by hand or reached for outside what it is given
const reviews = computed(() => Object.fromEntries(widgets.value.map((w) => [w.name, reviewWidget(w.source)])));
const approvals = computed(() => widgetApprovals(store.getters));

// Each widget's code, hashed - what an approval is compared with
const hashes = useWidgetHashes(() => widgets.value);

type Status = 'pending' | 'approved' | 'changed';

function statusOf(name: string): Status {
  const approved = approvals.value[name];

  if (!approved) {
    return 'pending';
  }

  return approved.hash === hashes.value[name] ? 'approved' : 'changed';
}

const COLOR: Record<Status, string> = {
  pending: 'bg-warning', approved: 'bg-success', changed: 'bg-error'
};

const open = ref<Record<string, boolean>>({});
const busy = ref('');

// The hash of each widget's code as it was when its code was opened. Approve approves that, and only
// while the code is still the same: an approval covers code someone read, never a newer version that
// arrived while it was open.
const readHash = ref<Record<string, string>>({});

function toggleCode(name: string): void {
  open.value[name] = !open.value[name];

  if (open.value[name]) {
    readHash.value[name] = hashes.value[name];
  }
}

type ReadState = 'unread' | 'read' | 'changed';

function readState(name: string): ReadState {
  if (!readHash.value[name]) {
    return 'unread';
  }

  return readHash.value[name] === hashes.value[name] ? 'read' : 'changed';
}

async function run(name: string, action: () => Promise<void>, done: string): Promise<void> {
  busy.value = name;

  try {
    // The store has the result: each action saves through the models it changes
    await action();
    shell.notification.send(NotificationLevel.Success, t('configurableViews.generatedAdmin.title'), done);
  } catch (e) {
    shell.notification.send(NotificationLevel.Error, t('configurableViews.generatedAdmin.failed'), (e as Error)?.message || String(e));
  } finally {
    busy.value = '';
  }
}

/** How a widget is named to people: its display name, as its card is headed - not its ConfigMap's. */
const labelOf = (name: string) => widgets.value.find((w) => w.name === name)?.displayName || name;

function approve(name: string): Promise<void> | void {
  if (readState(name) !== 'read') {
    return;
  }

  return run(name, () => setWidgetApproval(store, name, readHash.value[name]), t('configurableViews.generatedAdmin.approved', { name: labelOf(name) }));
}

async function revoke(name: string): Promise<void> {
  if (await confirm({
    title:  t('configurableViews.generatedAdmin.revokeConfirm.title', { name: labelOf(name) }),
    body:   t('configurableViews.generatedAdmin.revokeConfirm.body', { name: labelOf(name) }),
    action: t('configurableViews.generatedAdmin.revoke'),
    danger: true,
  })) {
    await run(name, () => setWidgetApproval(store, name, null), t('configurableViews.generatedAdmin.revoked', { name: labelOf(name) }));
  }
}

async function remove(name: string): Promise<void> {
  if (await confirm({
    title:  t('configurableViews.generatedAdmin.deleteConfirm.title', { name: labelOf(name) }),
    body:   t('configurableViews.generatedAdmin.deleteConfirm.body', { name: labelOf(name) }),
    action: t('configurableViews.generatedAdmin.delete'),
    danger: true,
  })) {
    await run(name, () => deleteGeneratedWidget(store, name), t('configurableViews.generatedAdmin.deleted', { name: labelOf(name) }));
  }
}
</script>

<template>
  <div
    v-if="canApprove"
    class="gwa"
    data-testid="generated-widgets-admin"
  >
    <h2 class="mb-5">
      {{ t('configurableViews.generatedAdmin.title') }}
    </h2>
    <p class="text-muted mb-15">
      {{ t('configurableViews.generatedAdmin.intro') }}
    </p>

    <p
      v-if="!widgets.length"
      class="text-muted"
    >
      {{ t('configurableViews.generatedAdmin.none') }}
    </p>

    <div
      v-for="w in widgets"
      :key="w.name"
      class="gwa__item"
      :data-testid="`generated-widget-${ w.name }`"
    >
      <div class="gwa__head">
        <div class="gwa__name">
          <strong>{{ w.displayName }}</strong>
          <span class="text-muted">{{ w.name }}</span>
          <span
            v-if="w.created"
            class="text-muted"
            :data-testid="`generated-widget-dates-${ w.name }`"
          >
            {{ t('configurableViews.generatedAdmin.created') }} <DateFormatter :value="w.created" />
            <template v-if="changed[w.name] && changed[w.name] !== w.created">
              · {{ t('configurableViews.generatedAdmin.updated') }} <DateFormatter :value="changed[w.name]" />
            </template>
          </span>
        </div>
        <div class="gwa__status">
          <BadgeState
            :label="t(`configurableViews.generatedAdmin.status.${ statusOf(w.name) }`)"
            :color="COLOR[statusOf(w.name)]"
          />
          <span
            v-if="approvals[w.name]?.by"
            class="text-muted"
            :data-testid="`generated-widget-approved-by-${ w.name }`"
          >
            {{ t('configurableViews.generatedAdmin.approvedBy', { by: approvals[w.name].by }) }}
            <template v-if="approvals[w.name].at">
              ·
              <DateFormatter :value="approvals[w.name].at" />
            </template>
          </span>
        </div>
      </div>
      <p
        v-if="w.description"
        class="gwa__desc"
      >
        {{ w.description }}
      </p>

      <div class="gwa__review">
        <span class="text-muted">{{ t('configurableViews.generatedAdmin.uses') }}</span>
        <span
          v-for="c in reviews[w.name].components"
          :key="c"
          class="gwa__component"
        >{{ c }}</span>
        <span
          v-if="!reviews[w.name].components.length"
          class="text-muted"
        >{{ t('configurableViews.generatedAdmin.usesNone') }}</span>
      </div>
      <!-- What a reviewer should look at twice, as Rancher shows a warning -->
      <Banner
        v-if="reviews[w.name].findings.length"
        class="gwa__findings"
        color="warning"
        :data-testid="`generated-widget-findings-${ w.name }`"
      >
        <ul>
          <li
            v-for="f in reviews[w.name].findings"
            :key="f"
          >
            {{ t(`configurableViews.generatedAdmin.finding.${ f }`, { names: reviews[w.name].unknown.join(', ') }) }}
          </li>
        </ul>
      </Banner>

      <div class="gwa__actions">
        <button
          class="btn btn-sm role-secondary"
          :aria-expanded="!!open[w.name]"
          :aria-controls="`generated-widget-source-${ w.name }`"
          :data-testid="`generated-widget-code-${ w.name }`"
          @click="toggleCode(w.name)"
        >
          {{ open[w.name] ? t('configurableViews.generatedAdmin.hideCode') : t('configurableViews.generatedAdmin.showCode') }}
        </button>
        <button
          v-if="statusOf(w.name) !== 'approved'"
          class="btn btn-sm role-primary"
          :disabled="busy === w.name || readState(w.name) !== 'read'"
          :data-testid="`generated-widget-approve-${ w.name }`"
          @click="approve(w.name)"
        >
          {{ statusOf(w.name) === 'changed' ? t('configurableViews.generatedAdmin.approveAgain') : t('configurableViews.generatedAdmin.approve') }}
        </button>
        <button
          v-if="statusOf(w.name) !== 'pending'"
          class="btn btn-sm role-secondary"
          :disabled="busy === w.name"
          @click="revoke(w.name)"
        >
          {{ t('configurableViews.generatedAdmin.revoke') }}
        </button>
        <button
          class="btn btn-sm role-link"
          :disabled="busy === w.name"
          :data-testid="`generated-widget-delete-${ w.name }`"
          @click="remove(w.name)"
        >
          {{ t('configurableViews.generatedAdmin.delete') }}
        </button>
      </div>
      <!-- Approving needs the code read first: says so, until it is - or since it changed -->
      <p
        v-if="statusOf(w.name) !== 'approved' && readState(w.name) !== 'read'"
        class="gwa__hint text-muted"
        :data-testid="`generated-widget-read-hint-${ w.name }`"
      >
        {{ t(`configurableViews.generatedAdmin.${ readState(w.name) === 'changed' ? 'codeChanged' : 'readFirst' }`) }}
      </p>

      <pre
        v-if="open[w.name]"
        :id="`generated-widget-source-${ w.name }`"
        class="gwa__code"
      >{{ w.source }}</pre>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.gwa {
  margin-top: 40px;
  max-width:  960px;

  &__item {
    border:        1px solid var(--border);
    border-radius: var(--border-radius);
    margin-bottom: 12px;
    padding:       14px 16px;
  }

  &__head {
    align-items:     center;
    display:         flex;
    gap:             12px;
    justify-content: space-between;
  }

  &__name {
    display:        flex;
    flex-direction: column;
    gap:            2px;
  }

  &__status {
    align-items: center;
    display:     flex;
    flex-wrap:   wrap;
    gap:         8px;
  }

  &__desc {
    margin: 8px 0 0;
  }

  &__hint {
    margin: 6px 0 0;
  }

  &__review {
    align-items: center;
    display:     flex;
    flex-wrap:   wrap;
    gap:         6px;
    margin-top:  10px;
  }

  &__component {
    background:    var(--body-bg);
    border:        1px solid var(--border);
    border-radius: var(--border-radius);
    font-family:   monospace;
    font-size:     12px;
    padding:       1px 6px;
  }

  &__findings {
    margin: 10px 0 0;

    ul {
      margin:       0;
      padding-left: 18px;
    }
  }

  &__actions {
    display:    flex;
    flex-wrap:  wrap;
    gap:        8px;
    margin-top: 12px;
  }

  &__code {
    background:    var(--body-bg);
    border:        1px solid var(--border);
    border-radius: var(--border-radius);
    font-size:     12px;
    margin:        12px 0 0;
    max-height:    420px;
    overflow:      auto;
    padding:       10px;
    white-space:   pre;
  }
}
</style>
