<template>
  <main class="min-h-screen bg-cream px-5 py-10 sm:py-16">
    <div class="mx-auto max-w-3xl">
      <BrandMark caption />
      <div class="mt-14 rounded-3xl border border-line bg-paper p-6 card-shadow sm:p-10">
        <span class="text-xs font-bold tracking-[.16em] text-sage uppercase">One last thing</span>
        <h1 class="mt-3 font-serif text-4xl font-semibold">What kinds of words do you collect?</h1>
        <p class="mt-3 max-w-xl text-sm leading-6 text-ink/55">Choose a few starting categories. You can always add more later.</p>
        <div class="mt-8 flex flex-wrap gap-3">
          <button v-for="item in suggestions" :key="item" type="button" :aria-pressed="selected.includes(item)" :class="['rounded-full border px-4 py-2.5 text-sm font-medium transition', selected.includes(item) ? 'border-sage bg-sage text-white' : 'border-line bg-white hover:border-moss']" @click="toggle(item)">
            <Check v-if="selected.includes(item)" :size="15" class="mr-1 inline"/>{{ item }}
          </button>
        </div>
        <div class="mt-7 flex gap-2">
          <input v-model.trim="custom" class="field" maxlength="60" placeholder="Add your own category" @keyup.enter="addCustom" />
          <button class="btn-secondary shrink-0" :disabled="!custom" @click="addCustom"><Plus :size="17"/> Add</button>
        </div>
        <p v-if="error" class="mt-4 text-sm text-red-700">{{ error }}</p>
        <div class="mt-9 flex items-center justify-between border-t border-line pt-6">
          <span class="text-sm text-ink/45">{{ selected.length }} selected</span>
          <button class="btn-primary" :disabled="selected.length === 0 || loading" @click="finish"><LoadingSpinner v-if="loading" small/> Start collecting <ArrowRight v-if="!loading" :size="17"/></button>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup>
import { ref } from 'vue'
import { ArrowRight, Check, Plus } from 'lucide-vue-next'
import BrandMark from './BrandMark.vue'
import LoadingSpinner from './LoadingSpinner.vue'
import { api } from '../api'

const emit = defineEmits(['complete'])
const suggestions = ref(['Inspirational', 'Funny', 'Meaningful', 'Historical', 'Deep', 'Literary', 'Wisdom', 'Love'])
const selected = ref(['Inspirational', 'Meaningful', 'Funny'])
const custom = ref(''); const loading = ref(false); const error = ref('')
function toggle(item) { selected.value = selected.value.includes(item) ? selected.value.filter(x => x !== item) : [...selected.value, item] }
function addCustom() { const name = custom.value.trim(); if (!name) return; const existing = suggestions.value.find(item => item.toLocaleLowerCase() === name.toLocaleLowerCase()); const value = existing || name; if (!existing) suggestions.value.push(value); if (!selected.value.some(item => item.toLocaleLowerCase() === value.toLocaleLowerCase())) selected.value.push(value); custom.value = '' }
async function finish() { loading.value = true; error.value = ''; try { const result = await api.setupCategories(selected.value); emit('complete', result?.categories || selected.value.map((name, i) => ({ id: i + 1, name }))) } catch (e) { error.value = e.message } finally { loading.value = false } }
</script>
