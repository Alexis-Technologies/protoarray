<script setup lang="ts">
import { computed, ref } from 'vue';
import compare from '../../../../bench/results/compare.json';
import {
  METRICS,
  compareCaption,
  compareModel,
  compareScenarios,
} from '../../../../bench/report/model.mjs';
import BenchBars from './BenchBars.vue';
import Segmented from './Segmented.vue';

const props = withDefaults(defineProps<{ scenario?: string; metric?: string }>(), {
  scenario: 'single',
  metric: 'roundtrip',
});

const scenarios = compareScenarios(compare);
const metrics = METRICS.map(({ id, title }) => ({ id, title }));
const scenario = ref(props.scenario);
const metric = ref(props.metric);

// Linear by default: the libraries are within an order of magnitude of each
// other on every scenario, and a linear axis shows how far apart they are.
const scale = ref('linear');
const scales = [
  { id: 'linear', title: 'Linear' },
  { id: 'log', title: 'Log' },
];
const model = computed(() => compareModel(compare, scenario.value, metric.value, scale.value));
const caption = compareCaption(compare);
</script>

<template>
  <BenchBars :model="model" :caption="caption">
    <template #controls>
      <div class="pa-controls">
        <Segmented v-model="scenario" label="Scenario" :items="scenarios" />
        <div class="pa-controls-row">
          <Segmented v-model="metric" label="Metric" :items="metrics" />
          <Segmented v-model="scale" label="Axis scale" :items="scales" />
        </div>
      </div>
    </template>
  </BenchBars>
</template>

<style scoped>
.pa-controls {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.pa-controls-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
}
</style>
