<template>
  <div>
    <div :inert="modalOpen">
      <header class="flex flex-wrap items-end justify-between gap-5">
        <div><p class="text-xs font-bold tracking-[.15em] text-sage uppercase">{{ search ? 'Search results' : category ? 'Collection' : 'Library' }}</p><h1 class="mt-2 font-serif text-4xl font-semibold">{{ search ? `“${search}”` : category?.name || 'All quotes' }}</h1><p class="mt-2 text-sm text-ink/50" aria-live="polite">{{ loading ? 'Finding your quotes…' : `${quotes.length} ${quotes.length === 1 ? 'quote' : 'quotes'}` }}</p></div>
        <label class="sr-only" for="quote-sort">Sort quotes</label><select id="quote-sort" v-model="sort" class="field w-auto"><option value="newest">Newest first</option><option value="author">Author A–Z</option></select>
      </header>

      <div v-if="loading" class="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true"><div v-for="i in 6" :key="i" class="h-56 animate-pulse rounded-2xl border border-line bg-white/60"/></div>
      <div v-else-if="error" class="mt-8 rounded-xl bg-red-50 p-4 text-sm text-red-700" role="alert">{{ error }} <button class="font-semibold underline" @click="load">Try again</button></div>
      <div v-else-if="sortedQuotes.length" class="mt-8 columns-1 gap-5 sm:columns-2 xl:columns-3">
        <article v-for="quote in sortedQuotes" :key="quote.id" class="group mb-5 break-inside-avoid rounded-2xl border border-line bg-paper p-6 transition hover:-translate-y-0.5 hover:border-moss card-shadow">
          <div class="font-serif text-4xl leading-5 text-sage/30">“</div><blockquote class="mt-3 font-serif text-lg leading-7">{{ quote.text || quote.quote }}</blockquote><p class="mt-5 text-sm font-semibold">— {{ quote.author || 'Unknown' }}</p><p v-if="quote.source || quote.date" class="mt-1 text-xs text-ink/40">{{ [quote.source, quote.date].filter(Boolean).join(' · ') }}</p>
          <div class="mt-5 flex flex-wrap gap-1.5"><span v-for="item in quote.categories || []" :key="item.id || item.name || item" class="rounded-full bg-cream px-2.5 py-1 text-[11px] text-ink/55">{{ item.name || item }}</span></div>
          <div class="mt-5 flex items-center justify-end gap-1 border-t border-line pt-3 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <button class="rounded-lg p-2 text-ink/40 hover:bg-cream hover:text-sage" :aria-label="`Edit quote by ${quote.author || 'Unknown'}`" @click="openEdit(quote, $event)"><Pencil :size="16"/></button>
            <button class="rounded-lg p-2 text-ink/40 hover:bg-cream hover:text-sage" aria-label="Copy quote" @click="copy(quote)"><Copy :size="16"/></button>
            <button class="rounded-lg p-2 text-ink/40 hover:bg-cream hover:text-sage disabled:cursor-wait disabled:opacity-50" :aria-label="sharingId === quote.id ? 'Creating share link' : 'Share quote'" :disabled="sharingId === quote.id" @click="share(quote)"><LoadingSpinner v-if="sharingId === quote.id" small/><Share2 v-else :size="16"/></button>
            <button class="rounded-lg p-2 text-ink/40 hover:bg-red-50 hover:text-red-700" :aria-label="`Delete quote by ${quote.author || 'Unknown'}`" @click="openDelete(quote, $event)"><Trash2 :size="16"/></button>
          </div>
        </article>
      </div>
      <div v-else class="mt-10 rounded-2xl border border-dashed border-moss/60 p-12 text-center"><BookOpen class="mx-auto text-sage/50" :size="38"/><h2 class="mt-4 font-serif text-2xl font-semibold">{{ search ? 'No matching quotes' : 'No quotes here yet' }}</h2><p class="mt-2 text-sm text-ink/50">{{ search ? 'Try a different word, author, source, or phrase.' : 'Add something memorable to start this collection.' }}</p><button v-if="!search" class="btn-primary mt-5" @click="$emit('add')"><Plus :size="17"/> Add a quote</button></div>
    </div>

    <div v-if="editQuote" ref="editDialog" class="fixed inset-0 z-50 overflow-y-auto bg-black/35 p-4 sm:p-8" role="dialog" aria-modal="true" aria-labelledby="edit-quote-heading" @click.self="closeEdit" @keydown.esc="closeEdit" @keydown.tab="trapFocus($event, editDialog)">
      <div class="mx-auto max-w-3xl"><h2 id="edit-quote-heading" class="sr-only">Edit quote</h2><QuoteEditor :quote="editQuote" :categories="categories" :save-handler="updateEditedQuote" eyebrow="Edit quote" title="Update the details" save-label="Save changes" cancel-label="Cancel" @saved="onEditSaved" @cancel="closeEdit"/></div>
    </div>

    <div v-if="deleteTarget" ref="deleteDialog" class="fixed inset-0 z-50 grid place-items-center bg-black/35 p-5" role="alertdialog" aria-modal="true" aria-labelledby="delete-quote-heading" aria-describedby="delete-quote-description" @click.self="closeDelete" @keydown.esc="closeDelete" @keydown.tab="trapFocus($event, deleteDialog)">
      <section class="w-full max-w-md rounded-2xl border border-line bg-paper p-6 shadow-xl">
        <div class="grid size-10 place-items-center rounded-full bg-red-50 text-red-700"><Trash2 :size="19"/></div>
        <h2 id="delete-quote-heading" class="mt-4 font-serif text-2xl font-semibold">Delete this quote?</h2>
        <p id="delete-quote-description" class="mt-2 text-sm leading-6 text-ink/55">This permanently removes it from your Quotebook and every collection. Any public share link for it will stop working.</p>
        <blockquote class="mt-5 rounded-xl bg-cream p-4 font-serif text-sm leading-6">“{{ deleteTarget.text }}”<span class="mt-2 block font-sans text-xs font-semibold text-ink/55">— {{ deleteTarget.author || 'Unknown' }}</span></blockquote>
        <p v-if="deleteError" class="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{{ deleteError }}</p>
        <div class="mt-6 flex justify-end gap-3"><button ref="deleteCancel" class="btn-secondary" :disabled="deleting" @click="closeDelete">Cancel</button><button class="inline-flex items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50" :disabled="deleting" @click="confirmDelete"><LoadingSpinner v-if="deleting" small/><Trash2 v-else :size="16"/>{{ deleting ? 'Deleting…' : 'Delete quote' }}</button></div>
      </section>
    </div>

    <p v-if="toast" class="fixed right-5 bottom-5 z-[60] rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-lg" role="status">{{ toast }}</p>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BookOpen, Copy, Pencil, Plus, Share2, Trash2 } from 'lucide-vue-next'
import { api } from '../api'
import LoadingSpinner from './LoadingSpinner.vue'
import QuoteEditor from './QuoteEditor.vue'

const props = defineProps({ category: Object, search: String, refreshKey: Number, categories: { type: Array, default: () => [] } })
const emit = defineEmits(['add', 'changed', 'modal-change'])
const quotes = ref([]), loading = ref(true), error = ref(''), sort = ref('newest'), toast = ref(''), sharingId = ref(null)
const editQuote = ref(null), editDialog = ref(null), editSubmitting = ref(false)
const deleteTarget = ref(null), deleteDialog = ref(null), deleteCancel = ref(null), deleting = ref(false), deleteError = ref('')
const modalOpen = computed(() => Boolean(editQuote.value || deleteTarget.value))
let controller, dialogTrigger

const sortedQuotes = computed(() => [...quotes.value].sort((a, b) => sort.value === 'author' ? (a.author || '').localeCompare(b.author || '') : String(b.createdAt || b.id || '').localeCompare(String(a.createdAt || a.id || ''))))
async function load() { controller?.abort(); const current = new AbortController(); controller = current; loading.value = true; error.value = ''; try { const result = await api.quotes({ category: props.category?.id || props.category?.name, search: props.search, signal: current.signal }); quotes.value = result?.quotes || result?.items || (Array.isArray(result) ? result : []) } catch (requestError) { if (requestError.name !== 'AbortError') error.value = requestError.message } finally { if (controller === current && !current.signal.aborted) loading.value = false } }
function showToast(message) { toast.value = message; setTimeout(() => { if (toast.value === message) toast.value = '' }, 2200) }
async function restoreDialogFocus() { await nextTick(); if (dialogTrigger?.isConnected) dialogTrigger.focus(); else document.getElementById('quote-sort')?.focus(); dialogTrigger = null }
function trapFocus(event, container) { const elements = [...container.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')].filter(element => element.offsetParent !== null); const first = elements[0], last = elements.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() } }

async function openEdit(quote, event) { dialogTrigger = event.currentTarget; editQuote.value = { ...quote, categoryIds: quote.categoryIds || quote.categories?.map(item => item.id) || [] }; await nextTick(); editDialog.value?.querySelector('textarea, input, button')?.focus() }
function closeEdit() { if (editSubmitting.value) return; editQuote.value = null; restoreDialogFocus() }
async function updateEditedQuote(payload) { editSubmitting.value = true; try { return await api.updateQuote(editQuote.value.id, payload) } finally { editSubmitting.value = false } }
async function onEditSaved(updated) { const index = quotes.value.findIndex(item => item.id === updated.id); if (index >= 0) quotes.value[index] = updated; editQuote.value = null; emit('changed'); showToast('Quote updated'); restoreDialogFocus(); await load() }

async function openDelete(quote, event) { dialogTrigger = event.currentTarget; deleteTarget.value = quote; deleteError.value = ''; await nextTick(); deleteCancel.value?.focus() }
function closeDelete() { if (deleting.value) return; deleteTarget.value = null; deleteError.value = ''; restoreDialogFocus() }
async function confirmDelete() { if (!deleteTarget.value || deleting.value) return; deleting.value = true; deleteError.value = ''; const id = deleteTarget.value.id; try { await api.deleteQuote(id); quotes.value = quotes.value.filter(item => item.id !== id); deleteTarget.value = null; emit('changed'); showToast('Quote deleted'); restoreDialogFocus() } catch (requestError) { deleteError.value = requestError.message } finally { deleting.value = false } }

async function copyText(text, successMessage) { try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text); else { const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select(); const copied = document.execCommand('copy'); area.remove(); if (!copied) throw new Error('copy failed') } showToast(successMessage); return true } catch { showToast('Could not copy to the clipboard'); return false } }
async function copy(quote) { await copyText(`“${quote.text || quote.quote}” — ${quote.author || 'Unknown'}`, 'Copied quote to clipboard') }
async function share(quote) { if (!quote.id || sharingId.value != null) return; sharingId.value = quote.id; toast.value = ''; try { const result = await api.shareQuote(quote.id); const path = result?.share?.path; if (!path) throw new Error('The server did not return a share link.'); const url = `${window.location.origin}${path.startsWith('/') ? '' : '/'}${path}`; const text = `“${quote.text || quote.quote}” — ${quote.author || 'Unknown'}`; if (navigator.share) { try { await navigator.share({ title: 'A quote from Quotebook', text, url }); showToast('Quote shared') } catch (shareError) { if (shareError.name !== 'AbortError') await copyText(url, 'Share link copied') } } else await copyText(url, 'Share link copied') } catch (requestError) { showToast(requestError.message || 'Could not create a share link') } finally { sharingId.value = null } }

watch(modalOpen, value => emit('modal-change', value)); watch(() => [props.category, props.search, props.refreshKey], load, { deep: true }); onMounted(load); onBeforeUnmount(() => { controller?.abort(); emit('modal-change', false) })
</script>
