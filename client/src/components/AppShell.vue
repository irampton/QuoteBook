<template>
  <div class="min-h-screen bg-cream">
    <AppSidebar :user="user" :categories="categories" :active-category="view === 'library' ? category?.id || category?.name : null" :all-quotes-active="view === 'library' && !category && !search" :open="sidebarOpen" @close="closeSidebar" @logout="$emit('logout')" @add="showAdd" @category="showCategory" @search="showSearch" @new-category="openCategoryModal" />
    <main :inert="sidebarOpen && isMobile" :aria-hidden="sidebarOpen && isMobile ? 'true' : undefined" class="min-h-screen md:ml-[286px]">
      <div class="sticky top-0 z-20 flex h-16 items-center border-b border-line bg-cream/90 px-5 backdrop-blur md:hidden"><button ref="menuButton" class="rounded-lg p-2" aria-label="Open menu" :aria-expanded="sidebarOpen" @click="sidebarOpen = true"><Menu :size="21"/></button><span class="ml-3 font-serif text-lg font-semibold">Quotebook</span></div>
      <div ref="content" class="px-5 py-8 outline-none sm:px-8 sm:py-10 lg:px-12 xl:px-16" tabindex="-1"><AddQuotePage v-show="view === 'add'" :categories="categories" @quote-saved="onQuoteSaved"/><QuoteLibrary v-if="view === 'library'" :category="category" :search="search" :refresh-key="refreshKey" @add="showAdd"/></div>
    </main>
    <div v-if="newCategoryOpen" ref="categoryDialog" class="fixed inset-0 z-50 grid place-items-center bg-black/30 p-5" role="dialog" aria-modal="true" aria-labelledby="new-category-title" @click.self="closeCategoryModal" @keydown.esc="closeCategoryModal" @keydown.tab="trapDialogFocus"><form class="w-full max-w-sm rounded-2xl bg-paper p-6 shadow-xl" @submit.prevent="addCategory"><h2 id="new-category-title" class="font-serif text-2xl font-semibold">New collection</h2><p class="mt-2 text-sm text-ink/50">Give this group of quotes a memorable name.</p><label class="sr-only" for="new-category-name">Collection name</label><input id="new-category-name" v-model.trim="newCategoryName" class="field mt-5" autofocus maxlength="60" placeholder="e.g. Courage" required/><p v-if="categoryError" class="mt-3 text-sm text-red-700" role="alert">{{ categoryError }}</p><div class="mt-5 flex justify-end gap-3"><button type="button" class="btn-secondary" @click="closeCategoryModal">Cancel</button><button class="btn-primary" :disabled="categorySaving"><LoadingSpinner v-if="categorySaving" small/> Create</button></div></form></div>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Menu } from 'lucide-vue-next'
import AppSidebar from './AppSidebar.vue'
import AddQuotePage from './AddQuotePage.vue'
import QuoteLibrary from './QuoteLibrary.vue'
import LoadingSpinner from './LoadingSpinner.vue'
import { api } from '../api'
const props = defineProps({ user: Object, initialCategories: { type: Array, default: () => [] } }); defineEmits(['logout'])
const categories = ref([...props.initialCategories]), view = ref('library'), category = ref(null), search = ref(''), sidebarOpen = ref(false), isMobile = ref(false), menuButton = ref(null), content = ref(null), refreshKey = ref(0), newCategoryOpen = ref(false), categoryDialog = ref(null), newCategoryName = ref(''), categorySaving = ref(false), categoryError = ref('')
let categoryTrigger = null
let mobileQuery
function syncViewport(event) { isMobile.value = event.matches; if (!event.matches) sidebarOpen.value = false }
async function focusContentIfMobile(wasOpen) { if (wasOpen) { await nextTick(); content.value?.focus() } }
function showAdd() { const wasOpen = sidebarOpen.value; view.value = 'add'; category.value = null; search.value = ''; sidebarOpen.value = false; focusContentIfMobile(wasOpen) }
function showCategory(value) { const wasOpen = sidebarOpen.value; view.value = 'library'; category.value = value; search.value = ''; sidebarOpen.value = false; focusContentIfMobile(wasOpen) }
function showSearch(value) { const wasOpen = sidebarOpen.value; view.value = 'library'; category.value = null; search.value = value; sidebarOpen.value = false; focusContentIfMobile(wasOpen) }
function onQuoteSaved(quote) { for (const item of categories.value) { const ids = quote?.categoryIds || quote?.categories?.map(value => value.id) || []; if (ids.some(id => String(id) === String(item.id))) item.quoteCount = Number(item.quoteCount || 0) + 1 } refreshKey.value++ }
async function closeSidebar() { sidebarOpen.value = false; await nextTick(); menuButton.value?.focus() }
function openCategoryModal() { categoryTrigger = document.activeElement; newCategoryOpen.value = true }
async function restoreCategoryFocus() { await nextTick(); categoryTrigger?.focus?.(); categoryTrigger = null }
function closeCategoryModal() { if (!categorySaving.value) { newCategoryOpen.value = false; categoryError.value = ''; newCategoryName.value = ''; restoreCategoryFocus() } }
function trapDialogFocus(event) { const elements = [...categoryDialog.value.querySelectorAll('input, button:not(:disabled)')]; const first = elements[0], last = elements.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() } }
async function addCategory() { categorySaving.value = true; categoryError.value = ''; try { const result = await api.createCategory(newCategoryName.value); const item = result?.category || result; categories.value.push(typeof item === 'object' ? { quoteCount: 0, ...item } : { name: newCategoryName.value, quoteCount: 0 }); categories.value.sort((a, b) => a.name.localeCompare(b.name)); newCategoryName.value = ''; newCategoryOpen.value = false; restoreCategoryFocus() } catch (e) { categoryError.value = e.message } finally { categorySaving.value = false } }
onMounted(() => { mobileQuery = window.matchMedia('(max-width: 767px)'); syncViewport(mobileQuery); mobileQuery.addEventListener('change', syncViewport) })
onBeforeUnmount(() => mobileQuery?.removeEventListener('change', syncViewport))
</script>
