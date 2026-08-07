<template>
  <article class="rounded-2xl border border-line bg-paper p-5 card-shadow sm:p-6">
    <div class="mb-5 flex items-start justify-between gap-4">
      <div><p class="text-xs font-bold tracking-[.12em] text-sage uppercase">Ready to review</p><h3 class="mt-1 font-serif text-xl font-semibold">Check the details</h3></div>
      <span v-if="model.confidence != null" class="rounded-full bg-cream px-3 py-1 text-xs text-ink/50">{{ confidenceLabel }} confidence</span>
    </div>
    <div class="space-y-5">
      <div><label class="label" :for="`${fieldId}-quote`">Quote</label><textarea :id="`${fieldId}-quote`" v-model="model.text" maxlength="10000" class="field min-h-28 resize-y font-serif text-lg leading-7" /></div>
      <div class="grid gap-5 sm:grid-cols-2">
        <div><label class="label" :for="`${fieldId}-author`">Author</label><input :id="`${fieldId}-author`" v-model="model.author" maxlength="300" class="field" placeholder="Unknown" /></div>
        <div><label class="label" :for="`${fieldId}-date`">Date</label><input :id="`${fieldId}-date`" v-model="model.date" maxlength="100" class="field" placeholder="e.g. 1963" /></div>
      </div>
      <div><label class="label" :for="`${fieldId}-source`">Source</label><input :id="`${fieldId}-source`" v-model="model.source" maxlength="1000" class="field" placeholder="Book, speech, interview…" /></div>
      <div><label class="label" :for="`${fieldId}-context`">Context</label><textarea :id="`${fieldId}-context`" v-model="model.context" maxlength="4000" class="field min-h-20 resize-y" placeholder="Helpful background about this quote" /></div>
      <div>
        <label class="label">Collections</label>
        <div class="flex flex-wrap gap-2">
          <label v-for="category in categories" :key="category.id || category.name" :class="['cursor-pointer rounded-full border px-3 py-2 text-xs font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sage/40', isSelected(category) ? 'border-sage bg-sage/10 text-sage-dark' : 'border-line hover:border-moss']">
            <input type="checkbox" class="sr-only" :checked="isSelected(category)" @change="toggle(category)" />{{ category.name }}<Check v-if="isSelected(category)" :size="13" class="ml-1 inline"/>
          </label>
        </div>
      </div>
    </div>
    <p v-if="error" class="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{{ error }}</p>
    <div class="mt-6 flex justify-end gap-3"><button class="btn-secondary" @click="$emit('cancel')">Discard</button><button class="btn-primary min-w-28" :disabled="saving || !model.text.trim()" @click="save"><LoadingSpinner v-if="saving" small/><Save v-else :size="16"/> {{ saving ? 'Saving…' : 'Save quote' }}</button></div>
  </article>
</template>

<script setup>
import { computed, reactive, ref, useId, watch } from 'vue'
import { Check, Save } from 'lucide-vue-next'
import LoadingSpinner from './LoadingSpinner.vue'
import { api } from '../api'
const props = defineProps({ quote: { type: Object, required: true }, categories: { type: Array, default: () => [] } })
const emit = defineEmits(['saved', 'cancel'])
const model = reactive({}); const saving = ref(false); const error = ref('')
const fieldId = useId()
watch(() => props.quote, (quote) => Object.assign(model, { text: '', author: '', date: '', source: '', context: '', confidence: null, lookupMode: 'search', categoryIds: [], ...quote }), { immediate: true, deep: true })
const confidenceLabel = computed(() => typeof model.confidence === 'number' ? `${Math.round(model.confidence * 100)}%` : model.confidence)
function key(category) { return category.id ?? category.name }
function isSelected(category) { return (model.categoryIds || model.categories || []).some(x => String(typeof x === 'object' ? key(x) : x) === String(key(category)) || String(x) === String(category.name)) }
function toggle(category) { const current = [...(model.categoryIds || [])]; const index = current.findIndex(x => String(x) === String(key(category))); if (index >= 0) current.splice(index, 1); else current.push(key(category)); model.categoryIds = current }
async function save() { saving.value = true; error.value = ''; try { const result = await api.saveQuote(model); emit('saved', result?.quote || result || { ...model }) } catch (e) { error.value = e.message } finally { saving.value = false } }
</script>
