<template>
  <main class="min-h-screen bg-cream px-5 py-8 sm:px-8 sm:py-12">
    <div class="mx-auto max-w-2xl">
      <div v-if="loading" class="grid min-h-[60vh] place-items-center" role="status">
        <div class="text-center text-sage"><LoadingSpinner/><p class="mt-4 text-sm text-ink/50">Opening shared quote…</p></div>
      </div>

      <section v-else-if="error" class="mt-20 rounded-3xl border border-line bg-paper p-8 text-center card-shadow sm:p-12" role="alert">
        <Link2Off class="mx-auto text-ink/30" :size="38"/>
        <h1 class="mt-5 font-serif text-3xl font-semibold">This quote isn’t available</h1>
        <p class="mx-auto mt-3 max-w-md text-sm leading-6 text-ink/50">{{ error }}</p>
      </section>

      <template v-else-if="quote">
        <article class="mt-16 rounded-3xl border border-line bg-paper px-7 py-10 card-shadow sm:mt-24 sm:px-12 sm:py-14">
          <div class="font-serif text-6xl leading-5 text-sage/25">“</div>
          <blockquote class="mt-7 font-serif text-2xl leading-10 text-ink sm:text-3xl sm:leading-[1.5]">{{ quote.text }}</blockquote>
          <p class="mt-8 text-base font-semibold">— {{ quote.author || 'Unknown' }}</p>
        </article>

        <section v-if="authenticated && categories.length && !saved" class="mt-6 rounded-2xl border border-line bg-paper p-6" aria-labelledby="save-shared-heading">
          <h2 id="save-shared-heading" class="font-serif text-xl font-semibold">Save to your Quotebook</h2>
          <p class="mt-2 text-sm text-ink/50">Choose at least one collection.</p>
          <fieldset class="mt-5">
            <legend class="sr-only">Collections for this quote</legend>
            <div class="flex flex-wrap gap-2">
              <label v-for="category in categories" :key="category.id" :for="`${fieldId}-${category.id}`" :class="['cursor-pointer rounded-full border px-3 py-2 text-xs font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sage/40', selectedIds.includes(category.id) ? 'border-sage bg-sage/10 text-sage-dark' : 'border-line hover:border-moss']">
                <input :id="`${fieldId}-${category.id}`" v-model="selectedIds" :value="category.id" type="checkbox" class="sr-only"/>{{ category.name }}<Check v-if="selectedIds.includes(category.id)" :size="13" class="ml-1 inline"/>
              </label>
            </div>
          </fieldset>
          <p v-if="saveError" class="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{{ saveError }}</p>
          <button class="btn-primary mt-6 w-full sm:w-auto" :disabled="saving || selectedIds.length === 0" @click="save"><LoadingSpinner v-if="saving" small/><Download v-else :size="16"/>{{ saving ? 'Saving…' : 'Save quote' }}</button>
        </section>

        <p v-if="saved" class="mt-6 flex items-center justify-center gap-2 rounded-2xl bg-sage/10 px-5 py-4 text-sm font-semibold text-sage-dark" role="status"><CheckCircle2 :size="18"/> Saved to your Quotebook</p>
      </template>
    </div>
  </main>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { Check, CheckCircle2, Download, Link2Off } from 'lucide-vue-next'
import { api } from '../api'
import LoadingSpinner from './LoadingSpinner.vue'

const props = defineProps({ token: { type: String, required: true }, authenticated: Boolean, categories: { type: Array, default: () => [] } })
const fieldId = useId()
const quote = ref(null), loading = ref(true), error = ref(''), selectedIds = ref([]), saving = ref(false), saveError = ref(''), saved = ref(false)
const controller = new AbortController()

async function load() {
  loading.value = true; error.value = ''
  try { const result = await api.publicQuote(props.token, controller.signal); quote.value = result?.quote || result }
  catch (requestError) { if (requestError.name !== 'AbortError') error.value = requestError.status === 404 ? 'The link may have expired or been removed.' : requestError.message }
  finally { if (!controller.signal.aborted) loading.value = false }
}

async function save() {
  if (!selectedIds.value.length) return
  saving.value = true; saveError.value = ''
  try { await api.savePublicQuote(props.token, selectedIds.value); saved.value = true }
  catch (requestError) { saveError.value = requestError.message }
  finally { saving.value = false }
}

onMounted(load)
onBeforeUnmount(() => controller.abort())
</script>
