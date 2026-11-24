<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';
import { BadgeState } from '@components/BadgeState';
import { ensureLizAgents, lizAccess, lizAgentStatus, type AgentState } from '../templating/liz-agents';
import { canApproveWidgets } from '../templating/template-engine';

// Liz's agents for this package, and what the check since Rancher loaded did with them (see liz-agents). For
// whoever may add them; and where Liz is not installed, for an admin, to say why she builds nothing here.

const store = useStore();
const { t } = useI18n(store);

const access = computed(() => lizAccess(store.getters));
const shown = computed(() => access.value.allowed || (!access.value.liz && canApproveWidgets(store.getters)));

const checking = ref(false);

async function check(again = false): Promise<void> {
  checking.value = true;

  try {
    await ensureLizAgents(store, { again });
  } finally {
    checking.value = false;
  }
}

onMounted(() => {
  if (access.value.allowed) {
    check();
  }
});

const COLOR: Record<AgentState, string> = {
  installed:  'bg-success',
  updated:    'bg-success',
  current:    'bg-success',
  newer:      'bg-info',
  builtIn:    'bg-info',
  notAllowed: 'bg-warning',
  failed:     'bg-error',
};
</script>

<template>
  <div
    v-if="shown"
    class="liz-agents"
    data-testid="liz-agents"
  >
    <h2 class="mb-5">
      {{ t('configurableViews.lizAgents.title') }}
    </h2>
    <p
      v-if="!access.liz"
      class="text-muted"
      data-testid="liz-agents-missing"
    >
      {{ t('configurableViews.lizAgents.missing') }}
    </p>
    <template v-else>
      <p class="text-muted mb-15">
        {{ t('configurableViews.lizAgents.intro') }}
      </p>
      <p
        v-if="checking && !lizAgentStatus.results.length"
        class="text-muted"
      >
        {{ t('configurableViews.lizAgents.checking') }}
      </p>
      <div
        v-for="r in lizAgentStatus.results"
        :key="r.name"
        class="liz-agents__item"
        :data-testid="`liz-agent-${ r.name }`"
      >
        <div class="liz-agents__name">
          <strong>{{ r.displayName }}</strong>
          <span class="text-muted">{{ r.name }}</span>
        </div>
        <div class="liz-agents__state">
          <span
            v-if="r.phase"
            class="text-muted"
          >{{ t('configurableViews.lizAgents.phase', { phase: r.phase }) }}</span>
          <BadgeState
            :label="t(`configurableViews.lizAgents.state.${ r.state }`)"
            :color="COLOR[r.state]"
          />
        </div>
        <p
          v-if="r.error"
          class="text-error liz-agents__error"
        >
          {{ r.error }}
        </p>
      </div>
      <button
        class="btn btn-sm role-secondary"
        :disabled="checking"
        data-testid="liz-agents-again"
        @click="check(true)"
      >
        {{ t('configurableViews.lizAgents.again') }}
      </button>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.liz-agents {
  margin-top: 40px;
  max-width:  960px;

  &__item {
    align-items:     center;
    border:          1px solid var(--border);
    border-radius:   var(--border-radius);
    display:         flex;
    flex-wrap:       wrap;
    gap:             12px;
    justify-content: space-between;
    margin-bottom:   12px;
    padding:         14px 16px;
  }

  &__name {
    display:        flex;
    flex-direction: column;
    gap:            2px;
  }

  &__state {
    align-items: center;
    display:     flex;
    gap:         8px;
  }

  &__error {
    flex-basis: 100%;
    margin:     0;
  }
}
</style>
