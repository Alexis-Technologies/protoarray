<script setup lang="ts">
import { computed, ref } from 'vue';
import baseline from '../../../../bench/baseline.json';
import { ENGINE_OPS, engineCaption, engineModel } from '../../../../bench/report/model.mjs';
import BenchBars from './BenchBars.vue';
import Segmented from './Segmented.vue';

const op = ref('stringify');
const model = computed(() => engineModel(baseline, op.value));
const caption = engineCaption(baseline);
</script>

<template>
  <BenchBars :model="model" :caption="caption">
    <template #controls>
      <div class="pa-controls">
        <Segmented v-model="op" label="Direction" :items="ENGINE_OPS" />
      </div>
    </template>
  </BenchBars>
</template>

<style scoped>
.pa-controls {
  margin-bottom: 1rem;
}
</style>
