<template>
  <div class="mx-auto max-w-4xl">
    <header>
      <p class="text-xs font-bold tracking-[.15em] text-sage uppercase">Add to your collection</p>
      <h1 class="mt-2 font-serif text-4xl font-semibold sm:text-5xl">Save words worth keeping.</h1>
      <p class="mt-3 text-sm leading-6 text-ink/55">Paste a quote—or a whole list—and we’ll help fill in the story behind it.</p>
    </header>

    <div class="mt-8 inline-flex rounded-xl border border-line bg-[#ecebe5] p-1" aria-label="Import mode">
      <button v-for="option in modes" :key="option.id" :aria-pressed="mode === option.id" :class="['flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition', mode === option.id ? 'bg-paper text-sage shadow-sm' : 'text-ink/50 hover:text-ink']" @click="mode = option.id">
        <component :is="option.icon" :size="16"/>{{ option.label }}
      </button>
    </div>

    <section v-if="showInput" class="mt-6 rounded-2xl border border-line bg-paper p-5 card-shadow sm:p-7">
      <label class="label" for="quote-input">{{ mode === 'single' ? 'Paste your quote' : 'Paste multiple quotes' }}</label>
      <textarea id="quote-input" v-model="input" class="field min-h-48 resize-y font-serif text-lg leading-8" :maxlength="mode === 'single' ? 10000 : 500000" :placeholder="mode === 'single' ? 'The words you want to remember…' : 'Paste a list of quotes. One per line works beautifully…'" />
      <div class="mt-4 flex flex-wrap items-center justify-between gap-4">
        <fieldset class="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <legend class="sr-only">Quote lookup preference</legend>
          <label class="flex cursor-pointer items-center gap-2"><input v-model="searchOnline" :value="true" type="radio" class="accent-sage"/><Globe2 :size="16" class="text-sage"/> Search this quote online</label>
          <label class="flex cursor-pointer items-center gap-2"><input v-model="searchOnline" :value="false" type="radio" class="accent-sage"/><FileText :size="16" class="text-ink/45"/> Don’t search for quote</label>
        </fieldset>
        <button class="btn-primary" :disabled="!input.trim() || busy" @click="analyze"><Sparkles :size="17"/> {{ mode === 'single' ? 'Find quote details' : 'Split and process quotes' }}</button>
      </div>
      <p class="mt-4 flex items-start gap-2 text-xs leading-5 text-ink/40"><ShieldCheck :size="15" class="mt-0.5 shrink-0"/> {{ searchOnline ? 'We’ll search trusted web sources to identify attribution and context.' : 'Only the text in this box will be used to identify details.' }}</p>
    </section>

    <section v-if="mode === 'single' && singleProcessing" class="mt-6 rounded-2xl border border-line bg-paper p-8 text-center card-shadow" aria-live="polite">
      <div class="mx-auto grid size-14 place-items-center rounded-2xl bg-sage/10 text-sage"><LoadingSpinner/></div>
      <h2 class="mt-5 font-serif text-2xl font-semibold">Looking into this quote</h2>
      <p class="mt-2 text-sm text-ink/50">Checking authorship, source, and context…</p>
    </section>

    <div v-if="mode === 'single' && singleReview" class="mt-6">
      <QuoteEditor :quote="singleReview" :categories="categories" @saved="onSingleSaved" @cancel="discardSingle" />
    </div>

    <section v-if="mode === 'batch' && (splitting || batchItems.length)" class="mt-6">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div aria-live="polite">
          <p class="text-xs font-bold tracking-[.14em] text-sage uppercase">Live batch review</p>
          <h2 class="mt-1 font-serif text-2xl font-semibold">{{ splitting ? 'Separating your quotes…' : `${batchItems.length} quotes found` }}</h2>
          <p v-if="batchItems.length" class="mt-1 text-sm text-ink/50">Edit and save ready quotes while the remaining lookups continue.</p>
        </div>
        <div v-if="batchItems.length" class="flex flex-wrap gap-2 text-xs">
          <span class="rounded-full bg-sage/10 px-3 py-1.5 text-sage-dark">{{ batchCounts.ready }} ready</span>
          <span class="rounded-full bg-cream px-3 py-1.5 text-ink/55">{{ batchCounts.saved }} saved</span>
          <span v-if="batchRunning" class="flex items-center gap-1.5 rounded-full bg-cream px-3 py-1.5 text-ink/55"><LoadingSpinner small/> Processing</span>
        </div>
      </div>

      <div v-if="splitting" class="rounded-2xl border border-line bg-paper p-8 text-center card-shadow"><LoadingSpinner/><p class="mt-3 text-sm text-ink/50">Finding each quote in your text…</p></div>

      <div v-else class="max-h-[72vh] space-y-4 overflow-y-auto overscroll-contain rounded-2xl border border-line bg-[#eeede7] p-3 sm:p-4" aria-label="Batch quote review queue">
        <article v-for="(item, index) in batchItems" :key="item.id" class="rounded-2xl" :aria-label="`Quote ${index + 1}: ${item.status}`">
          <QuoteEditor v-if="item.status === 'ready'" :quote="item.quote" :categories="categories" @saved="quote => onBatchSaved(item.id, quote)" @cancel="discardBatchItem(item.id)" />

          <div v-else :class="['flex min-h-24 items-center gap-4 rounded-2xl border bg-paper p-5', item.status === 'error' ? 'border-red-200' : 'border-line']">
            <span class="grid size-9 shrink-0 place-items-center rounded-full bg-cream text-sm font-bold text-ink/45">{{ index + 1 }}</span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <LoadingSpinner v-if="item.status === 'processing'" small/>
                <Clock3 v-else-if="item.status === 'waiting'" :size="17" class="text-ink/35"/>
                <CheckCircle2 v-else-if="item.status === 'saved'" :size="18" class="text-sage"/>
                <CircleSlash2 v-else-if="item.status === 'discarded'" :size="18" class="text-ink/35"/>
                <CircleAlert v-else :size="18" class="text-red-600"/>
                <p class="text-sm font-semibold">{{ statusLabel(item.status) }}</p>
              </div>
              <p class="mt-1 line-clamp-2 font-serif text-sm leading-5 text-ink/60">{{ item.quote?.text || item.text }}</p>
              <p v-if="item.error" class="mt-2 text-xs text-red-700">{{ item.error }}</p>
            </div>
            <button v-if="item.status === 'error'" class="btn-secondary shrink-0" :disabled="batchRunning" @click="retryBatchItem(item.id)">Retry</button>
          </div>
        </article>
      </div>

      <div v-if="batchItems.length && !batchRunning" class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper px-5 py-4">
        <p class="text-sm text-ink/55">{{ batchSummary }}</p>
        <button class="btn-secondary" :disabled="batchCounts.ready > 0" :title="batchCounts.ready > 0 ? 'Save or discard every ready quote first' : undefined" @click="resetBatch"><Plus :size="16"/> Start another batch</button>
      </div>
    </section>

    <div v-if="activeError" class="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700" role="alert">{{ activeError }} <button class="font-semibold underline" @click="analyze">Try again</button></div>

    <div v-if="mode === 'single' && singleComplete" class="mt-6 rounded-2xl border border-sage/20 bg-sage/10 p-8 text-center">
      <CheckCircle2 class="mx-auto text-sage" :size="34"/><h2 class="mt-3 font-serif text-2xl font-semibold">Quote saved</h2><p class="mt-2 text-sm text-ink/55">Your collection just got a little richer.</p><button class="btn-primary mt-5" @click="resetSingle"><Plus :size="17"/> Add another</button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { CheckCircle2, CircleAlert, CircleSlash2, Clock3, FileText, Globe2, Layers, Plus, Quote, ShieldCheck, Sparkles } from 'lucide-vue-next'
import LoadingSpinner from './LoadingSpinner.vue'
import QuoteEditor from './QuoteEditor.vue'
import { api } from '../api'

const props = defineProps({ categories: { type: Array, default: () => [] } })
const emit = defineEmits(['quote-saved'])
const modes = [{ id: 'single', label: 'Single quote', icon: Quote }, { id: 'batch', label: 'Batch import', icon: Layers }]
const mode = ref('single'), input = ref(''), searchOnline = ref(true)
const singleProcessing = ref(false), singleReview = ref(null), singleComplete = ref(false), singleError = ref('')
const splitting = ref(false), batchRunning = ref(false), batchItems = ref([]), batchError = ref('')
let nextBatchId = 1

const categoryNames = computed(() => props.categories.map(category => category.name))
const busy = computed(() => singleProcessing.value || splitting.value || batchRunning.value)
const showInput = computed(() => mode.value === 'single'
  ? !singleReview.value && !singleProcessing.value && !singleComplete.value
  : !splitting.value && batchItems.value.length === 0)
const activeError = computed(() => mode.value === 'single' ? singleError.value : batchError.value)
const batchCounts = computed(() => batchItems.value.reduce((counts, item) => { counts[item.status] = (counts[item.status] || 0) + 1; return counts }, { waiting: 0, processing: 0, ready: 0, error: 0, saved: 0, discarded: 0 }))
const batchSummary = computed(() => `${batchCounts.value.saved} saved · ${batchCounts.value.ready} awaiting review · ${batchCounts.value.error} failed · ${batchCounts.value.discarded} discarded`)
const batchTerminal = computed(() => batchItems.value.length > 0 && batchItems.value.every(item => item.status === 'saved' || item.status === 'discarded'))
const batchUnfinished = computed(() => batchItems.value.length > 0 && !batchTerminal.value)

function normalize(result, fallback) {
  const quote = result?.quote || result?.data || result || {}
  const suggestions = quote.categoryIds || quote.suggestedCategoryIds || quote.categories || []
  const categoryIds = suggestions.map(value => {
    const raw = typeof value === 'object' ? value.id ?? value.name : value
    const match = props.categories.find(item => String(item.id) === String(raw) || item.name?.toLocaleLowerCase() === String(raw).toLocaleLowerCase())
    return match?.id ?? null
  }).filter(value => value != null)
  return { text: quote.text || quote.quote || fallback, author: quote.author || '', date: quote.date || '', source: quote.source || '', context: quote.context || '', confidence: quote.confidence, lookupMode: searchOnline.value ? 'search' : 'parse', categoryIds }
}

async function analyze() {
  if (mode.value === 'single') return analyzeSingle()
  return startBatch()
}

async function analyzeSingle() {
  singleProcessing.value = true; singleError.value = ''; singleComplete.value = false
  try { singleReview.value = normalize(await api.analyzeQuote(input.value.trim(), searchOnline.value, categoryNames.value), input.value.trim()) }
  catch (error) { singleError.value = error.message }
  finally { singleProcessing.value = false }
}

async function startBatch() {
  splitting.value = true; batchError.value = ''; batchItems.value = []
  try {
    const result = await api.splitQuotes(input.value.trim())
    const texts = result?.quotes || result?.items || result
    if (!Array.isArray(texts) || !texts.length) throw new Error('We couldn’t find any quotes in that text.')
    batchItems.value = texts.map(value => ({ id: nextBatchId++, text: typeof value === 'string' ? value : value.text || value.quote, status: 'waiting', quote: null, error: '' }))
  } catch (error) { batchError.value = error.message; return }
  finally { splitting.value = false }
  await processBatchQueue()
}

async function processBatchQueue() {
  batchRunning.value = true
  for (const queued of batchItems.value) {
    const item = batchItems.value.find(value => value.id === queued.id)
    if (!item || item.status !== 'waiting') continue
    item.status = 'processing'; item.error = ''
    try {
      const result = await api.analyzeQuote(item.text, searchOnline.value, categoryNames.value)
      const current = batchItems.value.find(value => value.id === item.id)
      if (current?.status === 'processing') { current.quote = normalize(result, current.text); current.status = 'ready' }
    } catch (error) {
      const current = batchItems.value.find(value => value.id === item.id)
      if (current?.status === 'processing') { current.status = 'error'; current.error = error.message }
    }
  }
  batchRunning.value = false
}

async function retryBatchItem(id) {
  const item = batchItems.value.find(value => value.id === id)
  if (!item || batchRunning.value) return
  batchRunning.value = true; item.status = 'processing'; item.error = ''
  try { item.quote = normalize(await api.analyzeQuote(item.text, searchOnline.value, categoryNames.value), item.text); item.status = 'ready' }
  catch (error) { item.status = 'error'; item.error = error.message }
  finally { batchRunning.value = false }
}

function onSingleSaved(quote) { emit('quote-saved', quote); singleReview.value = null; singleComplete.value = true }
function discardSingle() { singleReview.value = null }
function onBatchSaved(id, quote) { const item = batchItems.value.find(value => value.id === id); if (!item || item.status !== 'ready') return; item.quote = quote; item.status = 'saved'; emit('quote-saved', quote) }
function discardBatchItem(id) { const item = batchItems.value.find(value => value.id === id); if (item?.status === 'ready') item.status = 'discarded' }
function statusLabel(status) { return ({ waiting: 'Waiting', processing: 'Researching quote…', saved: 'Saved', discarded: 'Discarded', error: 'Could not process' })[status] || status }
function resetSingle() { input.value = ''; singleReview.value = null; singleComplete.value = false; singleError.value = '' }
function resetBatch() { input.value = ''; batchItems.value = []; batchError.value = '' }

function resetWorkspace() {
  mode.value = 'single'; input.value = ''; searchOnline.value = true
  singleProcessing.value = false; singleReview.value = null; singleComplete.value = false; singleError.value = ''
  splitting.value = false; batchRunning.value = false; batchItems.value = []; batchError.value = ''; nextBatchId = 1
}

function resetIfComplete() {
  if (mode.value === 'single' && singleComplete.value) {
    if (batchUnfinished.value) { mode.value = 'batch'; return false }
    resetWorkspace(); return true
  }
  if (mode.value === 'batch' && batchTerminal.value) {
    if (singleProcessing.value || singleReview.value || singleError.value) { mode.value = 'single'; return false }
    resetWorkspace(); return true
  }
  return false
}

defineExpose({ resetIfComplete })
</script>
