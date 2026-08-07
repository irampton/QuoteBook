<template>
  <div>
    <header class="flex flex-wrap items-end justify-between gap-5">
      <div><p class="text-xs font-bold tracking-[.15em] text-sage uppercase">{{ search ? 'Search results' : category ? 'Collection' : 'Library' }}</p><h1 class="mt-2 font-serif text-4xl font-semibold">{{ search ? `“${search}”` : category?.name || 'All quotes' }}</h1><p class="mt-2 text-sm text-ink/50" aria-live="polite">{{ loading ? 'Finding your quotes…' : `${quotes.length} ${quotes.length === 1 ? 'quote' : 'quotes'}` }}</p></div>
      <label class="sr-only" for="quote-sort">Sort quotes</label><select id="quote-sort" v-model="sort" class="field w-auto"><option value="newest">Newest first</option><option value="author">Author A–Z</option></select>
    </header>
    <div v-if="loading" class="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true"><div v-for="i in 6" :key="i" class="h-56 animate-pulse rounded-2xl border border-line bg-white/60"/></div>
    <div v-else-if="error" class="mt-8 rounded-xl bg-red-50 p-4 text-sm text-red-700">{{ error }} <button class="font-semibold underline" @click="load">Try again</button></div>
    <div v-else-if="sortedQuotes.length" class="mt-8 columns-1 gap-5 sm:columns-2 xl:columns-3">
      <article v-for="quote in sortedQuotes" :key="quote.id" class="group mb-5 break-inside-avoid rounded-2xl border border-line bg-paper p-6 transition hover:-translate-y-0.5 hover:border-moss card-shadow">
        <div class="font-serif text-4xl leading-5 text-sage/30">“</div><blockquote class="mt-3 font-serif text-lg leading-7">{{ quote.text || quote.quote }}</blockquote><p class="mt-5 text-sm font-semibold">— {{ quote.author || 'Unknown' }}</p><p v-if="quote.source || quote.date" class="mt-1 text-xs text-ink/40">{{ [quote.source, quote.date].filter(Boolean).join(' · ') }}</p>
        <div class="mt-5 flex flex-wrap gap-1.5"><span v-for="item in quote.categories || []" :key="item.id || item.name || item" class="rounded-full bg-cream px-2.5 py-1 text-[11px] text-ink/55">{{ item.name || item }}</span></div>
        <div class="mt-5 flex items-center justify-end gap-1 border-t border-line pt-3 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"><button class="rounded-lg p-2 text-ink/40 hover:bg-cream hover:text-sage" aria-label="Copy quote" @click="copy(quote)"><Copy :size="16"/></button><button class="rounded-lg p-2 text-ink/40 hover:bg-cream hover:text-sage" aria-label="Share quote" @click="share(quote)"><Share2 :size="16"/></button></div>
      </article>
    </div>
    <div v-else class="mt-10 rounded-2xl border border-dashed border-moss/60 p-12 text-center"><BookOpen class="mx-auto text-sage/50" :size="38"/><h2 class="mt-4 font-serif text-2xl font-semibold">{{ search ? 'No matching quotes' : 'No quotes here yet' }}</h2><p class="mt-2 text-sm text-ink/50">{{ search ? 'Try a different word, author, source, or phrase.' : 'Add something memorable to start this collection.' }}</p><button v-if="!search" class="btn-primary mt-5" @click="$emit('add')"><Plus :size="17"/> Add a quote</button></div>
    <p v-if="toast" class="fixed right-5 bottom-5 z-50 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-lg" role="status">{{ toast }}</p>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BookOpen, Copy, Plus, Share2 } from 'lucide-vue-next'
import { api } from '../api'
const props = defineProps({ category: Object, search: String, refreshKey: Number })
defineEmits(['add'])
const quotes = ref([]), loading = ref(true), error = ref(''), sort = ref('newest'), toast = ref('')
let controller
const sortedQuotes = computed(() => [...quotes.value].sort((a, b) => sort.value === 'author' ? (a.author || '').localeCompare(b.author || '') : String(b.createdAt || b.id || '').localeCompare(String(a.createdAt || a.id || ''))))
async function load() { controller?.abort(); const current = new AbortController(); controller = current; loading.value = true; error.value = ''; try { const result = await api.quotes({ category: props.category?.id || props.category?.name, search: props.search, signal: current.signal }); quotes.value = result?.quotes || result?.items || (Array.isArray(result) ? result : []) } catch (e) { if (e.name !== 'AbortError') error.value = e.message } finally { if (controller === current && !current.signal.aborted) loading.value = false } }
function showToast(message) { toast.value = message; setTimeout(() => { if (toast.value === message) toast.value = '' }, 2200) }
async function copy(quote) { const text = `“${quote.text || quote.quote}” — ${quote.author || 'Unknown'}`; try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text); else { const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select(); const copied = document.execCommand('copy'); area.remove(); if (!copied) throw new Error('copy failed') } showToast('Copied to clipboard') } catch { showToast('Could not copy this quote') } }
async function share(quote) { const text = `“${quote.text || quote.quote}” — ${quote.author || 'Unknown'}`; if (!navigator.share) return copy(quote); try { await navigator.share({ title: 'A quote from Quotebook', text }) } catch (e) { if (e.name !== 'AbortError') await copy(quote) } }
watch(() => [props.category, props.search, props.refreshKey], load, { deep: true }); onMounted(load); onBeforeUnmount(() => controller?.abort())
</script>
