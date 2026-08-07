<template>
  <div>
    <div v-if="open" class="fixed inset-0 z-30 bg-black/25 md:hidden" @click="$emit('close')" />
    <aside ref="drawer" :role="open ? 'dialog' : 'complementary'" :aria-modal="open ? 'true' : undefined" :aria-label="open ? 'Navigation menu' : 'Sidebar navigation'" :class="['fixed inset-y-0 left-0 z-40 flex w-[286px] flex-col border-r border-line bg-[#efeee8] p-5 transition-transform md:visible md:translate-x-0', open ? 'visible translate-x-0' : 'invisible -translate-x-full']" @keydown.esc="closeMenus" @keydown.tab="trapFocus">
      <button ref="closeButton" class="absolute top-3 right-3 rounded-lg p-2 text-ink/50 hover:bg-white md:hidden" aria-label="Close menu" @click="$emit('close')"><X :size="19"/></button>
      <div class="relative">
        <button class="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-white/60" aria-haspopup="menu" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
          <span class="grid size-9 place-items-center rounded-full bg-sage font-semibold text-white">{{ initial }}</span>
          <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ user.username }}</span>
          <ChevronDown :size="16" class="text-ink/45"/>
        </button>
        <Transition name="fade"><button v-if="menuOpen" role="menuitem" class="absolute top-12 right-0 left-0 z-10 flex items-center gap-2 rounded-xl border border-line bg-paper px-4 py-3 text-sm text-red-700 shadow-lg hover:bg-red-50" @click="$emit('logout')"><LogOut :size="16"/> Log out</button></Transition>
      </div>

      <button class="btn-primary mt-7 w-full" @click="$emit('add')"><Plus :size="18"/> Add a quote</button>
      <div class="relative mt-5">
        <Search class="absolute top-1/2 left-3 -translate-y-1/2 text-ink/40" :size="17"/>
        <input v-model="query" aria-label="Search all saved quotes" class="focus-ring w-full rounded-xl border border-line bg-paper py-2.5 pr-9 pl-10 text-sm" placeholder="Search your quotes" @keyup.enter="runSearch" />
        <button v-if="query" class="absolute top-1/2 right-3 -translate-y-1/2 text-ink/35" aria-label="Clear search" @click="clearSearch"><X :size="15"/></button>
      </div>

      <div class="mt-7 mb-3 flex items-center justify-between px-2"><span class="text-[11px] font-bold tracking-[.14em] text-ink/40 uppercase">Library</span><button class="text-ink/35 hover:text-sage" aria-label="Add category" @click="$emit('new-category')"><Plus :size="16"/></button></div>
      <nav class="min-h-0 flex-1 overflow-y-auto">
        <button :class="['mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition', allQuotesActive ? 'bg-paper font-semibold text-sage shadow-sm' : 'text-ink/65 hover:bg-white/55 hover:text-ink']" @click="selectAllQuotes">
          <BookOpen :size="16" class="opacity-60"/><span class="min-w-0 flex-1 text-left">All Quotes</span>
        </button>
        <p v-if="categories.length" class="mt-5 mb-2 px-3 text-[10px] font-bold tracking-[.13em] text-ink/35 uppercase">Collections</p>
        <button v-for="category in categories" :key="category.id || category.name" :class="['flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition', activeCategory === (category.id || category.name) ? 'bg-paper font-semibold text-sage shadow-sm' : 'text-ink/65 hover:bg-white/55 hover:text-ink']" @click="selectCategory(category)">
          <span class="size-2 rounded-full bg-current opacity-55"/><span class="min-w-0 flex-1 truncate text-left">{{ category.name }}</span><span v-if="category.quoteCount != null" class="text-xs opacity-40">{{ category.quoteCount }}</span>
        </button>
      </nav>
      <div class="mt-4 border-t border-line pt-4"><BrandMark /></div>
    </aside>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { BookOpen, ChevronDown, LogOut, Plus, Search, X } from 'lucide-vue-next'
import BrandMark from './BrandMark.vue'
const props = defineProps({ user: Object, categories: Array, activeCategory: [String, Number], allQuotesActive: Boolean, open: Boolean })
const emit = defineEmits(['logout', 'add', 'category', 'search', 'close', 'new-category'])
const query = ref(''); const menuOpen = ref(false); const drawer = ref(null); const closeButton = ref(null)
const initial = computed(() => (props.user?.username || '?').slice(0, 1).toUpperCase())
function runSearch() { if (query.value.trim()) emit('search', query.value.trim()) }
function clearSearch() { query.value = ''; emit('search', '') }
function selectAllQuotes() { query.value = ''; emit('search', '') }
function selectCategory(category) { query.value = ''; emit('category', category) }
function closeMenus() { menuOpen.value = false; emit('close') }
function trapFocus(event) { if (!props.open) return; const elements = [...drawer.value.querySelectorAll('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')].filter(element => element.offsetParent !== null); const first = elements[0], last = elements.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() } }
watch(() => props.open, async value => { if (!value) menuOpen.value = false; else { await nextTick(); closeButton.value?.focus() } })
</script>
