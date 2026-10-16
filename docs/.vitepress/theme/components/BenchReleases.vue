<script setup lang="ts">
import { computed, ref } from 'vue';
import releases from '../../../../bench/results/releases.json';
import {
  releaseModel,
  releaseScenarios,
  releasesCaption,
} from '../../../../bench/report/model.mjs';
import BenchBars from './BenchBars.vue';
import Segmented from './Segmented.vue';

const props = withDefaults(defineProps<{ scenario?: string }>(), { scenario: 'single' });

const scenarios = releaseScenarios(releases);
const current = ref(props.scenario);
const model = computed(() => releaseModel(releases, current.value));
const caption = releasesCaption(releases);
</script>

<template>
  <BenchBars :model="model" :caption="caption">
    <template #controls>
      <div class="pa-controls">
        <Segmented v-model="current" label="Scenario" :items="scenarios" />
      </div>
    </template>
  </BenchBars>
</template>

<style scoped>
.pa-controls {
  margin-bottom: 1rem;
}
</style>
