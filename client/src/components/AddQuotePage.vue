<template>
  <div class="mx-auto max-w-4xl">
    <header><p class="text-xs font-bold tracking-[.15em] text-sage uppercase">Add to your collection</p><h1 class="mt-2 font-serif text-4xl font-semibold sm:text-5xl">Save words worth keeping.</h1><p class="mt-3 text-sm leading-6 text-ink/55">Paste a quote—or a whole list—and we’ll help fill in the story behind it.</p></header>

    <div class="mt-8 inline-flex rounded-xl border border-line bg-[#ecebe5] p-1">
      <button v-for="option in [{id:'single',label:'Single quote',icon:Quote},{id:'batch',label:'Batch import',icon:Layers}]" :key="option.id" :aria-pressed="mode === option.id" :disabled="processing || !!review" :class="['flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50', mode === option.id ? 'bg-paper text-sage shadow-sm' : 'text-ink/50 hover:text-ink']" @click="reset(option.id)"><component :is="option.icon" :size="16"/>{{ option.label }}</button>
    </div>

    <section v-if="!review && !processing && !complete" class="mt-6 rounded-2xl border border-line bg-paper p-5 card-shadow sm:p-7">
      <label class="label" for="quote-input">{{ mode === 'single' ? 'Paste your quote' : 'Paste multiple quotes' }}</label>
      <textarea id="quote-input" v-model="input" class="field min-h-48 resize-y font-serif text-lg leading-8" :maxlength="mode === 'single' ? 10000 : 500000" :placeholder="mode === 'single' ? 'The words you want to remember…' : 'Paste a list of quotes. One per line works beautifully…'" />
      <div class="mt-4 flex flex-wrap items-center justify-between gap-4">
        <fieldset class="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <legend class="sr-only">Quote lookup preference</legend>
          <label class="flex cursor-pointer items-center gap-2"><input v-model="searchOnline" :value="true" type="radio" class="accent-sage"/><Globe2 :size="16" class="text-sage"/> Search this quote online</label>
          <label class="flex cursor-pointer items-center gap-2"><input v-model="searchOnline" :value="false" type="radio" class="accent-sage"/><FileText :size="16" class="text-ink/45"/> Don’t search for quote</label>
        </fieldset>
        <button class="btn-primary" :disabled="!input.trim()" @click="analyze"><Sparkles :size="17"/> {{ mode === 'single' ? 'Find quote details' : 'Process quotes' }}</button>
      </div>
      <p class="mt-4 flex items-start gap-2 text-xs leading-5 text-ink/40"><ShieldCheck :size="15" class="mt-0.5 shrink-0"/> {{ searchOnline ? 'We’ll search trusted web sources to identify attribution and context.' : 'Only the text in this box will be used to identify details.' }}</p>
    </section>

    <section v-if="processing" class="mt-6 rounded-2xl border border-line bg-paper p-8 text-center card-shadow" aria-live="polite">
      <div class="mx-auto grid size-14 place-items-center rounded-2xl bg-sage/10 text-sage"><LoadingSpinner/></div>
      <h2 class="mt-5 font-serif text-2xl font-semibold">{{ mode === 'batch' ? 'Building your batch' : 'Looking into this quote' }}</h2>
      <p class="mt-2 text-sm text-ink/50">{{ progressLabel }}</p>
      <div v-if="mode === 'batch' && batchItems.length" class="mx-auto mt-6 max-h-56 max-w-xl space-y-2 overflow-y-auto text-left">
        <div v-for="(item, index) in batchItems" :key="index" class="flex items-center gap-3 rounded-xl bg-cream px-4 py-3 text-sm"><CheckCircle2 v-if="item.status === 'done'" :size="17" class="shrink-0 text-sage"/><LoadingSpinner v-else-if="item.status === 'processing'" small/><CircleAlert v-else-if="item.status === 'error'" :size="17" class="shrink-0 text-red-600"/><Circle v-else :size="17" class="shrink-0 text-ink/20"/><span class="min-w-0 flex-1 truncate text-ink/65">{{ item.text }}</span><span v-if="item.status === 'error'" class="shrink-0 text-xs text-red-700">Skipped</span></div>
      </div>
    </section>

    <div v-if="error" class="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700" role="alert">{{ error }} <button class="font-semibold underline" @click="analyze">Try again</button></div>
    <div v-if="review" class="mt-6">
      <div v-if="mode === 'batch'" class="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink/50"><span>Quote {{ reviewIndex + 1 }} of {{ results.length }}</span><span>{{ savedCount }} saved<span v-if="skippedCount"> · {{ skippedCount }} skipped during analysis</span></span></div>
      <QuoteEditor :quote="review" :categories="categories" @saved="onSaved" @cancel="onDiscard" />
    </div>
    <div v-if="complete" class="mt-6 rounded-2xl border border-sage/20 bg-sage/10 p-8 text-center"><CheckCircle2 class="mx-auto text-sage" :size="34"/><h2 class="mt-3 font-serif text-2xl font-semibold">{{ mode === 'batch' ? `${savedCount} quotes saved` : 'Quote saved' }}</h2><p class="mt-2 text-sm text-ink/55">Your collection just got a little richer.</p><button class="btn-primary mt-5" @click="reset(mode)"><Plus :size="17"/> Add another</button></div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { CheckCircle2, Circle, CircleAlert, FileText, Globe2, Layers, Plus, Quote, ShieldCheck, Sparkles } from 'lucide-vue-next'
import LoadingSpinner from './LoadingSpinner.vue'
import QuoteEditor from './QuoteEditor.vue'
import { api } from '../api'
const props = defineProps({ categories: { type: Array, default: () => [] } })
const emit = defineEmits(['quote-saved'])
const mode = ref('single'), input = ref(''), searchOnline = ref(true), processing = ref(false), error = ref(''), results = ref([]), reviewIndex = ref(0), savedCount = ref(0), complete = ref(false), batchItems = ref([])
const review = computed(() => results.value[reviewIndex.value] || null)
const skippedCount = computed(() => batchItems.value.filter(item => item.status === 'error').length)
const progressLabel = ref('Checking authorship, source, and context…')
function normalize(result, fallback) { const quote = result?.quote || result?.data || result || {}; const suggestions = quote.categoryIds || quote.suggestedCategoryIds || quote.categories || []; const categoryIds = suggestions.map(value => { const raw = typeof value === 'object' ? value.id ?? value.name : value; const match = props.categories.find(item => String(item.id) === String(raw) || item.name?.toLocaleLowerCase() === String(raw).toLocaleLowerCase()); return match?.id ?? null }).filter(value => value != null); return { text: quote.text || quote.quote || fallback, author: quote.author || '', date: quote.date || '', source: quote.source || '', context: quote.context || '', confidence: quote.confidence, lookupMode: searchOnline.value ? 'search' : 'parse', categoryIds } }
function reset(nextMode) { mode.value = nextMode; input.value = ''; processing.value = false; error.value = ''; results.value = []; reviewIndex.value = 0; savedCount.value = 0; complete.value = false; batchItems.value = [] }
async function analyze() {
  processing.value = true; error.value = ''; complete.value = false; results.value = []; batchItems.value = []; reviewIndex.value = 0
  try {
    if (mode.value === 'single') {
      const result = await api.analyzeQuote(input.value.trim(), searchOnline.value)
      results.value = [normalize(result, input.value.trim())]
    } else {
      progressLabel.value = 'Separating the quotes in your list…'
      const split = await api.splitQuotes(input.value.trim())
      const texts = split?.quotes || split?.items || split
      if (!Array.isArray(texts) || !texts.length) throw new Error('We couldn’t find any quotes in that text.')
      batchItems.value = texts.map(value => ({ text: typeof value === 'string' ? value : value.text || value.quote, status: 'waiting' }))
      const found = []
      for (let i = 0; i < batchItems.value.length; i++) {
        batchItems.value[i].status = 'processing'; progressLabel.value = `Researching quote ${i + 1} of ${batchItems.value.length}…`
        try {
          const result = await api.analyzeQuote(batchItems.value[i].text, searchOnline.value)
          found.push(normalize(result, batchItems.value[i].text)); batchItems.value[i].status = 'done'
        } catch { batchItems.value[i].status = 'error' }
      }
      if (!found.length) throw new Error('None of the quotes could be processed. Please check your connection and try again.')
      results.value = found
    }
  } catch (e) { error.value = e.message }
  finally { processing.value = false }
}
function advance() { if (reviewIndex.value < results.value.length - 1) reviewIndex.value++; else { results.value = []; complete.value = true } }
function onSaved(quote) { savedCount.value++; emit('quote-saved', quote); advance() }
function onDiscard() { advance() }
</script>
