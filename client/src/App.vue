<template>
  <div v-if="booting" class="grid min-h-screen place-items-center bg-cream"><div class="text-center"><BrandMark caption/><div class="mt-8 text-sage"><LoadingSpinner/></div></div></div>
  <AuthPage v-else-if="!user" :notice="sessionNotice" @authenticated="onAuthenticated"/>
  <CategorySetup v-else-if="needsSetup" @complete="onSetupComplete"/>
  <AppShell v-else :user="user" :initial-categories="categories" @logout="logout"/>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppShell from './components/AppShell.vue'
import AuthPage from './components/AuthPage.vue'
import BrandMark from './components/BrandMark.vue'
import CategorySetup from './components/CategorySetup.vue'
import LoadingSpinner from './components/LoadingSpinner.vue'
import { api, auth } from './api'
const booting = ref(true), user = ref(null), needsSetup = ref(false), categories = ref([]), sessionNotice = ref('')
async function loadCategories() { const result = await api.categories(); categories.value = result?.categories || result?.items || (Array.isArray(result) ? result : []) }
async function onAuthenticated(result) { sessionNotice.value = ''; user.value = result.user; needsSetup.value = result.needsSetup; if (!needsSetup.value) { try { await loadCategories() } catch {} } }
function onSetupComplete(items) { categories.value = items; needsSetup.value = false }
async function logout() { try { await api.logout() } catch {} finally { auth.clear(); user.value = null; categories.value = []; needsSetup.value = false } }
function sessionExpired() { auth.clear(); user.value = null; categories.value = []; needsSetup.value = false; sessionNotice.value = 'Your session expired. Please sign in again.' }
onMounted(async () => { window.addEventListener('quotebook:unauthorized', sessionExpired); if (auth.token()) { try { const result = await api.me(); user.value = result?.user || result; needsSetup.value = result?.needsSetup || false; if (!needsSetup.value) await loadCategories() } catch (error) { if (error.status === 401) auth.clear(); else sessionNotice.value = 'Quotebook is temporarily unavailable. Your session is saved—please try again shortly.' } } booting.value = false })
onBeforeUnmount(() => window.removeEventListener('quotebook:unauthorized', sessionExpired))
</script>
